#!/usr/bin/env python3
"""Verify locally signed release assets against a committed public fingerprint manifest."""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("apk_preflight", Path(__file__).with_name("verify-apk-update.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


def validate(apk, metadata, pin):
    fields = ("applicationId", "versionCode", "versionName", "sha256")
    return all(apk.get(k) is not None and apk[k] == metadata.get(k) == pin.get(k) for k in fields) and bool(apk.get("signers")) and apk["signers"] == pin.get("signers")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("pin", type=Path)
    parser.add_argument("--build-tools", type=Path, required=True)
    args = parser.parse_args()
    try:
        apk = preflight.read_apk(args.apk, args.build_tools)
        metadata, pin = json.loads(args.metadata.read_text()), json.loads(args.pin.read_text())
        if not validate(apk, metadata, pin):
            raise ValueError("artifact_mismatch")
        if "application-debuggable" in preflight.output([str(args.build_tools / "aapt"), "dump", "badging", str(args.apk)]):
            raise ValueError("debuggable_release")
        print(json.dumps({"verified": True, "versionName": apk["versionName"], "versionCode": apk["versionCode"]}))
        return 0
    except Exception:
        print(json.dumps({"verified": False, "error": "release_artifact_verification_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
