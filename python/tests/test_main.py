import json
import os
import tempfile
import threading
import unittest
from types import SimpleNamespace

from tests.helpers import LocalServer, MemoryLog
from uptime_job.main import EXIT_CONFIG, EXIT_FAILURE, EXIT_SUCCESS, run
from uptime_job.state import diff_state


class RunTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.local = LocalServer().__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.local.__exit__(None, None, None)

    def setUp(self):
        self.local.requests.clear()
        self.state_dir = tempfile.mkdtemp(prefix="uptime-job-")

    def tearDown(self):
        for root, dirs, files in os.walk(self.state_dir, topdown=False):
            for name in files:
                os.unlink(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
        os.rmdir(self.state_dir)

    def run_job(self, env, **kwargs):
        log = MemoryLog()
        code = run({"MAX_ATTEMPTS": "1", **env}, log=log.logger, **kwargs)
        return code, log.lines

    def url(self, *paths):
        return ",".join(f"{self.local.base}{path}" for path in paths)

    def test_exits_0_when_every_target_is_up(self):
        code, lines = self.run_job({"TARGET_URLS": self.url("/ok")})

        self.assertEqual(code, EXIT_SUCCESS)
        self.assertEqual((lines[-1]["msg"], lines[-1]["down"]), ("job finished", 0))

    def test_exits_1_when_a_target_is_down_unless_fail_on_down_is_false(self):
        env = {"TARGET_URLS": self.url("/ok", "/missing")}

        self.assertEqual(self.run_job(env)[0], EXIT_FAILURE)
        self.assertEqual(self.run_job({**env, "FAIL_ON_DOWN": "false"})[0], EXIT_SUCCESS)

    def test_exits_2_on_invalid_configuration(self):
        code, lines = self.run_job({"TARGET_URLS": ""})

        self.assertEqual(code, EXIT_CONFIG)
        self.assertEqual(lines[0]["level"], "error")
        self.assertIn("TARGET_URLS is required", lines[0]["reason"])

    def test_keeps_state_between_runs_and_reports_status_changes_to_the_webhook(self):
        env = {"STATE_DIR": self.state_dir, "WEBHOOK_URL": self.url("/hook"), "FAIL_ON_DOWN": "false"}

        self.run_job({**env, "TARGET_URLS": self.url("/ok")})
        self.assertFalse([r for r in self.local.requests if r["path"] == "/hook"])

        with open(os.path.join(self.state_dir, "uptime-state.json"), encoding="utf-8") as file:
            self.assertTrue(json.load(file)["targets"][self.url("/ok")]["ok"])

        _, lines = self.run_job({**env, "TARGET_URLS": self.url("/ok", "/missing")})
        hook = next(r for r in self.local.requests if r["path"] == "/hook")
        self.assertRegex(json.loads(hook["body"])["text"], r"DOWN .*/missing")
        self.assertTrue(any(line["msg"] == "notification sent" for line in lines))
        self.assertNotIn("/hook", json.dumps(lines))

    def test_diff_state_reports_up_down_transitions_only(self):
        previous = {"targets": {"a": {"ok": True}, "b": {"ok": False}, "c": {"ok": True}}}
        results = [SimpleNamespace(url=url, ok=ok) for url, ok in [("a", False), ("b", True), ("c", True), ("d", False)]]

        self.assertEqual(diff_state(previous, results), [
            {"url": "a", "from": "up", "to": "down"},
            {"url": "b", "from": "down", "to": "up"},
        ])
        self.assertEqual(diff_state(None, results), [])

    def test_a_failing_webhook_fails_the_run(self):
        code, lines = self.run_job({
            "TARGET_URLS": self.url("/missing"),
            "WEBHOOK_URL": self.url("/hook-fail"),
            "FAIL_ON_DOWN": "false",
        })

        self.assertEqual(code, EXIT_FAILURE)
        failure = next(line for line in lines if line["msg"] == "notification failed")
        self.assertIn("500", failure["reason"])

    def test_an_unusable_state_directory_is_logged_and_does_not_fail_the_run(self):
        # A path below a regular file can never be created as a directory.
        not_a_directory = os.path.join(self.state_dir, "not-a-directory")
        open(not_a_directory, "w").close()

        code, lines = self.run_job({"TARGET_URLS": self.url("/ok"), "STATE_DIR": os.path.join(not_a_directory, "state")})

        self.assertEqual(code, EXIT_SUCCESS)
        self.assertTrue(any(line["msg"] == "could not use the state directory" for line in lines))

    def test_a_stop_signal_ends_the_run_as_a_failure(self):
        stop = threading.Event()
        threading.Timer(0.05, stop.set).start()

        code, lines = self.run_job({"TARGET_URLS": self.url("/slow")}, stop=stop)

        self.assertEqual(code, EXIT_FAILURE)
        self.assertTrue(any(line["msg"] == "job cancelled before finishing" for line in lines))

    def test_the_job_deadline_stops_a_run_that_takes_too_long(self):
        code, lines = self.run_job({"TARGET_URLS": self.url("/slow")}, deadline_seconds=0.05)

        self.assertEqual(code, EXIT_FAILURE)
        self.assertTrue(any(line["msg"] == "job deadline exceeded" for line in lines))


if __name__ == "__main__":
    unittest.main()
