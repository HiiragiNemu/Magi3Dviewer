#!/usr/bin/env python3
"""Resolve an explicit client release to its authoritative Unity version.

This helper deliberately has no implicit JP/TW default.  It is safe to call
from extraction scripts because an unknown profile fails before a bundle is
opened.  Serialized-object version strings remain per-bundle fallbacks only.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "research" / "unity-release-profiles.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument(
        "--field",
        choices=("unityVersion", "json"),
        default="unityVersion",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    profiles = manifest.get("profiles", {})
    profile = profiles.get(args.profile)
    if not isinstance(profile, dict):
        choices = ", ".join(sorted(profiles))
        raise SystemExit(f"unknown release profile {args.profile!r}; choose one of: {choices}")
    if profile.get("selectable") is False:
        raise SystemExit(f"release profile {args.profile!r} is evidence-only and cannot drive extraction")
    if args.field == "json":
        print(json.dumps(profile, ensure_ascii=False, sort_keys=True))
    else:
        print(profile["unityVersion"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
