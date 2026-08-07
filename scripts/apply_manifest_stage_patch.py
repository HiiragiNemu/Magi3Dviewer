#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

BRANCH_NOTE = "manifest-driven stage reconstruction"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_stages() -> None:
    path = Path("src/viewer/stages.ts")
    text = path.read_text(encoding="utf-8")

    if "from './stageBundleProvenance'" not in text:
        anchor = "} from './stageRuntime'\n"
        if anchor not in text:
            raise RuntimeError("stageRuntime import anchor missing")
        text = text.replace(
            anchor,
            anchor
            + "import {\n"
            + "    normalizeStageBundleProvenance,\n"
            + "    validateStageBundleProvenance,\n"
            + "    type StageBundleProvenance,\n"
            + "} from './stageBundleProvenance'\n",
            1,
        )

    if "bundleProvenance?: StageBundleProvenance" not in text:
        text = replace_once(
            text,
            "    assetBundleName?: string\n    type: 'procedural' | 'gltf' | 'fbx' | 'group'\n",
            "    assetBundleName?: string\n"
            "    /** Exact AssetBundle-manifest evidence retained with exported stages. */\n"
            "    bundleProvenance?: StageBundleProvenance\n"
            "    type: 'procedural' | 'gltf' | 'fbx' | 'group'\n",
            "StageDefinition provenance field",
        )

    validation_marker = "validateStageBundleProvenance(\n                    stage.bundleProvenance"
    if validation_marker not in text:
        old = """            const catalogStages = [
                ...(catalog.stages ?? []),
                ...modularStages,
            ].filter((stage, index, all) =>
                all.findIndex(candidate => candidate.id === stage.id) === index
            )
            definitions = [
"""
        new = """            const catalogStages = [
                ...(catalog.stages ?? []),
                ...modularStages,
            ].filter((stage, index, all) =>
                all.findIndex(candidate => candidate.id === stage.id) === index
            )
            for (const stage of catalogStages) {
                if (!stage.bundleProvenance) continue
                stage.bundleProvenance = normalizeStageBundleProvenance(
                    stage.bundleProvenance,
                )
                validateStageBundleProvenance(
                    stage.bundleProvenance,
                    stage.assetBundleName,
                )
            }
            definitions = [
"""
        text = replace_once(text, old, new, "catalog provenance validation")

    assignment = "stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null"
    if text.count(assignment) == 0:
        text = replace_once(
            text,
            "            stageRoot.userData.stageDefinition = definition\n"
            "            stageRoot.userData.stageDynamic = definition.dynamic ?? null\n",
            "            stageRoot.userData.stageDefinition = definition\n"
            "            stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null\n"
            "            stageRoot.userData.stageDynamic = definition.dynamic ?? null\n",
            "none-stage debug provenance",
        )
        text = replace_once(
            text,
            "        stageRoot.userData.stageDefinition = definition\n"
            "        stageRoot.userData.reDriveVolume = definition.renderProfile?.reDriveVolume ?? null\n",
            "        stageRoot.userData.stageDefinition = definition\n"
            "        stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null\n"
            "        stageRoot.userData.reDriveVolume = definition.renderProfile?.reDriveVolume ?? null\n",
            "loaded-stage debug provenance",
        )
    elif text.count(assignment) != 2:
        raise RuntimeError("expected exactly two runtime provenance assignments")

    path.write_text(text, encoding="utf-8")


def patch_catalog() -> None:
    path = Path("public/stages/catalog.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    corrections = {
        "battle-600-00-00-001": "battle/stage/bg_3d_600_00_00_001",
        "battle-600-00-01-001": "battle/stage/bg_3d_600_00_01_001",
        "battle-600-00-01-002": "battle/stage/bg_3d_600_00_01_002",
    }
    found = set()
    for stage in data.get("stages", []):
        stage_id = stage.get("id")
        if stage_id in corrections:
            stage["assetBundleName"] = corrections[stage_id]
            evidence = stage.setdefault("evidence", [])
            marker = "JP AssetBundles/Android manifest root identifier verified against ma-ex-dataSP"
            if marker not in evidence:
                evidence.append(marker)
            found.add(stage_id)
    missing = set(corrections) - found
    if missing:
        raise RuntimeError(f"catalog stages not found: {sorted(missing)}")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    patch_stages()
    patch_catalog()
    print(f"Applied {BRANCH_NOTE} patch")


if __name__ == "__main__":
    main()
