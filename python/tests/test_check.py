import threading
import unittest

from tests.helpers import LocalServer
from uptime_job.check import Stopped, check_target


def no_backoff(_attempt):
    return 0


class CheckTargetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.local = LocalServer().__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.local.__exit__(None, None, None)

    def check(self, path, **overrides):
        options = {"request_timeout_ms": 1000, "max_attempts": 3, "stop": threading.Event(), "backoff": no_backoff}
        return check_target(f"{self.local.base}{path}", **{**options, **overrides})

    def test_a_2xx_answer_is_up_after_one_attempt(self):
        result = self.check("/ok")

        self.assertEqual((result.ok, result.status, result.attempts, result.error), (True, 200, 1, None))

    def test_a_retryable_status_is_tried_again_up_to_the_limit(self):
        result = self.check("/unavailable")

        self.assertEqual((result.ok, result.status, result.attempts, result.error), (False, 503, 3, "HTTP 503"))

    def test_a_non_retryable_status_fails_without_retrying(self):
        result = self.check("/missing")

        self.assertEqual((result.ok, result.status, result.attempts), (False, 404, 1))

    def test_a_slow_target_times_out(self):
        result = self.check("/slow", request_timeout_ms=100, max_attempts=1)

        self.assertEqual((result.ok, result.status, result.error), (False, None, "timeout after 100 ms"))

    def test_an_unreachable_target_is_down(self):
        result = check_target("http://127.0.0.1:9/", request_timeout_ms=500, max_attempts=1, stop=threading.Event())

        self.assertFalse(result.ok)
        self.assertIsNone(result.status)
        self.assertTrue(result.error)

    def test_a_stopped_job_stops_checking_instead_of_reporting_the_target_as_down(self):
        stop = threading.Event()
        stop.set()

        with self.assertRaises(Stopped):
            self.check("/ok", stop=stop)
