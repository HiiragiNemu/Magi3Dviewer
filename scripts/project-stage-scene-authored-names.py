#!/usr/bin/env python3
"""Project authored stage display names into the generated cross-region corpus.

The base corpus remains owned by its existing generation flow. This bounded
post-generation step owns only ``authoredScenes`` and deliberately validates
the catalog identity/fallback before checking or writing the product.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / "scripts/data/stage-scene-authored-names.v1.json"
DEFAULT_TARGET = REPO_ROOT / "public/stages/scene-name-cross-region.v1.json"
EXPECTED_SCHEMA = "magius.stage-scene-authored-name-projection.v1"


class ProjectionError(RuntimeError):
    pass


def read_utf8_json(path: Path) -> tuple[bytes, dict[str, Any]]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ProjectionError(f"read failed: {path}: {exc}") from exc
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ProjectionError(f"UTF-8 BOM is forbidden: {path}")
    try:
        decoded = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ProjectionError(f"invalid UTF-8: {path}: {exc}") from exc
    try:
        value = json.loads(decoded)
    except json.JSONDecodeError as exc:
        raise ProjectionError(f"invalid JSON: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ProjectionError(f"root JSON value must be an object: {path}")
    return raw, value


def deterministic_json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProjectionError(message)


def resolve_from_repo(path_value: str) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else REPO_ROOT / path


def validate_source(source_raw: bytes, source: dict[str, Any]) -> list[dict[str, Any]]:
    require(b"\r" not in source_raw, "source projection must use LF newlines")
    require(source.get("schema") == EXPECTED_SCHEMA, "unexpected source projection schema")
    require(source.get("version") == 1, "unexpected source projection version")
    require(source.get("encoding") == "UTF-8", "source projection encoding must be UTF-8")
    require(source.get("newline") == "LF", "source projection newline must be LF")
    authority = source.get("authority")
    require(isinstance(authority, dict), "source projection authority must be an object")
    require(authority.get("canonicalIdentityField") == "viewerStageId", "canonical identity must be viewerStageId")
    require(isinstance(authority.get("path"), str) and authority["path"], "authority path is required")
    require(isinstance(authority.get("jsonPointer"), str) and authority["jsonPointer"], "authority JSON pointer is required")

    entries = source.get("entries")
    require(isinstance(entries, list) and entries, "source projection entries must be a non-empty array")
    seen_ids: set[str] = set()
    seen_keys: set[str] = set()
    projections: list[dict[str, Any]] = []
    for index, entry in enumerate(entries):
        require(isinstance(entry, dict), f"entry[{index}] must be an object")
        viewer_id = entry.get("viewerStageId")
        stable_key = entry.get("stableKey")
        require(isinstance(viewer_id, str) and viewer_id, f"entry[{index}] viewerStageId is required")
        require(isinstance(stable_key, str) and stable_key, f"entry[{index}] stableKey is required")
        require(viewer_id not in seen_ids, f"duplicate viewerStageId: {viewer_id}")
        require(stable_key not in seen_keys, f"duplicate stableKey: {stable_key}")
        seen_ids.add(viewer_id)
        seen_keys.add(stable_key)

        names = entry.get("displayNames")
        require(isinstance(names, dict), f"entry[{index}] displayNames must be an object")
        require(isinstance(names.get("zhHant"), str) and names["zhHant"], f"entry[{index}] zhHant is required")
        require(isinstance(names.get("zhCN"), str) and names["zhCN"], f"entry[{index}] zhCN is required")

        projection = entry.get("productProjection")
        require(isinstance(projection, dict), f"entry[{index}] productProjection must be an object")
        require(projection.get("viewerStageId") == viewer_id, f"entry[{index}] projection identity mismatch")
        projection_names = projection.get("names")
        require(isinstance(projection_names, dict), f"entry[{index}] projection names must be an object")
        zh_hant = projection_names.get("zhHant")
        require(isinstance(zh_hant, dict), f"entry[{index}] projection zhHant must be an object")
        require(zh_hant.get("value") == names["zhHant"], f"entry[{index}] zhHant projection mismatch")
        require(zh_hant.get("available") is True, f"entry[{index}] zhHant must be available")
        require(zh_hant.get("quality") == "authored", f"entry[{index}] zhHant quality must be authored")

        lookup = projection.get("resourceLookup")
        require(isinstance(lookup, dict), f"entry[{index}] resourceLookup must be an object")
        direct_path = lookup.get("directRelativePath")
        require(stable_key == f"AssetBundles/{direct_path}", f"entry[{index}] stableKey/direct path mismatch")
        require(lookup.get("steamLogicalPath") == stable_key, f"entry[{index}] Steam key mismatch")

        catalog_path_value = entry.get("catalogPath")
        require(isinstance(catalog_path_value, str) and catalog_path_value, f"entry[{index}] catalogPath is required")
        _, catalog = read_utf8_json(resolve_from_repo(catalog_path_value))
        require(catalog.get("id") == viewer_id, f"entry[{index}] catalog id drift")
        require(catalog.get("stableKey") == stable_key, f"entry[{index}] catalog stableKey drift")
        require(catalog.get("name") == entry.get("catalogFallback"), f"entry[{index}] catalog fallback drift")
        projections.append(projection)
    return projections


def replace_authored_scenes(target: dict[str, Any], projections: list[dict[str, Any]]) -> dict[str, Any]:
    if "authoredScenes" in target:
        output = dict(target)
        output["authoredScenes"] = projections
        return output

    output: dict[str, Any] = {}
    inserted = False
    for key, value in target.items():
        output[key] = value
        if key == "dioramaScenes":
            output["authoredScenes"] = projections
            inserted = True
    if not inserted:
        raise ProjectionError("target has neither authoredScenes nor dioramaScenes insertion anchor")
    return output


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="verify the target (default)")
    mode.add_argument("--write", action="store_true", help="write the deterministic projection")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    mode = "write" if args.write else "check"
    source_path = args.source.resolve()
    target_path = args.target.resolve()
    try:
        source_raw, source = read_utf8_json(source_path)
        current_bytes, target = read_utf8_json(target_path)
        projections = validate_source(source_raw, source)
        expected = deterministic_json_bytes(replace_authored_scenes(target, projections))
        exact = current_bytes == expected
        mutated = False
        if mode == "write" and not exact:
            write_atomic(target_path, expected)
            reopened = target_path.read_bytes()
            require(reopened == expected, "target reopen differs after write")
            current_bytes = reopened
            exact = True
            mutated = True
        print(f"SCHEMA={EXPECTED_SCHEMA}")
        print(f"MODE={mode}")
        print(f"SOURCE_ENTRIES={len(projections)}")
        print(f"TARGET={target_path}")
        print(f"TARGET_BYTES={len(current_bytes)}")
        print("UTF8_LF=true")
        print(f"CATALOG_INVARIANTS={len(projections) * 3}/{len(projections) * 3}")
        print(f"MUTATION={str(mutated).lower()}")
        print(f"BYTE_EXACT={str(exact).lower()}")
        if not exact:
            print(f"EXPECTED_BYTES={len(expected)}", file=sys.stderr)
            return 1
        return 0
    except ProjectionError as exc:
        print(f"PROJECTION_ERROR={exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
