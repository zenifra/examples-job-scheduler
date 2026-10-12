from __future__ import annotations

import random
import threading
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass

# Statuses worth a second try: the target may recover within the same run.
RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}
USER_AGENT = "zenifra-uptime-job/1.0"


class Stopped(Exception):
    """Raised when the job was asked to stop before the check finished."""


@dataclass
class CheckResult:
    url: str
    ok: bool
    status: int | None
    attempts: int
    duration_ms: int
    error: str | None

    def as_dict(self) -> dict:
        return asdict(self)


def backoff_seconds(attempt: int) -> float:
    return 0.5 * 2 ** (attempt - 1) + random.uniform(0, 0.25)


def _fetch_status(url: str, timeout: float) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        # Only the status matters here; the body is never read.
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as error:
        error.close()
        return error.code


def check_target(
    url: str,
    *,
    request_timeout_ms: int,
    max_attempts: int,
    stop: threading.Event,
    fetch_status=_fetch_status,
    backoff=backoff_seconds,
) -> CheckResult:
    started_at = time.monotonic()
    attempts = 0
    status: int | None = None
    error: str | None = None

    while attempts < max_attempts:
        if stop.is_set():
            raise Stopped()
        attempts += 1

        try:
            status = fetch_status(url, request_timeout_ms / 1000)
            ok = 200 <= status < 300
            error = None if ok else f"HTTP {status}"
            if ok or status not in RETRYABLE_STATUS:
                break
        except (TimeoutError, urllib.error.URLError, OSError) as cause:
            status = None
            reason = getattr(cause, "reason", cause)
            error = f"timeout after {request_timeout_ms} ms" if isinstance(reason, TimeoutError) else str(reason)

        # Event.wait returns True as soon as the job is asked to stop.
        if attempts < max_attempts and stop.wait(backoff(attempts)):
            raise Stopped()

    return CheckResult(
        url=url,
        ok=error is None,
        status=status,
        attempts=attempts,
        duration_ms=round((time.monotonic() - started_at) * 1000),
        error=error,
    )
