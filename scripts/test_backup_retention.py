import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("retention", Path(__file__).with_name("backup-retention.py"))
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class RetentionTest(unittest.TestCase):
    def test_buckets_keep_recent_daily_weekly_monthly_and_pins(self):
        paths = [Path("familycard-auto-" + (dt.datetime(2026, 9, 25) - dt.timedelta(days=i)).strftime("%Y%m%dT%H%M%SZ") + "-abcdef123456.dump") for i in range(500)]
        manual = Path("before-migration.dump")
        result = retention.retention_plan(paths + [manual], [paths[-1].name])
        self.assertIn(manual.name, result["keep"])
        self.assertIn(paths[-1].name, result["keep"])
        self.assertTrue(all(p.name in result["keep"] for p in paths[:7]))
        self.assertLess(len(result["keep"]), 30)
        self.assertEqual(len(result["keep"]) + len(result["candidates"]), 501)

    def test_unconfigured_is_plan_only_and_preserves_files(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(retention, "ROOT", Path(folder)), patch.dict(os.environ, {}, clear=True):
            directory = Path(folder) / "data/backups"
            directory.mkdir(parents=True)
            source = directory / "familycard-auto-20260925T000000Z-abcdef123456.dump"
            source.write_bytes(b"synthetic backup")
            result = retention.maintain()
            self.assertFalse(result["configured"])
            self.assertEqual(result["pruned"], 0)
            self.assertEqual(source.read_bytes(), b"synthetic backup")

    @unittest.skipUnless(shutil.which("gpg"), "gpg required")
    def test_encryption_roundtrip_is_idempotent_and_wrong_key_preserves_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, dest, key = root / "synthetic.dump", root / "synthetic.dump.gpg", root / "key"
            source.write_bytes(b"synthetic archive content" * 100)
            key.write_text("synthetic-test-key-only")
            key.chmod(0o600)
            retention.encrypted_copy(source, dest, key, root / "home")
            original_cipher = dest.read_bytes()
            retention.encrypted_copy(source, dest, key, root / "home")
            self.assertEqual(dest.read_bytes(), original_cipher)
            key.write_text("different-synthetic-key")
            with self.assertRaises(RuntimeError):
                retention.encrypted_copy(source, dest, key, root / "home")
            self.assertTrue(source.exists())
            self.assertEqual(dest.read_bytes(), original_cipher)

    def test_same_filesystem_cannot_enable_pruning(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(retention, "ROOT", Path(folder)):
            root = Path(folder)
            directory = root / "data/backups"
            directory.mkdir(parents=True)
            (root / "external").mkdir()
            source = directory / "familycard-auto-20260925T000000Z-abcdef123456.dump"
            source.write_bytes(b"synthetic backup")
            with patch.dict(os.environ, {"FAMILYCARD_EXTERNAL_BACKUP_DIR": str(root / "external"), "FAMILYCARD_BACKUP_PASSPHRASE_FILE": str(root / "key"), "FAMILYCARD_PRUNE_BACKUPS": "true"}):
                result = retention.maintain()
            self.assertFalse(result["ok"])
            self.assertTrue(source.exists())

class OffsiteStatusTest(unittest.TestCase):
    def test_error_details_do_not_expose_paths_or_keys(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(retention, "ROOT", Path(folder)):
            with patch.dict(os.environ, {"FAMILYCARD_EXTERNAL_BACKUP_DIR": "/synthetic-private-path", "FAMILYCARD_BACKUP_PASSPHRASE_FILE": "/synthetic-secret", "FAMILYCARD_PRUNE_BACKUPS": "true"}):
                result = retention.maintain()
            self.assertFalse(result["ok"])
            self.assertNotIn("synthetic-private", json.dumps(result))
            self.assertNotIn("synthetic-secret", json.dumps(result))
