#!/usr/bin/env python3
"""Backfill authority-derived stable keys in legacy modular stage entries."""

from __future__ import annotations

import json
import re
from pathlib import Path


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    public = repo / "public"
    visited: set[Path] = set()
    changed: list[dict[str, str]] = []

    def public_reference(reference: str) -> Path:
        value = reference.replace("\\", "/")
        if value.startswith("./"):
            value = value[2:]
        target = (public / value).resolve()
        target.relative_to(public.resolve())
        return target

    def stable_key(stage: dict[str, object]) -> str:
        existing = stage.get("stableKey")
        if isinstance(existing, str) and existing.strip():
            return existing
        bundle = stage.get("assetBundleName")
        if not isinstance(bundle, str) or not bundle.strip():
            raise RuntimeError(f"Stage has no authority bundle key: {stage.get('id')}")
        return f"AssetBundles/{bundle.strip().lstrip('/')}"

    def insert_key(path: Path, stage: dict[str, object]) -> None:
        if isinstance(stage.get("stableKey"), str) and str(stage["stableKey"]).strip():
            return
        stage_id = str(stage.get("id") or "")
        if not stage_id:
            raise RuntimeError(f"Stage has no id in {path}")
        key = stable_key(stage)
        text = path.read_bytes().decode("utf-8")
        pattern = re.compile(
            rf'^(?P<indent>\s*)"id":\s*"{re.escape(stage_id)}",(?P<newline>\r?\n)',
            re.MULTILINE,
        )
        matches = list(pattern.finditer(text))
        if len(matches) != 1:
            raise RuntimeError(f"Expected one id line for {stage_id} in {path}")
        match = matches[0]
        insertion = (
            match.group(0)
            + f'{match.group("indent")}"stableKey": {json.dumps(key)},'
            + match.group("newline")
        )
        path.write_bytes((text[:match.start()] + insertion + text[match.end():]).encode("utf-8"))
        changed.append({"path": str(path), "id": stage_id, "stableKey": key})

    def visit_catalog(path: Path) -> None:
        path = path.resolve()
        if path in visited:
            return
        visited.add(path)
        catalog = json.loads(path.read_text(encoding="utf-8"))
        for stage in catalog.get("stages", []):
            insert_key(path, stage)
        for reference in catalog.get("entries", []):
            entry_path = public_reference(reference)
            entry = json.loads(entry_path.read_text(encoding="utf-8"))
            insert_key(entry_path, entry)
        for reference in catalog.get("catalogs", []):
            visit_catalog(public_reference(reference))

    visit_catalog(public / "stages/catalog.json")
    result = {
        "schema": "magius.legacy-stage-stable-key-backfill.v1",
        "catalogsVisited": len(visited),
        "changed": changed,
        "changedCount": len(changed),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
