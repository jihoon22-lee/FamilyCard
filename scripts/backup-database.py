#!/usr/bin/env python3
"""Create a private, verified-format PostgreSQL archive without printing data or credentials."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent


def run_dump(handle):
    result = subprocess.run(["docker", "exec", "familycard-db", "sh", "-c",
        'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl'],
        stdout=handle, stderr=subprocess.DEVNULL, timeout=1800, check=False)
    if result.returncode:
        raise RuntimeError("dump_failed")


def check_archive(path):
    # TOC verifies archive readability, not a full restore. Keep that distinction in reports.
    with path.open("rb") as handle:
        result = subprocess.run(["docker", "exec", "-i", "familycard-db", "pg_restore", "--list"],
            stdin=handle, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=300, check=False)
    if result.returncode:
        raise RuntimeError("archive_check_failed")


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_json(path, value):
    fd, name = tempfile.mkstemp(prefix=".backup-status-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w") as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(value, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def backup():
    directory = ROOT / "data" / "backups"
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    if directory.is_symlink():
        raise OSError("symlink_backup_directory")
    directory.chmod(0o700)
    lock_fd = os.open(directory / ".backup.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "w") as lock:
        os.fchmod(lock.fileno(), 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"ok": False, "error": "backup_already_running"}
        started = time.monotonic()
        now = dt.datetime.now(dt.timezone.utc)
        result = {"ok": False, "attempted_at": now.isoformat()}
        temporary = None
        try:
            if shutil.disk_usage(directory).free < 1024**3:
                raise RuntimeError("insufficient_disk_space")
            fd, name = tempfile.mkstemp(prefix=".incomplete-", suffix=".dump", dir=directory)
            temporary = Path(name)
            with os.fdopen(fd, "wb") as handle:
                os.fchmod(handle.fileno(), 0o600)
                run_dump(handle)
                handle.flush()
                os.fsync(handle.fileno())
            if temporary.stat().st_size == 0:
                raise RuntimeError("empty_archive")
            check_archive(temporary)
            with temporary.open("rb") as handle:
                digest = hashlib.file_digest(handle, "sha256").hexdigest()
            target = directory / ("familycard-auto-" + now.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:12] + ".dump")
            # Exclusive hard-link publication: even a naming collision never overwrites a backup.
            os.link(temporary, target)
            temporary.unlink()
            temporary = None
            sync_directory(directory)
            result.update(ok=True, archive=target.name, bytes=target.stat().st_size,
                          sha256=digest, archive_readable=True, restore_verified=False)
            atomic_json(directory / "last-success.json", result)
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            allowed = {"dump_failed", "archive_check_failed", "insufficient_disk_space", "empty_archive"}
            result.update(ok=False, error=str(error) if str(error) in allowed else "backup_failed")
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        result["duration_seconds"] = round(time.monotonic() - started, 2)
        atomic_json(directory / "last-attempt.json", result)
        return result


def main():
    try:
        result = backup()
    except (OSError, RuntimeError):
        result = {"ok": False, "error": "backup_status_write_failed"}
    # No archive contents, object names, database identity, credentials or stderr are exposed.
    print(json.dumps({key: value for key, value in result.items() if key not in {"archive", "sha256"}}))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
