import unittest

from uptime_job.config import Config, ConfigError, load_config


class LoadConfigTest(unittest.TestCase):
    def test_applies_defaults_and_removes_duplicate_targets(self):
        config = load_config({"TARGET_URLS": "https://example.com, https://example.com,http://example.org"})

        self.assertEqual(config, Config(targets=["https://example.com", "http://example.org"]))

    def test_reads_every_optional_setting(self):
        config = load_config({
            "TARGET_URLS": "https://example.com",
            "REQUEST_TIMEOUT_MS": "2500",
            "MAX_ATTEMPTS": "1",
            "CONCURRENCY": "2",
            "JOB_DEADLINE_SECONDS": "60",
            "FAIL_ON_DOWN": "false",
            "WEBHOOK_URL": "https://hooks.example.com/abc",
            "STATE_DIR": "/data",
        })

        self.assertEqual(config, Config(
            targets=["https://example.com"],
            request_timeout_ms=2500,
            max_attempts=1,
            concurrency=2,
            deadline_seconds=60,
            fail_on_down=False,
            webhook_url="https://hooks.example.com/abc",
            state_dir="/data",
        ))

    def test_rejects_invalid_settings_with_a_clear_message(self):
        cases = [
            ({}, "TARGET_URLS is required"),
            ({"TARGET_URLS": "not a url"}, "only accepts http"),
            ({"TARGET_URLS": "https://"}, "invalid URL"),
            ({"TARGET_URLS": "https://example.com", "MAX_ATTEMPTS": "0"}, "MAX_ATTEMPTS must be an integer between 1 and 5"),
            ({"TARGET_URLS": "https://example.com", "REQUEST_TIMEOUT_MS": "30000"}, "REQUEST_TIMEOUT_MS"),
            ({"TARGET_URLS": "https://example.com", "JOB_DEADLINE_SECONDS": "abc"}, "JOB_DEADLINE_SECONDS"),
            ({"TARGET_URLS": "https://example.com", "FAIL_ON_DOWN": "maybe"}, "FAIL_ON_DOWN must be true or false"),
            ({"TARGET_URLS": ",".join(f"https://e{i}.com" for i in range(51))}, "at most 50"),
        ]
        for env, message in cases:
            with self.subTest(env=env), self.assertRaisesRegex(ConfigError, message):
                load_config(env)
