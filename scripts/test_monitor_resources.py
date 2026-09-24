import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("monitor", Path(__file__).with_name("monitor-resources.py"))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorTest(unittest.TestCase):
    def setUp(self):
        self.backups = patch.object(monitor, "backup_stats", return_value={
            "last_success_age_hours": 1, "last_attempt_ok": True, "local_archive_present": True})
        self.backups.start()

    def tearDown(self):
        self.backups.stop()

    def test_backup_failure_and_staleness_are_reported(self):
        with patch.object(monitor, "docker_stats", return_value={"familycard-web": {"memory_bytes": 1}}), \
             patch.object(monitor, "database_stats", return_value={"connections": 0, "idle_in_transaction": 0}), \
             patch.object(monitor, "health_stats", return_value={"status": 200}), \
             patch.object(monitor, "backup_stats", return_value={"last_success_age_hours": 36, "last_attempt_ok": False, "local_archive_present": False}):
            value = monitor.snapshot()
        self.assertIn("backup_older_than_36_hours", value["warnings"])
        self.assertIn("last_backup_failed", value["warnings"])
        self.assertIn("backup_archive_missing_or_size_changed", value["warnings"])

    def test_units(self):
        self.assertEqual(monitor.memory_bytes("1.5GiB"), 1610612736)
        self.assertEqual(monitor.memory_bytes("67MiB"), 70254592)
        with self.assertRaises(ValueError):
            monitor.memory_bytes("unknown")

    def test_failed_probes_are_not_zero_or_exception_text(self):
        with patch.object(monitor, "command", side_effect=RuntimeError("PRIVATE")), \
             patch.object(monitor, "health_stats", side_effect=OSError("SECRET")):
            value = monitor.snapshot()
        self.assertIsNone(value["containers"])
        self.assertIsNone(value["database"])
        self.assertTrue({"containers_probe_failed", "database_probe_failed", "health_probe_failed"}.issubset(value["errors"]))
        self.assertNotIn("PRIVATE", json.dumps(value))
        self.assertNotIn("SECRET", json.dumps(value))

    def test_partial_container_stats_not_reported_as_complete(self):
        with patch.object(monitor, "command", return_value='{"Name":"familycard-web","MemUsage":"1MiB / 2GiB","CPUPerc":"0%","PIDs":"2"}'):
            with self.assertRaises(ValueError):
                monitor.docker_stats()

    def test_metrics_retention_does_not_touch_backups_or_arbitrary_files(self):
        with tempfile.TemporaryDirectory() as root, patch.object(monitor, "ROOT", Path(root)):
            folder = Path(root) / "data" / "monitoring"
            folder.mkdir(parents=True)
            (folder / "2000-01-01.jsonl").write_text("{}")
            (folder / "backup.dump").write_text("preserve")
            monitor.record({"schema": 1})
            self.assertFalse((folder / "2000-01-01.jsonl").exists())
            self.assertEqual((folder / "backup.dump").read_text(), "preserve")
            self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
            for file in folder.glob("*.jsonl"):
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)

    def test_alerts_report_limits_without_message_data(self):
        with patch.object(monitor, "docker_stats", return_value={"familycard-web": {"memory_bytes": 1024**3}}), \
             patch.object(monitor, "database_stats", return_value={"connections": 20, "idle_in_transaction": 1}), \
             patch.object(monitor, "health_stats", return_value={"status": 200, "latency_ms": 1}):
            value = monitor.snapshot()
        self.assertIn("web_memory_at_least_512_mib", value["warnings"])
        self.assertIn("database_connections_at_least_20", value["warnings"])
        self.assertIn("database_idle_in_transaction", value["warnings"])


if __name__ == "__main__":
    unittest.main()
