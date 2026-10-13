import json
import os
import signal
import subprocess
import sys
import time
import unittest
from pathlib import Path

from tests.helpers import LocalServer, MemoryLog
from uptime_job.shutdown import FORCED_EXIT_AFTER_SECONDS, StopSignals

PROJECT_DIR = Path(__file__).resolve().parent.parent


class GracefulShutdownTest(unittest.TestCase):
    """Starts the real entry point, as Zenifra does, and stops it with a signal."""

    @classmethod
    def setUpClass(cls):
        cls.local = LocalServer().__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.local.__exit__(None, None, None)

    def start_job(self):
        env = {**os.environ, "TARGET_URLS": f"{self.local.base}/slow", "MAX_ATTEMPTS": "1"}
        child = subprocess.Popen(
            [sys.executable, "-m", "uptime_job"], cwd=PROJECT_DIR, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        first = json.loads(child.stdout.readline())
        self.assertEqual(first["msg"], "job started")
        return child

    def assert_graceful_stop(self, signum, expected_code):
        child = self.start_job()
        started_at = time.monotonic()

        child.send_signal(signum)
        stdout, _ = child.communicate(timeout=10)

        self.assertEqual(child.returncode, expected_code)
        self.assertLess(time.monotonic() - started_at, 2)
        lines = [json.loads(line) for line in stdout.splitlines()]
        self.assertEqual([line["msg"] for line in lines], ["stop signal received", "job cancelled before finishing"])
        self.assertEqual(lines[0]["signal"], signal.Signals(signum).name)

    def test_sigterm_stops_the_job_gracefully_and_exits_with_143(self):
        self.assert_graceful_stop(signal.SIGTERM, 143)

    def test_sigint_stops_the_job_gracefully_and_exits_with_130(self):
        self.assert_graceful_stop(signal.SIGINT, 130)


class ForcedExitTest(unittest.TestCase):
    def test_work_that_ignores_the_stop_request_is_cut_off_before_the_30_second_limit(self):
        exits = []
        stop_signals = StopSignals(MemoryLog().logger, forced_exit_after=0.05, exit=exits.append)

        stop_signals._handle(signal.SIGTERM, None)

        self.assertTrue(stop_signals.stop.is_set())
        self.assertEqual(stop_signals.exit_code, 143)
        time.sleep(0.2)
        self.assertEqual(exits, [143])
        self.assertLess(FORCED_EXIT_AFTER_SECONDS, 30)


if __name__ == "__main__":
    unittest.main()
