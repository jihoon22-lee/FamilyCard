#!/usr/bin/env python3
"""Verify a same-key APK update before the single final version publication. Does not publish."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def output(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode:
        raise ValueError("apk_tool_failed")
    return result.stdout


def read_apk(path, tools):
    certificate = output([str(tools / "apksigner"), "verify", "--print-certs", str(path)])
    digests = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})", certificate)
    if not digests:
        raise ValueError("missing_signer")
    badging = output([str(tools / "aapt"), "dump", "badging", str(path)])
    package = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", badging, re.M)
    if not package:
        raise ValueError("missing_package_metadata")
    with path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    return {"applicationId": package[1], "versionCode": int(package[2]), "versionName": package[3],
            "signers": sorted(value.lower() for value in digests), "sha256": digest}


def compare(installed, candidate):
    errors = []
    if installed["applicationId"] != candidate["applicationId"]:
        errors.append("application_id_changed")
    if installed["signers"] != candidate["signers"]:
        errors.append("signing_certificate_changed")
    if candidate["versionCode"] <= installed["versionCode"]:
        errors.append("version_code_not_increased")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("installed", type=Path, help="last published APK, kept as the update baseline")
    parser.add_argument("candidate", type=Path, help="candidate APK built after the one final version bump")
    parser.add_argument("--build-tools", type=Path, required=True, help="Android SDK build-tools directory")
    args = parser.parse_args()
    try:
        baseline = read_apk(args.installed, args.build_tools)
        candidate = read_apk(args.candidate, args.build_tools)
        errors = compare(baseline, candidate)
        print(json.dumps({"compatible": not errors, "errors": errors, "baselineVersionCode": baseline["versionCode"],
                          "candidateVersionCode": candidate["versionCode"], "candidateSha256": candidate["sha256"]}))
        return 1 if errors else 0
    except (OSError, ValueError, subprocess.SubprocessError):
        print(json.dumps({"compatible": False, "errors": ["apk_verification_failed"]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
