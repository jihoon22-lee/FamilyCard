import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("verify-release-apk.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseArtifactTest(unittest.TestCase):
    def test_pins_content_signer_and_all_update_metadata(self):
        apk = dict(applicationId="com.example.synthetic", versionCode=8, versionName="0.3.0", sha256="a" * 64, signers=["b" * 64])
        metadata = {k: v for k, v in apk.items() if k != "signers"}
        self.assertTrue(release.validate(apk, metadata, apk))
        for key, value in dict(applicationId="other", versionCode=7, versionName="wrong", sha256="c" * 64, signers=["d" * 64]).items():
            self.assertFalse(release.validate({**apk, key: value}, metadata, apk))
        self.assertFalse(release.validate(apk, {**metadata, "sha256": "wrong"}, apk))
        self.assertFalse(release.validate({}, {}, {}))
