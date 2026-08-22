#!/usr/bin/env python3
"""Build a compact, deterministic release gate from the full Home audits."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


BASELINE_101901 = {
    "sourceTransformPaths": 189,
    "runtimeTransformPaths": 184,
    "sourceBindings": 567,
    "runtimeTracks": 552,
    "missingTerminalPaths": 5,
    "maximumHairEdgeRatio": 7.906,
    "hairEdgesOver2": 624,
    "hairEdgesOver5": 15,
    "maximumFaceEdgeRatio": 1.302,
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-audit", type=Path, required=True)
    parser.add_argument("--skinning-audit", type=Path, required=True)
    parser.add_argument("--batch-build", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    source = read_json(args.source_audit)
    skinning = read_json(args.skinning_audit)
    batch = read_json(args.batch_build)
    source_by_id = {str(item["characterId"]): item for item in source["characters"]}
    skinning_by_id = {str(item["characterId"]): item for item in skinning["characters"]}
    if set(source_by_id) != set(skinning_by_id):
        raise SystemExit("source/skinning character sets differ")

    action_collisions = sum(len(item.get("actionFamilyCollisions", [])) for item in source["characters"])
    missing_terminal_paths = sum(len(item.get("missingTerminalPaths", [])) for item in source["characters"])
    parent_overwrites = sum(len(item.get("confirmedNearestParentOverwrites", [])) for item in source["characters"])
    geometry_warnings = []
    geometry_blockers = []
    characters = []
    for character_id in sorted(skinning_by_id):
        item = skinning_by_id[character_id]
        compact = {
            "characterId": character_id,
            "classification": item["classification"],
            "maximumHairEdgeRatio": item.get("maximumHairEdgeRatio"),
            "maximumFaceEdgeRatio": item.get("maximumFaceEdgeRatio"),
            "geometryWarningClips": item.get("geometryWarningClips", []),
            "geometryHardBlockerClips": item.get("geometryHardBlockerClips", []),
        }
        characters.append(compact)
        if item["classification"] == "native-visual-review":
            geometry_warnings.append(compact)
        if item.get("geometryHardBlockerClips"):
            geometry_blockers.append(compact)

    fixed = skinning_by_id["101901"]
    source_fixed = source_by_id["101901"]
    exact_clip_paths = sorted({
        (clip["rawTransformPathCount"], clip["runtimeTransformPathCount"])
        for clip in source_fixed.get("clips", [])
        if clip.get("strictExactPathSafe")
    })
    if exact_clip_paths != [(189, 189)]:
        raise SystemExit(f"101901 exact path closure changed: {exact_clip_paths}")

    skipped = [str(item["characterId"]) for item in batch["results"] if item["status"].startswith("SKIP_")]
    report = {
        "schema": "magia-home-animation-integrity-gate-v1",
        "releaseProfile": "jp-android-3.13.0",
        "unityVersion": "2022.3.62f2",
        "generatorContract": {
            "preserveAllNodes": True,
            "clipSelection": "exact-source-path-id",
            "targetBinding": "exact-character-local-path",
            "nearestParentFallback": False,
        },
        "batchBuild": {
            "requested": batch["requested"],
            "passed": batch["passed"],
            "skipped": batch["skipped"],
            "skippedCharacterIds": skipped,
        },
        "sourceBinding": {
            **source["summary"],
            "actionFamilyCollisionCount": action_collisions,
            "missingTerminalPathCount": missing_terminal_paths,
            "confirmedNearestParentOverwriteCountRecomputed": parent_overwrites,
        },
        "skinning": skinning["summary"],
        "character101901": {
            "before": BASELINE_101901,
            "after": {
                "sourceTransformPaths": 189,
                "runtimeTransformPaths": 189,
                "missingTerminalPaths": len(source_fixed.get("missingTerminalPaths", [])),
                "geometryWarningClips": fixed.get("geometryWarningClips", []),
                "geometryHardBlockerClips": fixed.get("geometryHardBlockerClips", []),
                "maximumHairEdgeRatio": fixed["maximumHairEdgeRatio"],
                "maximumFaceEdgeRatio": fixed["maximumFaceEdgeRatio"],
            },
        },
        "unresolved": [{
            "characterId": "100101",
            "reason": "official Home runtime source is absent from the local JP corpus",
        }],
        "geometryReviewWarnings": geometry_warnings,
        "geometryBlockers": geometry_blockers,
        "characters": characters,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "characters": len(characters),
        "strictSourceSafe": report["sourceBinding"]["strictSafeCount"],
        "geometryReviewWarnings": [item["characterId"] for item in geometry_warnings],
        "geometryBlockers": [item["characterId"] for item in geometry_blockers],
        "unresolved": skipped,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
