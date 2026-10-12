from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

MAX_TARGETS = 50


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    targets: list[str]
    request_timeout_ms: int = 10_000
    max_attempts: int = 3
    concurrency: int = 5
    deadline_seconds: int = 300
    fail_on_down: bool = True
    webhook_url: str | None = None
    state_dir: str | None = None


def _read_int(env: Mapping[str, str], name: str, fallback: int, minimum: int, maximum: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return fallback
    try:
        value = int(raw)
    except ValueError:
        value = None
    if value is None or not minimum <= value <= maximum:
        raise ConfigError(f"{name} must be an integer between {minimum} and {maximum}")
    return value


def _read_bool(env: Mapping[str, str], name: str, fallback: bool) -> bool:
    raw = env.get(name, "").strip().lower()
    if not raw:
        return fallback
    if raw in ("true", "1", "yes"):
        return True
    if raw in ("false", "0", "no"):
        return False
    raise ConfigError(f"{name} must be true or false")


def _read_url(name: str, raw: str) -> str:
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https"):
        raise ConfigError(f"{name} only accepts http:// or https:// URLs")
    if not parts.hostname:
        raise ConfigError(f"{name} contains an invalid URL")
    return raw


def load_config(env: Mapping[str, str]) -> Config:
    """Reads and validates every setting up front, so a bad value fails the run
    immediately instead of halfway through the work."""
    targets = [item.strip() for item in env.get("TARGET_URLS", "").split(",") if item.strip()]
    if not targets:
        raise ConfigError("TARGET_URLS is required: a comma-separated list of URLs to check")
    if len(targets) > MAX_TARGETS:
        raise ConfigError(f"TARGET_URLS accepts at most {MAX_TARGETS} URLs")

    webhook_url = env.get("WEBHOOK_URL", "").strip()

    return Config(
        targets=list(dict.fromkeys(_read_url("TARGET_URLS", target) for target in targets)),
        # Capped at 20 s so an in-flight request always ends within the 30 s the platform
        # waits after asking the job to stop.
        request_timeout_ms=_read_int(env, "REQUEST_TIMEOUT_MS", 10_000, 100, 20_000),
        max_attempts=_read_int(env, "MAX_ATTEMPTS", 3, 1, 5),
        concurrency=_read_int(env, "CONCURRENCY", 5, 1, 20),
        # Kept well below the platform's 60-minute limit so the job can report and exit on its own terms.
        deadline_seconds=_read_int(env, "JOB_DEADLINE_SECONDS", 300, 10, 3300),
        fail_on_down=_read_bool(env, "FAIL_ON_DOWN", True),
        webhook_url=_read_url("WEBHOOK_URL", webhook_url) if webhook_url else None,
        state_dir=env.get("STATE_DIR", "").strip() or None,
    )
