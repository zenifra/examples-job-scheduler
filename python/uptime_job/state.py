from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone

from .check import CheckResult

STATE_FILE = "uptime-state.json"


def read_state(directory: str) -> dict | None:
    """Returns the previous run's state, or None on the first run."""
    try:
        with open(os.path.join(directory, STATE_FILE), encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        return None


def write_state(directory: str, results: list[CheckResult], now: datetime | None = None) -> None:
    """Writes to a temporary file and renames it, so a run cancelled mid-write
    never leaves a truncated state file behind."""
    state = {
        "checkedAt": (now or datetime.now(timezone.utc)).isoformat(),
        "targets": {result.url: {"ok": result.ok, "status": result.status} for result in results},
    }
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=f"{STATE_FILE}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(state, file, indent=2)
            file.write("\n")
        os.replace(tmp_path, os.path.join(directory, STATE_FILE))
    except BaseException:
        os.unlink(tmp_path)
        raise


def diff_state(previous: dict | None, results: list) -> list[dict]:
    """Lists the targets whose up/down status changed since the previous run."""
    if not previous or "targets" not in previous:
        return []

    changes = []
    for result in results:
        before = previous["targets"].get(result.url)
        if before is not None and before["ok"] != result.ok:
            changes.append({
                "url": result.url,
                "from": "up" if before["ok"] else "down",
                "to": "up" if result.ok else "down",
            })
    return changes
