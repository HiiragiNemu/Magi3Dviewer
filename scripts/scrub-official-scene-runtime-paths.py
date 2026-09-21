#!/usr/bin/env python3
"""Replace host-absolute evidence strings in published scene profiles."""

from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
from pathlib import Path
from typing import Any


BROWSER_UNSAFE_PATH = re.compile(r"[A-Za-z]:[\\/]")
URI_WITH_SLASHES = re.compile(r"\b([A-Za-z][A-Za-z0-9+.-]*):/{1,2}")
WINDOWS_HOST_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/][^'\"\r\n)\]}]+")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def unsafe_values(value: Any, path: str = "$") -> list[tuple[str, str]]:
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            found.extend(unsafe_values(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(unsafe_values(child, f"{path}[{index}]"))
    elif isinstance(value, str) and BROWSER_UNSAFE_PATH.search(value):
        found.append((path, value))
    return found


def scrub_strings(value: Any) -> tuple[Any, int]:
    if isinstance(value, dict):
        output = {}
        changes = 0
        for key, child in value.items():
            output[key], count = scrub_strings(child)
            changes += count
        return output, changes
    if isinstance(value, list):
        output = []
        changes = 0
        for child in value:
            scrubbed, count = scrub_strings(child)
            output.append(scrubbed)
            changes += count
        return output, changes
    if not isinstance(value, str):
        return value, 0
    scrubbed = URI_WITH_SLASHES.sub(r"\1:", value)
    scrubbed = WINDOWS_HOST_PATH.sub("<host-path>", scrubbed)
    return scrubbed, int(scrubbed != value)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--backup-root", type=Path)
    args = parser.parse_args()
    repo = args.repo_root.resolve()
    profiles = sorted((repo / "public/stages/official").glob("*/scene-profile.json"))
    changed = 0
    for profile_path in profiles:
        profile = read_json(profile_path)
        original = copy.deepcopy(profile)
        source_records = profile.setdefault("sourceRecords", {})
        stage_id = str(profile.get("stageId") or profile_path.parent.name)
        closure_manifest = source_records.get("closureManifest")
        if isinstance(closure_manifest, str) and re.match(r"^[A-Za-z]:[\\/]", closure_manifest):
            source_records["closureManifest"] = (
                f"authority:official-scene-profile/{stage_id}"
            )
            changed += 1
        beam_evidence = source_records.get("volumetricLightBeamConfig")
        if isinstance(beam_evidence, dict):
            source = beam_evidence.get("source")
            if isinstance(source, str) and re.match(r"^[A-Za-z]:[\\/]", source):
                beam_evidence["source"] = "repository:official-player-data/resources.assets"
                changed += 1
        runtime_beam = (profile.get("runtime") or {}).get("volumetricLightBeamConfig")
        if isinstance(runtime_beam, dict):
            source = runtime_beam.get("source")
            if isinstance(source, str) and re.match(r"^[A-Za-z]:[\\/]", source):
                runtime_beam["source"] = "repository:official-player-data/resources.assets"
                changed += 1
        profile, string_changes = scrub_strings(profile)
        changed += string_changes
        remaining = unsafe_values(profile)
        if remaining:
            raise ValueError(f"Absolute runtime evidence remains in {profile_path}: {remaining}")
        if profile != original and args.backup_root:
            backup_path = args.backup_root.resolve() / profile_path.relative_to(repo)
            if not backup_path.exists():
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(profile_path, backup_path)
        write_json(profile_path, profile)

    reopened = []
    for profile_path in profiles:
        reopened.extend(
            (str(profile_path), path, value)
            for path, value in unsafe_values(read_json(profile_path))
        )
    if reopened:
        raise RuntimeError(reopened)
    print(
        json.dumps(
            {
                "profilesReopened": len(profiles),
                "absoluteValuesReplaced": changed,
                "absoluteRuntimePathsRemaining": len(reopened),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
