import os
import signal
import sys
import threading

from .main import EXIT_FAILURE, Logger, run


def main() -> int:
    log = Logger()
    stop = threading.Event()

    # When a run is cancelled, paused or deleted, the platform sends SIGTERM and waits
    # up to 30 seconds. Ask the checks to stop, let `run` log what happened, and exit.
    def handle_stop(signum, _frame):
        log.warn("stop signal received", signal=signal.Signals(signum).name)
        stop.set()

    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)

    try:
        code = run(os.environ, stop=stop, log=log)
    except Exception as error:  # noqa: BLE001 - last resort: log it and fail the run
        log.error("unexpected error", reason=str(error), type=type(error).__name__)
        return EXIT_FAILURE

    if stop.is_set():
        # A request already in flight cannot be interrupted, and a normal exit would wait for it.
        # Everything is logged at this point, so leave right away.
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(code)
    return code


if __name__ == "__main__":
    sys.exit(main())
