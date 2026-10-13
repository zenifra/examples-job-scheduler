import os
import sys

from .main import EXIT_FAILURE, Logger, run
from .shutdown import StopSignals


def main() -> int:
    log = Logger()
    stop_signals = StopSignals(log).install()

    try:
        code = run(os.environ, stop=stop_signals.stop, log=log)
    except Exception as error:  # noqa: BLE001 - last resort: log it and fail the run
        log.error("unexpected error", reason=str(error), type=type(error).__name__)
        return EXIT_FAILURE

    if stop_signals.exit_code is not None:
        # A request already in flight cannot be interrupted, and a normal exit would wait for it.
        # Everything is logged at this point, so leave right away with the signal's exit code.
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(stop_signals.exit_code)
    return code


if __name__ == "__main__":
    sys.exit(main())
