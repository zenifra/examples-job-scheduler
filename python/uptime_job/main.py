from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from concurrent.futures import FIRST_EXCEPTION, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from urllib.parse import urlsplit

from .check import USER_AGENT, CheckResult, check_target
from .config import Config, ConfigError, load_config
from .state import diff_state, read_state, write_state

EXIT_SUCCESS = 0
EXIT_FAILURE = 1
EXIT_CONFIG = 2

# How often the main thread looks at the stop signal and the deadline while checks run.
POLL_SECONDS = 0.1


class Logger:
    """One JSON object per line: easy to read in the run logs and easy to search."""

    def __init__(self, stdout=None, stderr=None):
        self._stdout = stdout or sys.stdout
        self._stderr = stderr or sys.stderr

    def _write(self, stream, level: str, msg: str, fields: dict) -> None:
        line = {"time": datetime.now(timezone.utc).isoformat(), "level": level, "msg": msg, **fields}
        stream.write(json.dumps(line, separators=(",", ":")) + "\n")
        stream.flush()

    def info(self, msg: str, **fields) -> None:
        self._write(self._stdout, "info", msg, fields)

    def warn(self, msg: str, **fields) -> None:
        self._write(self._stdout, "warn", msg, fields)

    def error(self, msg: str, **fields) -> None:
        self._write(self._stderr, "error", msg, fields)


def summarize(results: list[CheckResult], changes: list[dict]) -> str:
    down = [result for result in results if not result.ok]
    lines = [f"Uptime check: {len(results) - len(down)}/{len(results)} targets up."]
    lines += [f"DOWN {result.url} ({result.error})" for result in down]
    lines += [f"CHANGED {change['url']}: {change['from']} -> {change['to']}" for change in changes]
    return "\n".join(lines)


def post_webhook(url: str, text: str, timeout: float) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout):
            pass
    except urllib.error.HTTPError as error:
        # urlopen raises HTTPError for any non-2xx answer; release its connection before re-raising.
        error.close()
        raise


def run(
    env: Mapping[str, str],
    stop: threading.Event | None = None,
    log: Logger | None = None,
    check: Callable[..., CheckResult] = check_target,
    notify: Callable[[str, str, float], None] = post_webhook,
    deadline_seconds: float | None = None,
) -> int:
    """Runs the job once and returns the process exit code.
    `stop` is set when the platform asks the job to stop (SIGTERM)."""
    stop = stop or threading.Event()
    log = log or Logger()

    try:
        config = load_config(env)
    except ConfigError as error:
        log.error("invalid configuration", reason=str(error))
        return EXIT_CONFIG

    deadline_at = time.monotonic() + (deadline_seconds or config.deadline_seconds)
    log.info("job started", targets=len(config.targets), deadlineSeconds=config.deadline_seconds)

    executor = ThreadPoolExecutor(max_workers=config.concurrency)
    try:
        futures = [
            executor.submit(
                check, url,
                request_timeout_ms=config.request_timeout_ms,
                max_attempts=config.max_attempts,
                stop=stop,
            )
            for url in config.targets
        ]
        pending = set(futures)
        while pending:
            if stop.is_set():
                # The state file is left untouched, so the next run compares with the last complete run.
                log.warn("job cancelled before finishing", stateSaved=False)
                return EXIT_FAILURE
            if time.monotonic() >= deadline_at:
                stop.set()
                log.error("job deadline exceeded", deadlineSeconds=config.deadline_seconds)
                return EXIT_FAILURE
            _, pending = wait(pending, timeout=POLL_SECONDS, return_when=FIRST_EXCEPTION)
        results = [future.result() for future in futures]
    finally:
        # Never block on checks that are still running: each one ends within the request timeout.
        executor.shutdown(wait=False, cancel_futures=True)

    return _report(config, results, log, notify)


def _report(config: Config, results: list[CheckResult], log: Logger, notify) -> int:
    for result in results:
        if result.ok:
            log.info("target up", **result.as_dict())
        else:
            log.warn("target down", **result.as_dict())

    # The state lives in the persistent directory, so it survives between runs.
    # It is optional: a state problem is logged and never fails the check itself.
    changes: list[dict] = []
    if config.state_dir:
        try:
            changes = diff_state(read_state(config.state_dir), results)
            write_state(config.state_dir, results)
        except (OSError, ValueError) as error:
            log.warn("could not use the state directory", stateDir=config.state_dir, reason=str(error))

    down = [result for result in results if not result.ok]
    if config.webhook_url and (down or changes):
        # Never log the webhook URL itself: it usually carries a secret token.
        webhook_host = urlsplit(config.webhook_url).netloc
        try:
            notify(config.webhook_url, summarize(results, changes), config.request_timeout_ms / 1000)
            log.info("notification sent", webhookHost=webhook_host)
        except OSError as error:
            log.error("notification failed", webhookHost=webhook_host, reason=str(error))
            return EXIT_FAILURE

    log.info("job finished", up=len(results) - len(down), down=len(down), changes=len(changes))
    return EXIT_FAILURE if down and config.fail_on_down else EXIT_SUCCESS
