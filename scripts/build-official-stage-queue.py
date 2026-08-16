#!/usr/bin/env python3
"""Build a fail-closed deployment queue from the audited official stage inventory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


COMPONENT_GATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("uv1-lightmaps", ("MeshRenderer",)),
    ("lights", ("Light",)),
    ("reflection-probes-cubemaps", ("ReflectionProbe", "Cubemap")),
    ("animator-clips", ("Animator", "AnimatorController", "AnimationClip")),
    ("particles", ("ParticleSystem",)),
    ("volume-and-custom-components", ("MonoBehaviour",)),
)


def positive_component_counts(components: dict[str, Any], names: tuple[str, ...]) -> dict[str, int]:
    return {
        name: int(components.get(name, 0))
        for name in names
        if int(components.get(name, 0)) > 0
    }


def build_gate(gate_id: str, evidence: dict[str, int]) -> dict[str, Any]:
    required = bool(evidence)
    return {
        "id": gate_id,
        "required": required,
        "status": "pending-raw-truth" if required else "not-required-by-inventory",
        "componentEvidence": evidence,
    }


def build_entry(candidate: dict[str, Any]) -> dict[str, Any]:
    components = candidate["components"]
    gates = [
        {
            "id": "manifest-closure",
            "required": True,
            "status": (
                "verified"
                if candidate["allClosureFilesPresentJP"]
                and candidate["closureFileCount"] == len(candidate["transitiveClosure"])
                else "blocked"
            ),
            "componentEvidence": {
                "files": candidate["closureFileCount"],
                "bytes": candidate["closureBytesJP"],
            },
        },
        {
            "id": "root-object-and-serialized-components",
            "required": True,
            "status": "pending-raw-truth",
            "componentEvidence": {
                "serializedFiles": candidate["serializedFilesLoaded"],
                "objects": candidate["targetObjectCount"],
            },
        },
        {
            "id": "geometry-material-carrier",
            "required": True,
            "status": "pending-export-and-hierarchy-verification",
            "componentEvidence": positive_component_counts(
                components, ("Mesh", "MeshFilter", "MeshRenderer", "Material")
            ),
        },
        {
            "id": "material-texture-pptr",
            "required": True,
            "status": "pending-raw-truth",
            "componentEvidence": positive_component_counts(components, ("Material", "Texture2D")),
        },
    ]
    gates.extend(
        build_gate(gate_id, positive_component_counts(components, names))
        for gate_id, names in COMPONENT_GATES
    )
    gates.append(
        {
            "id": "external-chrome-visual-regression",
            "required": True,
            "status": "blocked-by-product-gates",
            "componentEvidence": {},
        }
    )

    return {
        "priority": candidate["priority"],
        "sceneId": candidate["sceneId"],
        "bundle": candidate["bundle"],
        "expectedRootGameObject": candidate["expectedRootGameObject"],
        "manifest": {
            "key": candidate["manifestKey"],
            "hash128": candidate["manifestHash128"],
        },
        "closureReference": {
            "fileCount": candidate["closureFileCount"],
            "bytesJP": candidate["closureBytesJP"],
            "names": candidate["transitiveClosure"],
        },
        "rawRootIdentity": {
            "jpSha256": candidate["jpRootSha256"],
            "twByteIdentical": candidate["jpTwRootByteIdentical"],
        },
        "componentInventory": components,
        "gates": gates,
        "readyForDeployment": False,
        "nextAction": "extract-and-verify-raw-component-truth",
    }


def build_queue(source: dict[str, Any], limit: int | None) -> dict[str, Any]:
    candidates = source["candidates"]
    if limit is not None:
        if limit < 1:
            raise ValueError("--limit must be at least 1")
        candidates = candidates[:limit]

    entries = [build_entry(candidate) for candidate in candidates]
    return {
        "schemaVersion": 1,
        "sourceManifest": "research/next-official-stage-candidates.json",
        "releaseProfile": source["releaseProfile"],
        "unityVersion": source["unityVersion"],
        "policy": {
            "ordering": "preserve audited candidate priority",
            "payload": "references only; no AssetBundle, texture, mesh or scene payload copied",
            "readiness": "fail closed until every required product and visual gate is verified",
        },
        "summary": {
            "entryCount": len(entries),
            "readyForDeployment": sum(1 for entry in entries if entry["readyForDeployment"]),
            "pendingRawTruth": sum(1 for entry in entries if not entry["readyForDeployment"]),
            "closureBytesReferenced": sum(entry["closureReference"]["bytesJP"] for entry in entries),
        },
        "queue": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8"))
    queue = build_queue(source, args.limit)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {args.out}: entries={queue['summary']['entryCount']} "
        f"ready={queue['summary']['readyForDeployment']} "
        f"pending={queue['summary']['pendingRawTruth']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
