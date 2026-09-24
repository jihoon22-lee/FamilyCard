import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json
import fcntl

spec = importlib.util.spec_from_file_location("backup", Path(__file__).with_name("backup-database.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patch = patch.object(backup, "ROOT", self.root)
        self.patch.start()
        self.folder = self.root / "data" / "backups"

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def create(self, content=b"synthetic archive"):
        with patch.object(backup, "run_dump", side_effect=lambda f: f.write(content)), \
             patch.object(backup, "check_archive"):
            return backup.backup()

    def test_success_is_private_and_not_claimed_restored(self):
        result = self.create()
        self.assertTrue(result["ok"])
        self.assertFalse(result["restore_verified"])
        self.assertEqual((self.folder / result["archive"]).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.folder.stat().st_mode & 0o777, 0o700)

    def test_failed_dump_preserves_last_success_and_removes_partial(self):
        first = self.create()
        def fail(handle):
            handle.write(b"partial synthetic")
            raise RuntimeError("dump_failed")
        with patch.object(backup, "run_dump", side_effect=fail):
            failed = backup.backup()
        self.assertFalse(failed["ok"])
        self.assertEqual(json.loads((self.folder / "last-success.json").read_text())["archive"], first["archive"])
        self.assertEqual(len(list(self.folder.glob("*.dump"))), 1)
        self.assertFalse(list(self.folder.glob(".incomplete-*")))

    def test_archive_validation_failure_never_publishes(self):
        with patch.object(backup, "run_dump", side_effect=lambda f: f.write(b"bad")), \
             patch.object(backup, "check_archive", side_effect=RuntimeError("archive_check_failed")):
            self.assertFalse(backup.backup()["ok"])
        self.assertFalse(list(self.folder.glob("*.dump")))

    def test_repeated_success_never_overwrites(self):
        first, second = self.create(), self.create(b"second synthetic archive")
        self.assertNotEqual(first["archive"], second["archive"])
        self.assertEqual((self.folder / first["archive"]).read_bytes(), b"synthetic archive")

    def test_exception_text_is_not_recorded(self):
        with patch.object(backup, "run_dump", side_effect=OSError("SECRET credential")):
            result = backup.backup()
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertNotIn("SECRET", (self.folder / "last-attempt.json").read_text())

    def test_concurrent_run_is_rejected_without_changing_last_attempt(self):
        self.create()
        before = (self.folder / "last-attempt.json").read_bytes()
        with (self.folder / ".backup.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(backup.backup()["error"], "backup_already_running")
        self.assertEqual((self.folder / "last-attempt.json").read_bytes(), before)

    def test_low_disk_does_not_start_dump(self):
        with patch.object(backup.shutil, "disk_usage", return_value=type("Disk", (), {"free": 0})()), \
             patch.object(backup, "run_dump") as dump:
            self.assertEqual(backup.backup()["error"], "insufficient_disk_space")
            dump.assert_not_called()


if __name__ == "__main__":
    unittest.main()
