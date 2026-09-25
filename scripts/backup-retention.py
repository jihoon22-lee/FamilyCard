#!/usr/bin/env python3
"""Plan 7 daily / 4 weekly / 12 monthly backups; optional verified encrypted offsite copy."""
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import time
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PATTERN = re.compile(r"familycard-auto-(\d{8}T\d{6}Z)-[a-f0-9]{12}\.dump")
spec = importlib.util.spec_from_file_location("familycard_backup", Path(__file__).with_name("backup-database.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def retention_plan(paths, pinned=()):
    entries, protected = [], set(pinned)
    for path in paths:
        match = PATTERN.fullmatch(path.name)
        if not match or path.is_symlink():
            protected.add(path.name)
            continue
        date = dt.datetime.strptime(match[1], "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
        entries.append((date, path.name))
    entries.sort(reverse=True)
    keep = set(protected)
    for limit, bucket in ((7, lambda d: d.date()), (4, lambda d: d.isocalendar()[:2]),
                          (12, lambda d: (d.year, d.month))):
        seen = set()
        for date, name in entries:
            key = bucket(date)
            if key not in seen and len(seen) < limit:
                seen.add(key)
                keep.add(name)
    if entries:
        keep.add(entries[0][1])
    return {"keep": sorted(keep), "candidates": sorted(name for _, name in entries if name not in keep)}


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def gpg_arguments(passphrase, home):
    if passphrase.is_symlink() or not passphrase.is_file():
        raise RuntimeError("invalid_passphrase_file")
    if stat.S_IMODE(passphrase.stat().st_mode) & 0o077 or passphrase.stat().st_uid != os.getuid():
        raise RuntimeError("insecure_passphrase_file")
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    if home.is_symlink():
        raise RuntimeError("invalid_keyring_directory")
    return ["gpg", "--no-options", "--homedir", str(home), "--batch", "--yes", "--pinentry-mode", "loopback",
            "--no-symkey-cache", "--passphrase-file", str(passphrase)]


def decrypted_digest(path, arguments):
    process = subprocess.Popen([*arguments, "--decrypt", str(path)], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL)
    try:
        hasher = hashlib.sha256()
        deadline = time.monotonic() + 600
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("encrypted_copy_verification_timeout")
                if not selector.select(min(10, remaining)):
                    continue
                chunk = os.read(process.stdout.fileno(), 1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
        result = hasher.hexdigest()
        if process.wait(timeout=600):
            raise RuntimeError("encrypted_copy_verification_failed")
        return result
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.kill()
            process.wait()


def encrypted_copy(source, destination, passphrase, home):
    if source.is_symlink() or destination.is_symlink():
        raise RuntimeError("symlink_archive_rejected")
    expected = digest(source)
    arguments = gpg_arguments(passphrase, home)
    if destination.exists():
        if decrypted_digest(destination, arguments) != expected:
            raise RuntimeError("existing_encrypted_copy_mismatch")
        return expected
    fd, name = tempfile.mkstemp(prefix=".familycard-encrypted-", dir=destination.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        result = subprocess.run([*arguments, "--cipher-algo", "AES256", "--output", str(temporary),
                                 "--symmetric", str(source)], stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=600, check=False)
        if result.returncode or decrypted_digest(temporary, arguments) != expected:
            raise RuntimeError("encrypted_copy_verification_failed")
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        os.link(temporary, destination)  # Never overwrite an existing encrypted archive.
        backup.sync_directory(destination.parent)
        return expected
    finally:
        temporary.unlink(missing_ok=True)


def maintain():
    directory = ROOT / "data" / "backups"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink():
        raise RuntimeError("symlink_backup_directory")
    fd = os.open(directory / ".backup.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        pinned_file = directory / "pinned.json"
        pinned = json.loads(pinned_file.read_text()) if pinned_file.exists() else []
        if not isinstance(pinned, list) or any(not isinstance(n, str) or Path(n).name != n for n in pinned):
            raise RuntimeError("invalid_pinned_names")
        plan = retention_plan(directory.glob("*.dump"), pinned)
        result = {"configured": False, "ok": True, "attempted_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                  "kept": len(plan["keep"]), "prune_candidates": len(plan["candidates"]), "copied": 0, "pruned": 0}
        backup.atomic_json(directory / "retention-plan.json", plan)
        external = os.environ.get("FAMILYCARD_EXTERNAL_BACKUP_DIR")
        passphrase = os.environ.get("FAMILYCARD_BACKUP_PASSPHRASE_FILE")
        if not external and not passphrase:
            backup.atomic_json(directory / "offsite-last-attempt.json", result)
            return result
        result["configured"] = True
        try:
            if not external or not passphrase:
                raise RuntimeError("incomplete_offsite_configuration")
            destination = Path(external)
            if not destination.is_absolute() or destination.is_symlink() or not destination.is_dir():
                raise RuntimeError("invalid_external_directory")
            if destination.stat().st_dev == directory.stat().st_dev:
                raise RuntimeError("external_filesystem_required")
            names = sorted(p.name for p in directory.glob("*.dump") if PATTERN.fullmatch(p.name) and not p.is_symlink())
            # Preserve all local archives until every selected external copy is decrypt/hash verified.
            for name in names:
                encrypted_copy(directory / name, destination / (name + ".gpg"), Path(passphrase), ROOT / "data/secrets/gnupg")
                result["copied"] += 1
            if os.environ.get("FAMILYCARD_PRUNE_BACKUPS") == "true":
                for name in plan["candidates"]:
                    source = directory / name
                    if source.is_symlink() or not PATTERN.fullmatch(name):
                        raise RuntimeError("unsafe_prune_candidate")
                    # Re-verify immediately before pruning; pinned/manual archives never enter this set.
                    encrypted_copy(source, destination / (name + ".gpg"), Path(passphrase), ROOT / "data/secrets/gnupg")
                    source.unlink()
                    result["pruned"] += 1
                backup.sync_directory(directory)
            backup.atomic_json(directory / "offsite-last-success.json", result)
        except (OSError, RuntimeError, subprocess.SubprocessError):
            result.update(ok=False, error="offsite_backup_failed")
        backup.atomic_json(directory / "offsite-last-attempt.json", result)
        return result


if __name__ == "__main__":
    try:
        status = maintain()
    except (OSError, RuntimeError, ValueError):
        status = {"ok": False, "error": "retention_check_failed"}
    print(json.dumps(status))
    raise SystemExit(0 if status["ok"] else 1)
