import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("preflight", Path(__file__).with_name("verify-apk-update.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class UpdatePreflightTest(unittest.TestCase):
    def setUp(self):
        self.old = {"applicationId": "com.example.synthetic", "signers": ["a" * 64], "versionCode": 7}

    def test_same_key_higher_version(self):
        self.assertEqual(preflight.compare(self.old, {**self.old, "versionCode": 8}), [])

    def test_same_or_lower_version_not_publishable(self):
        for value in (7, 6):
            self.assertIn("version_code_not_increased", preflight.compare(self.old, {**self.old, "versionCode": value}))

    def test_changed_key_is_not_treated_as_safe_overwrite(self):
        self.assertIn("signing_certificate_changed", preflight.compare(self.old, {**self.old, "versionCode": 8, "signers": ["b" * 64]}))

    def test_package_change_does_not_preserve_existing_installation(self):
        self.assertIn("application_id_changed", preflight.compare(self.old, {**self.old, "versionCode": 8, "applicationId": "com.example.other"}))


if __name__ == "__main__":
    unittest.main()
