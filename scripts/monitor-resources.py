#!/usr/bin/env python3
"""Read-only FamilyCard resource observations. Never read messages, credentials or logs."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CONTAINERS = ("familycard-web", "familycard-db")
SQL = """SELECT json_build_object(
'database_bytes', pg_database_size(current_database()),
'connections', count(*),
'active_connections', count(*) FILTER (WHERE state = 'active'),
'idle_in_transaction', count(*) FILTER (WHERE state = 'idle in transaction')
) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();"""


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=20, check=False)
    if result.returncode:
        # stderr can contain environment details; do not persist or print it.
        raise RuntimeError("probe_failed")
    return result.stdout


def memory_bytes(value):
    match = re.fullmatch(r"\s*([\d.]+)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*", value)
    if not match:
        raise ValueError("invalid_memory_unit")
    factors = {"B": 1, "kB": 1000, "KB": 1000, "MB": 1000**2, "GB": 1000**3,
               "TB": 1000**4, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}
    return int(float(match[1]) * factors[match[2]])


def docker_stats():
    lines = command(["docker", "stats", "--no-stream", "--format", "{{json .}}", *CONTAINERS])
    rows = {}
    for line in lines.splitlines():
        item = json.loads(line)
        name = item["Name"]
        if name not in CONTAINERS:
            continue
        rows[name] = {"memory_bytes": memory_bytes(item["MemUsage"].split("/")[0]),
                      "cpu_percent": float(item["CPUPerc"].rstrip("%")), "pids": int(item["PIDs"])}
    if set(rows) != set(CONTAINERS):
        raise ValueError("missing_container_stats")
    return rows


def database_stats():
    # Variable expansion occurs inside the existing container; no secrets in argv/output.
    result = command(["docker", "exec", "familycard-db", "sh", "-c",
                      'exec psql -X -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"',
                      "monitor", SQL])
    values = json.loads(result)
    keys = ("database_bytes", "connections", "active_connections", "idle_in_transaction")
    if any(type(values.get(key)) is not int or values[key] < 0 for key in keys):
        raise ValueError("invalid_database_metrics")
    return {key: values[key] for key in keys}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def health_stats():
    started = time.monotonic()
    # Ignore inherited proxy settings and do not follow a redirect to another origin.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open("http://127.0.0.1:3000/api/health", timeout=10) as response:
        if response.status != 200:
            raise ValueError("health_failed")
    return {"status": 200, "latency_ms": round((time.monotonic() - started) * 1000)}


def backup_stats():
    directory = ROOT / "data" / "backups"
    def read_status(name):
        with (directory / name).open() as handle:
            value = handle.read(4097)
        if len(value) > 4096:
            raise ValueError("invalid_backup_status")
        return json.loads(value)
    success = read_status("last-success.json")
    attempt = read_status("last-attempt.json")
    filename = success.get("archive", "")
    if not re.fullmatch(r"familycard-auto-\d{8}T\d{6}Z-[a-f0-9]{12}\.dump", filename):
        raise ValueError("invalid_backup_reference")
    created = dt.datetime.fromisoformat(success["attempted_at"])
    age = (dt.datetime.now(dt.timezone.utc) - created).total_seconds()
    if age < -300:
        raise ValueError("future_backup_status")
    archive = directory / filename
    return {"last_success_age_hours": round(max(0, age) / 3600, 2),
            "last_attempt_ok": attempt.get("ok") is True,
            "local_archive_present": not archive.is_symlink() and archive.is_file() and archive.stat().st_size == success["bytes"]}


def snapshot():
    output = {"schema": 1, "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
              "errors": [], "warnings": []}
    for name, probe in (("containers", docker_stats), ("database", database_stats), ("health", health_stats), ("backups", backup_stats)):
        try:
            output[name] = probe()
        except (OSError, RuntimeError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            output[name] = None
            output["errors"].append(name + "_probe_failed")
    try:
        disk = shutil.disk_usage(ROOT)
        output["workspace_disk"] = {"total_bytes": disk.total, "free_bytes": disk.free}
        if disk.free < disk.total * 0.2:
            output["warnings"].append("workspace_disk_free_below_20_percent")
    except OSError:
        output["workspace_disk"] = None
        output["errors"].append("disk_probe_failed")
    if output["containers"] and output["containers"]["familycard-web"]["memory_bytes"] >= 512 * 1024**2:
        output["warnings"].append("web_memory_at_least_512_mib")
    if output["backups"]:
        if output["backups"]["last_success_age_hours"] >= 36:
            output["warnings"].append("backup_older_than_36_hours")
        if not output["backups"]["last_attempt_ok"]:
            output["warnings"].append("last_backup_failed")
        if not output["backups"]["local_archive_present"]:
            output["warnings"].append("backup_archive_missing_or_size_changed")
    if output["database"]:
        if output["database"]["connections"] >= 20:
            output["warnings"].append("database_connections_at_least_20")
        if output["database"]["idle_in_transaction"] > 0:
            output["warnings"].append("database_idle_in_transaction")
    return output


def record(value):
    directory = ROOT / "data" / "monitoring"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink():
        raise OSError("symlink_directory")
    directory.chmod(0o700)
    date = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    path = directory / (date + ".jsonl")
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a") as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(json.dumps(value, ensure_ascii=True) + "\n")
    # Metrics only: retain 90 days. Never touch RawMessage, backups or other filenames.
    cutoff = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=90)).isoformat()
    for old in directory.iterdir():
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.jsonl", old.name) and old.stem < cutoff and not old.is_symlink():
            old.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record", action="store_true", help="append private metrics in data/monitoring")
    args = parser.parse_args()
    result = snapshot()
    if args.record:
        try:
            record(result)
        except OSError:
            result["errors"].append("record_failed")
    print(json.dumps(result, ensure_ascii=True))
    return 1 if result["errors"] or result["warnings"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
