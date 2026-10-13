"""Graceful shutdown: how a scheduled job should react when Zenifra stops it.

When a run is cancelled, or the Job is paused or deleted, Zenifra sends SIGTERM to the task
and waits up to 30 seconds before killing it. In that window a well-behaved job:

1. stops starting new work;
2. aborts (or quickly finishes) the work in flight;
3. leaves its data consistent: this example only writes its state file after a complete run;
4. logs what happened and exits with 128 + the signal number (143 for SIGTERM).

SIGINT (Ctrl+C) gets the same treatment, which makes the behaviour easy to try locally.
"""

from __future__ import annotations

import os
import signal
import threading

# Leave on our own well before Zenifra's 30-second limit if some work ignores the stop request.
FORCED_EXIT_AFTER_SECONDS = 20


class StopSignals:
    """Sets `stop` on SIGTERM/SIGINT; pass the event to everything that does work."""

    def __init__(self, log, forced_exit_after: float = FORCED_EXIT_AFTER_SECONDS, exit=os._exit) -> None:
        self.stop = threading.Event()
        self.exit_code: int | None = None
        self._log = log
        self._forced_exit_after = forced_exit_after
        self._exit = exit

    def install(self) -> "StopSignals":
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, self._handle)
        return self

    def _handle(self, signum: int, _frame) -> None:
        self._log.warn("stop signal received", signal=signal.Signals(signum).name)
        self.exit_code = 128 + signum
        self.stop.set()
        timer = threading.Timer(self._forced_exit_after, self._exit, args=(self.exit_code,))
        timer.daemon = True
        timer.start()
