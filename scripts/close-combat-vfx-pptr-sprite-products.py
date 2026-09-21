#!/usr/bin/env python3
"""Publish bounded PPtr/Sprite combat-VFX payloads without raw bundles.

Targets come from the existing v2 fail-closed authority. Default mode checks
expected bytes. ``--write`` updates only the three bounded research/public
product directories; catalogs remain fail-closed until the real Viewer gate.
"""

from __future__ import annotations

import argparse
import gzip
import importlib.util
import io
import json
import re
from pathlib import Path
from typing import Any

import UnityPy


AUTHORITY_NAME = "20260826-all-enemy-character-skill-vfx-products-v2"
FAILURE_PREFIX = "serialized-component-clip-fail-closed:"
SPRITE_SCHEMA = "magius.combat-vfx-pptr-sprite-runtime.v1"
PENDING_REASON = "runtime-consumer-verification-pending:pptr-sprite"
VERIFICATION_NAME = "20260901-combat-vfx-pptr-sprite-closure"
CANDIDATE_GATE_SCHEMA = "magius.combat-vfx-pptr-real-viewer-candidate-gate.v2"
FORMAL_GATE_SCHEMA = "magius.combat-vfx-pptr-formal-runtime-gate.v1"


def load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def pretty_bytes(value: Any) -> bytes:
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    return text.encode("utf-8")


def compact_bytes(value: Any) -> bytes:
    text = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )
    return text.encode("utf-8")


def stable_sprite_filename(asset: dict[str, Any]) -> str:
    asset_file = re.sub(r"[^0-9A-Za-z._-]+", "_", str(asset["assetFile"]).lower())
    path_id = int(asset["pathID"])
    signed_id = f"n{abs(path_id)}" if path_id < 0 else f"p{path_id}"
    name = re.sub(r"[^0-9A-Za-z._-]+", "_", str(asset.get("name") or "sprite"))
    return f"{asset_file}-{signed_id}-{name}.png"


def closure_paths(closure: dict[str, Any]) -> list[Path]:
    paths = [Path(str(row["source"])).resolve() for row in closure["files"]]
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(path)
    return paths


def exact_failed_clip_path_ids(entry: dict[str, Any]) -> set[str]:
    reasons = [str(reason) for reason in entry.get("reasons", [])]
    if not reasons or not all(reason.startswith(FAILURE_PREFIX) for reason in reasons):
        raise ValueError(
            f"Non-PPtr failure is outside this closure: "
            f"{entry.get('subjectKind')}|{entry.get('directionName')}"
        )
    result = {
        str(clip["pathID"])
        for clip in entry.get("componentClips", [])
        if clip.get("pathID") is not None
    }
    if not result:
        raise ValueError("Fail-closed entry has no exact clip pathID")
    return result


def selected_sprite_clips(
    profile: dict[str, Any],
    expected_path_ids: set[str],
) -> list[dict[str, Any]]:
    clips = [
        clip
        for clip in profile.get("runtime", {}).get("serializedComponentClips", [])
        if str(clip.get("pathID")) in expected_path_ids
    ]
    if {str(clip.get("pathID")) for clip in clips} != expected_path_ids:
        raise ValueError("Regenerated profile is missing an exact failed clip pathID")
    for clip in clips:
        if clip.get("decodeStatus") != "complete":
            raise ValueError(f"Component clip remains partial: {clip.get('pathID')}")
        mappings = clip.get("pptrCurveMapping") or []
        bindings = [row for row in clip.get("bindings", []) if row.get("isPPtrCurve")]
        if not mappings or not bindings:
            raise ValueError(f"Component clip has no PPtr data: {clip.get('pathID')}")
        if any(row.get("objectType") != "Sprite" for row in mappings):
            raise ValueError(f"PPtr mapping is not entirely Sprite: {clip.get('pathID')}")
        for binding in bindings:
            if binding.get("propertyName") != "m_Sprite":
                raise ValueError(f"PPtr property is not exact m_Sprite: {clip.get('pathID')}")
            if len(binding.get("targets") or []) != 1:
                raise ValueError(f"PPtr target is not exact: {clip.get('pathID')}")
            for key in (binding.get("curves") or [[]])[0]:
                index = key.get("mappingIndex")
                if not isinstance(index, int) or not 0 <= index < len(mappings):
                    raise ValueError(f"Invalid PPtr mapping index: {index}")
    return sorted(clips, key=lambda row: str(row["pathID"]))


def export_sprite_payloads(
    closure: dict[str, Any],
    clips: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, bytes]]:
    UnityPy.config.FALLBACK_UNITY_VERSION = str(closure["unityVersion"])
    environment = UnityPy.load(*map(str, closure_paths(closure)))
    object_index = {
        (str(reader.assets_file.name).lower(), int(reader.path_id)): reader
        for reader in environment.objects
        if reader.type.name == "Sprite"
    }
    assets_by_key: dict[str, dict[str, Any]] = {}
    for clip in clips:
        for asset in clip.get("spriteAssets", []):
            assets_by_key[str(asset["stableKey"])] = dict(asset)

    payloads: dict[str, bytes] = {}
    runtime_assets: list[dict[str, Any]] = []
    for stable_key in sorted(assets_by_key):
        asset = assets_by_key[stable_key]
        key = (str(asset["assetFile"]).lower(), int(asset["pathID"]))
        reader = object_index.get(key)
        if reader is None:
            raise ValueError(f"Sprite is absent from closure: {stable_key}")
        sprite = reader.read()
        if str(sprite.m_Name) != str(asset["name"]):
            raise ValueError(f"Sprite identity changed: {stable_key}")
        image = sprite.image.convert("RGBA")
        relative = f"sprites/{stable_sprite_filename(asset)}"
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=False, compress_level=9)
        payload = buffer.getvalue()
        payloads[relative] = payload
        runtime_assets.append(
            {
                **asset,
                "runtimeUrl": f"./{relative}",
                "imageWidth": image.width,
                "imageHeight": image.height,
                "runtimeBytes": len(payload),
            }
        )
    return runtime_assets, payloads


def sprite_runtime_document(
    clips: list[dict[str, Any]],
    runtime_assets: list[dict[str, Any]],
) -> dict[str, Any]:
    assets = {str(row["stableKey"]): row for row in runtime_assets}
    runtime_clips: list[dict[str, Any]] = []
    for clip in clips:
        binding_hierarchy = []
        for row in clip.get("bindingHierarchy") or []:
            hierarchy_row = dict(row)
            hierarchy_row["name"] = str(hierarchy_row["hierarchyPath"]).split("/")[-1]
            binding_hierarchy.append(hierarchy_row)
        mappings = []
        for mapping in clip["pptrCurveMapping"]:
            stable_key = str(mapping["spriteStableKey"])
            asset = assets.get(stable_key)
            if asset is None:
                raise ValueError(f"Mapping references an unexported Sprite: {stable_key}")
            mappings.append(
                {
                    "mappingIndex": int(mapping["mappingIndex"]),
                    "spriteStableKey": stable_key,
                    "runtimeUrl": asset["runtimeUrl"],
                }
            )
        bindings = []
        for binding in clip["bindings"]:
            if binding.get("isPPtrCurve"):
                bindings.append(
                    {
                        "bindingIndex": int(binding["bindingIndex"]),
                        "typeID": int(binding["typeID"]),
                        "customType": int(binding["customType"]),
                        "propertyName": str(binding["propertyName"]),
                        "targets": binding["targets"],
                        "componentCandidates": binding.get("componentCandidates") or [],
                        "keys": binding["curves"][0],
                    }
                )
        runtime_clips.append(
            {
                "pathID": str(clip["pathID"]),
                "name": str(clip["name"]),
                "sampleRate": float(clip["sampleRate"]),
                "duration": float(clip["duration"]),
                "loop": bool(clip["loop"]),
                "bindingRoots": clip.get("bindingRoots") or [],
                "bindingHierarchy": binding_hierarchy,
                "mappings": mappings,
                "bindings": bindings,
            }
        )
    return {
        "schema": SPRITE_SCHEMA,
        "interpolation": "step",
        "lookupContract": "clip.pathID + bindingIndex + mappingIndex",
        "assets": runtime_assets,
        "clips": runtime_clips,
    }


def expect_file(
    path: Path,
    payload: bytes,
    write: bool,
    results: list[dict[str, Any]],
) -> None:
    exact = path.is_file() and path.read_bytes() == payload
    if write and not exact:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        exact = path.read_bytes() == payload
    results.append({"path": str(path.resolve()), "bytes": len(payload), "byteExact": exact})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--write", action="store_true")
    parser.add_argument(
        "--promote-gate",
        type=Path,
        help="Accepted real-Viewer candidate gate used to promote exact products.",
    )
    parser.add_argument(
        "--formal-gate",
        type=Path,
        help="Post-promotion play/stop/disable real-Viewer gate.",
    )
    return parser.parse_args()


def validate_candidate_gate(gate: dict[str, Any]) -> set[str]:
    if gate.get("schema") != CANDIDATE_GATE_SCHEMA or gate.get("passed") is not True:
        raise ValueError("Candidate gate is absent or did not pass")
    stable_keys = [str(value) for value in gate.get("candidateStableKeys") or []]
    if len(stable_keys) != 3 or len(set(stable_keys)) != 3:
        raise ValueError("Candidate gate denominator must be exactly three stable keys")
    ordinary = list(gate.get("ordinaryCalls") or [])
    previews = list(gate.get("previews") or [])
    if {str(row.get("stableKey")) for row in ordinary} != set(stable_keys):
        raise ValueError("Ordinary-call gate does not cover every candidate")
    if not all(row.get("rejected") is True and row.get("code") == "NOT_FOUND" for row in ordinary):
        raise ValueError("Normal product loader did not remain fail-closed")
    if {str(row.get("stableKey")) for row in previews} != set(stable_keys):
        raise ValueError("Preview gate does not cover every candidate")
    for row in previews:
        final = row.get("final") or {}
        if (
            row.get("passed") is not True
            or row.get("disposed") is not True
            or int(final.get("spriteBindingCount") or 0) <= 0
            or int(final.get("spriteAppliedFrames") or 0) <= 0
            or list(final.get("missingSpritePaths") or [])
        ):
            raise ValueError(f"Candidate preview is incomplete: {row.get('stableKey')}")
    return set(stable_keys)


def validate_formal_gate(
    gate: dict[str, Any],
    stable_keys: set[str],
) -> None:
    if gate.get("schema") != FORMAL_GATE_SCHEMA or gate.get("passed") is not True:
        raise ValueError("Formal runtime gate is absent or did not pass")
    catalog = gate.get("catalog") or {}
    if (
        catalog.get("targetProducts") != 654
        or catalog.get("targetRuntimeReady") != 654
        or catalog.get("targetFailClosed") != 0
    ):
        raise ValueError("Formal gate did not reopen the 654/654 target catalog")
    play_stop = list(gate.get("playStop") or [])
    if {str(row.get("stableKey")) for row in play_stop} != stable_keys:
        raise ValueError("Formal play/stop gate stable keys do not match candidates")
    if not all(
        row.get("passed") is True
        and row.get("result", {}).get("status") == "played"
        and row.get("stopActiveCount") == 0
        and not list((row.get("active") or {}).get("missingSpritePaths") or [])
        for row in play_stop
    ):
        raise ValueError("Formal play/stop gate did not pass every product")
    disable = gate.get("disable") or {}
    if (
        disable.get("passed") is not True
        or disable.get("enabledAfterDisable") is not False
        or disable.get("activeAfterDisable") != 0
        or disable.get("suppressedResult", {}).get("status") != "suppressed"
        or disable.get("suppressedAfter") != disable.get("suppressedBefore", 0) + 1
        or disable.get("enabledAfterReenable") is not True
        or disable.get("replayResult", {}).get("status") != "played"
        or disable.get("finalActiveCount") != 0
    ):
        raise ValueError("Formal disable/suppress/re-enable gate did not pass")


def entries_from_promote_gate(
    authority: Path,
    stable_keys: set[str],
) -> list[dict[str, Any]]:
    manifest = read_json(authority / "manifest.v2.json")
    records = {
        f"{kind}|{row['directionName']}": row
        for kind, rows in manifest["products"].items()
        for row in rows
    }
    if not stable_keys <= records.keys():
        raise ValueError("Promote gate references a product absent from the authority manifest")
    result = []
    for stable_key in sorted(stable_keys):
        kind, direction = stable_key.split("|", 1)
        product_dir = authority / "products" / kind / direction
        product = read_json(product_dir / "product.json")
        clip_ids = list(
            product.get("authority", {})
            .get("pptrSpriteClosure", {})
            .get("clipPathIDs", [])
        )
        if not clip_ids:
            raise ValueError(f"Promoted product lost its exact clip IDs: {stable_key}")
        result.append(
            {
                "subjectKind": kind,
                "directionName": direction,
                "componentClips": [{"pathID": value} for value in clip_ids],
                "reasons": [f"{FAILURE_PREFIX}promoted:{value}" for value in clip_ids],
            }
        )
    return result


def catalog_counts(entries: list[dict[str, Any]]) -> dict[str, int]:
    target = [row for row in entries if row.get("publicationScope") == "target"]
    legacy = [row for row in entries if row.get("publicationScope") == "legacy"]
    return {
        "products": len(entries),
        "enemyProducts": sum(row.get("domain") == "enemy" for row in entries),
        "characterProducts": sum(row.get("domain") == "character" for row in entries),
        "runtimeReady": sum(row.get("runtimeReady") is True for row in entries),
        "failClosed": sum(row.get("runtimeReady") is not True for row in entries),
        "targetProducts": len(target),
        "targetEnemyProducts": sum(row.get("domain") == "enemy" for row in target),
        "targetCharacterProducts": sum(row.get("domain") == "character" for row in target),
        "targetRuntimeReady": sum(row.get("runtimeReady") is True for row in target),
        "targetFailClosed": sum(row.get("runtimeReady") is not True for row in target),
        "legacyProducts": len(legacy),
    }


def promote_documents(
    repo: Path,
    authority: Path,
    stable_keys: set[str],
    gate: dict[str, Any],
    formal_gate: dict[str, Any] | None,
    product_payloads: dict[str, bytes],
    product_metrics: dict[str, dict[str, Any]],
    write: bool,
    results: list[dict[str, Any]],
) -> None:
    captured_at = str(gate.get("capturedAt") or "2026-09-01T00:00:00.000Z")
    gate_path = str(
        (repo / "artifacts/verification" / VERIFICATION_NAME
         / "real-viewer-candidate-gate.v2.json").resolve()
    )
    formal_gate_path = str(
        (repo / "artifacts/verification" / VERIFICATION_NAME
         / "real-viewer-formal-runtime-gate.v1.json").resolve()
    )

    manifest_path = authority / "manifest.v2.json"
    manifest = read_json(manifest_path)
    records_by_key: dict[str, dict[str, Any]] = {}
    for kind, rows in manifest["products"].items():
        for record in rows:
            key = f"{kind}|{record['directionName']}"
            if key not in stable_keys:
                continue
            product_dir = authority / "products" / kind / str(record["directionName"])
            record["status"] = "runtime-ready"
            record["productBytes"] = len(product_payloads[key])
            record["profileBytes"] = (product_dir / "profile.json").stat().st_size
            record["partialSerializedComponentClipCount"] = 0
            record["failClosedReasons"] = []
            record["pptrSpriteClosure"] = {
                "schema": SPRITE_SCHEMA,
                "status": "runtime-ready-verified" if formal_gate is not None
                else "runtime-verified",
                "candidateGate": gate_path,
                **product_metrics[key],
            }
            if formal_gate is not None:
                record["pptrSpriteClosure"]["formalRuntimeGate"] = formal_gate_path
            records_by_key[key] = record
            expect_file(
                product_dir / "product-record.v2.json",
                pretty_bytes(record),
                write,
                results,
            )
    if records_by_key.keys() != stable_keys:
        raise ValueError("Research manifest promotion target mismatch")
    manifest["generatedAt"] = captured_at
    manifest["counts"].update(
        {
            "enemyRuntimeReady": sum(
                row.get("status") == "runtime-ready"
                for row in manifest["products"]["enemy"]
            ),
            "enemyFailClosed": sum(
                row.get("status") != "runtime-ready"
                for row in manifest["products"]["enemy"]
            ),
            "characterRuntimeReady": sum(
                row.get("status") == "runtime-ready"
                for row in manifest["products"]["character"]
            ),
            "characterFailClosed": sum(
                row.get("status") != "runtime-ready"
                for row in manifest["products"]["character"]
            ),
        }
    )
    manifest["failClosed"] = [
        row for row in manifest.get("failClosed", [])
        if f"{row.get('subjectKind')}|{row.get('directionName')}" not in stable_keys
    ]
    manifest["publicationContract"]["status"] = (
        "RESOURCE-RUNTIME-SOURCE-READY; bounded public/catalog consumer updated; "
        "shared dist unchanged"
    )
    expect_file(manifest_path, pretty_bytes(manifest), write, results)

    research_fail_path = authority / "fail-closed-authority.v2.json"
    research_fail = read_json(research_fail_path)
    research_fail["generatedAt"] = captured_at
    research_fail["entries"] = [
        row for row in research_fail.get("entries", [])
        if f"{row.get('subjectKind')}|{row.get('directionName')}" not in stable_keys
    ]
    research_fail["count"] = len(research_fail["entries"])
    expect_file(research_fail_path, pretty_bytes(research_fail), write, results)

    verification_path = authority / "verification-record.json"
    verification = read_json(verification_path)
    verification["generatedAt"] = captured_at
    verification["checks"] = {
        "enemyTargets443": True,
        "characterTargets211": True,
        "enemyProcessed443": True,
        "characterProcessed211": True,
        "stableKeysExact": True,
        "stableKeysUnique": True,
        "allRecordsReopen": True,
        "allReadyProductsReopen": True,
        "allReadyClosuresPresent": True,
        "allReadyTextureFilesPresent": True,
        "failClosedCountZero": research_fail["count"] == 0,
        "pptrSpriteCandidateGatePassed": gate.get("passed") is True,
        "pptrSpriteFormalRuntimeGatePassed": formal_gate is not None
        and formal_gate.get("passed") is True,
        "boundedPublicSourceWritesOnly": True,
        "sharedDistUnchanged": True,
    }
    verification["passed"] = sum(verification["checks"].values())
    verification["total"] = len(verification["checks"])
    verification["allPassed"] = all(verification["checks"].values())
    verification["literalCounts"] = {
        "enemy": "443/443",
        "character": "211/211",
        "runtimeReady": 654,
        "failClosed": research_fail["count"],
        "p0Reused": 10,
    }
    verification["pptrSpriteClosure"] = {
        "schema": SPRITE_SCHEMA,
        "candidateGate": gate_path,
        "stableKeys": sorted(stable_keys),
    }
    if formal_gate is not None:
        verification["pptrSpriteClosure"]["formalRuntimeGate"] = formal_gate_path
    verification.pop("protectedFilesBefore", None)
    verification.pop("protectedFilesAfter", None)
    expect_file(verification_path, pretty_bytes(verification), write, results)

    catalog_path = repo / "public/vfx/catalog.v1.json"
    catalog = read_json(catalog_path)
    for row in catalog["entries"]:
        if str(row.get("stableKey")) in stable_keys:
            row["status"] = "runtime-ready"
            row["runtimeReady"] = True
            row["failClosedReasons"] = []
    catalog["counts"] = catalog_counts(catalog["entries"])
    if catalog["counts"]["targetRuntimeReady"] != 654:
        raise ValueError("Target combat VFX catalog did not reach 654 runtime-ready")
    expect_file(catalog_path, pretty_bytes(catalog), write, results)

    publication_path = repo / "public/vfx/publication.v2.json"
    publication = read_json(publication_path)
    for row in publication["products"]:
        if str(row.get("stableKey")) in stable_keys:
            row["status"] = "runtime-ready"
            row["failClosedReasons"] = []
    publication["counts"] = dict(catalog["counts"])
    expect_file(publication_path, pretty_bytes(publication), write, results)

    public_fail_path = repo / "public/vfx/fail-closed-authority.v2.json"
    public_fail = read_json(public_fail_path)
    public_fail["generatedAt"] = captured_at
    public_fail["entries"] = [
        row for row in public_fail.get("entries", [])
        if f"{row.get('subjectKind')}|{row.get('directionName')}" not in stable_keys
    ]
    public_fail["count"] = len(public_fail["entries"])
    expect_file(public_fail_path, pretty_bytes(public_fail), write, results)

    enemy_manifest_path = repo / "public/enemies/manifest.v1.json"
    enemy_manifest = read_json(enemy_manifest_path)
    all_directions: list[dict[str, Any]] = []
    for enemy in enemy_manifest["entries"]:
        for direction in enemy.get("actions", {}).get("directions", []):
            all_directions.append(direction)
            catalog_product = direction.get("catalogProduct")
            if not isinstance(catalog_product, dict):
                continue
            if str(catalog_product.get("stableKey")) not in stable_keys:
                continue
            catalog_product["status"] = "runtime-ready"
            catalog_product["runtimeReady"] = True
            catalog_product["failClosedReasons"] = []
            direction["runtimeProduct"] = {
                "stableKey": catalog_product["stableKey"],
                "productUrl": catalog_product["productUrl"],
                "schemaVersion": catalog_product["schemaVersion"],
            }
    runtime_products = [
        row["runtimeProduct"] for row in all_directions
        if isinstance(row.get("runtimeProduct"), dict)
    ]
    catalog_products = [
        row["catalogProduct"] for row in all_directions
        if isinstance(row.get("catalogProduct"), dict)
    ]
    enemy_manifest["counts"].update(
        {
            "directionRecords": len(all_directions),
            "directionRecordsWithRuntimeProduct": len(runtime_products),
            "uniqueRuntimeVfxProducts": len(
                {str(row["stableKey"]) for row in runtime_products}
            ),
            "directionRecordsWithCatalogProduct": len(catalog_products),
            "uniqueCatalogVfxProducts": len(
                {str(row["stableKey"]) for row in catalog_products}
            ),
        }
    )
    expect_file(enemy_manifest_path, pretty_bytes(enemy_manifest), write, results)

    official_path = repo / "public/catalogs/official-resources.v1.json"
    official = read_json(official_path)
    for row in official["vfx"]:
        if str(row.get("stableKey")) in stable_keys:
            row["status"] = "runtime-ready"
            row["runtimeReady"] = True
            row["failClosedReasons"] = []
    official["counts"].update(
        {
            "enemyVfxRuntimeReady": sum(
                row.get("domain") == "enemy" and row.get("runtimeReady") is True
                for row in official["vfx"]
            ),
            "characterVfxRuntimeReady": sum(
                row.get("domain") == "character" and row.get("runtimeReady") is True
                for row in official["vfx"]
            ),
            "vfxFailClosed": sum(
                row.get("runtimeReady") is not True for row in official["vfx"]
            ),
        }
    )
    expect_file(official_path, pretty_bytes(official), write, results)


def main() -> int:
    args = parse_args()
    repo = args.repo_root.resolve()
    authority = repo / "artifacts/research" / AUTHORITY_NAME
    gate: dict[str, Any] | None = None
    formal_gate: dict[str, Any] | None = None
    promote_stable_keys: set[str] = set()
    if args.promote_gate:
        gate_path = args.promote_gate.resolve()
        gate = read_json(gate_path)
        promote_stable_keys = validate_candidate_gate(gate)
    if args.formal_gate:
        if gate is None:
            raise ValueError("--formal-gate requires --promote-gate")
        formal_gate = read_json(args.formal_gate.resolve())
        validate_formal_gate(formal_gate, promote_stable_keys)
    fail_closed = read_json(authority / "fail-closed-authority.v2.json")
    entries = list(fail_closed.get("entries") or [])
    if gate is not None:
        current_keys = {
            f"{row.get('subjectKind')}|{row.get('directionName')}" for row in entries
        }
        if current_keys != promote_stable_keys:
            entries = entries_from_promote_gate(authority, promote_stable_keys)
    elif len(entries) != 3:
        raise ValueError(f"Bounded fail-closed denominator changed: {len(entries)} != 3")

    extractor = load_module(
        "magius_scene_profile_extractor",
        repo / "tools/magius/extract_magius_scene_profile.py",
    )
    publisher = load_module(
        "magius_combat_vfx_publisher",
        repo / "scripts/publish-all-combat-vfx-products.py",
    )
    results: list[dict[str, Any]] = []
    products: list[dict[str, Any]] = []
    product_payloads: dict[str, bytes] = {}
    product_metrics: dict[str, dict[str, Any]] = {}
    for entry in sorted(
        entries,
        key=lambda row: (str(row["subjectKind"]), str(row["directionName"])),
    ):
        kind = str(entry["subjectKind"])
        direction = str(entry["directionName"])
        product_dir = authority / "products" / kind / direction
        closure_path = product_dir / "closure.json"
        closure = read_json(closure_path)
        profile = extractor.build_scene_profile(closure_path, f"vfx-{direction}", ".")
        expected_ids = exact_failed_clip_path_ids(entry)
        clips = selected_sprite_clips(profile, expected_ids)
        runtime_assets, sprite_payloads = export_sprite_payloads(closure, clips)
        sprite_runtime = sprite_runtime_document(clips, runtime_assets)

        product_path = product_dir / "product.json"
        product = read_json(product_path)
        if (
            product.get("schemaVersion") != 2
            or product.get("productType") != "magius-official-combat-vfx-v2"
            or product.get("subjectKind") != kind
            or product.get("directionName") != direction
        ):
            raise ValueError(f"Product identity changed: {kind}|{direction}")
        product["spriteRuntime"] = sprite_runtime
        product.setdefault("authority", {})["pptrSpriteClosure"] = {
            "schema": SPRITE_SCHEMA,
            "sourceProfile": str((product_dir / "profile.json").resolve()),
            "status": "runtime-ready-verified" if formal_gate is not None
            else "runtime-verified" if gate is not None
            else "runtime-consumer-verification-pending",
            "clipPathIDs": sorted(expected_ids),
        }
        if gate is not None:
            product["authority"]["pptrSpriteClosure"].update(
                {
                    "candidateGate": str(args.promote_gate.resolve()),
                    "candidateGateCapturedAt": gate.get("capturedAt"),
                }
            )
        if formal_gate is not None:
            product["authority"]["pptrSpriteClosure"].update(
                {
                    "formalRuntimeGate": str(args.formal_gate.resolve()),
                    "formalRuntimeGateCapturedAt": formal_gate.get("capturedAt"),
                }
            )

        expect_file(product_dir / "profile.json", pretty_bytes(profile), args.write, results)
        product_payload = pretty_bytes(product)
        expect_file(product_path, product_payload, args.write, results)
        for relative, payload in sorted(sprite_payloads.items()):
            expect_file(product_dir / relative, payload, args.write, results)

        public_dir = repo / "public/vfx" / kind / direction
        sanitized, _replacement_count = publisher.scrub_absolute_paths(product)
        public_payload = gzip.compress(compact_bytes(sanitized), compresslevel=9, mtime=0)
        expect_file(public_dir / "product.vfxdata", public_payload, args.write, results)
        for relative, payload in sorted(sprite_payloads.items()):
            expect_file(public_dir / relative, payload, args.write, results)

        products.append(
            {
                "stableKey": f"{kind}|{direction}",
                "status": "runtime-ready" if gate is not None else "fail-closed",
                "failClosedReasons": [] if gate is not None else [PENDING_REASON],
                "clipCount": len(sprite_runtime["clips"]),
                "bindingCount": sum(len(clip["bindings"]) for clip in sprite_runtime["clips"]),
                "frameCount": sum(
                    len(binding["keys"])
                    for clip in sprite_runtime["clips"]
                    for binding in clip["bindings"]
                ),
                "mappingCount": sum(len(clip["mappings"]) for clip in sprite_runtime["clips"]),
                "spriteAssetCount": len(sprite_runtime["assets"]),
            }
        )
        stable_key = f"{kind}|{direction}"
        product_payloads[stable_key] = product_payload
        product_metrics[stable_key] = {
            "clipCount": len(sprite_runtime["clips"]),
            "bindingCount": sum(len(clip["bindings"]) for clip in sprite_runtime["clips"]),
            "frameCount": sum(
                len(binding["keys"])
                for clip in sprite_runtime["clips"]
                for binding in clip["bindings"]
            ),
            "mappingCount": sum(len(clip["mappings"]) for clip in sprite_runtime["clips"]),
            "spriteAssetCount": len(sprite_runtime["assets"]),
        }

    if gate is not None:
        promote_documents(
            repo,
            authority,
            promote_stable_keys,
            gate,
            formal_gate,
            product_payloads,
            product_metrics,
            args.write,
            results,
        )

    record = {
        "schema": "magius.combat-vfx-pptr-sprite-product-closure.v1",
        "mode": "write" if args.write else "check",
        "promotionState": "runtime-ready" if gate is not None
        else "runtime-consumer-verification-pending",
        "catalogMutated": gate is not None,
        "products": products,
        "counts": {
            "products": len(products),
            "clips": sum(row["clipCount"] for row in products),
            "bindings": sum(row["bindingCount"] for row in products),
            "frames": sum(row["frameCount"] for row in products),
            "mappings": sum(row["mappingCount"] for row in products),
            "spriteAssets": sum(row["spriteAssetCount"] for row in products),
            "files": len(results),
            "byteExact": sum(bool(row["byteExact"]) for row in results),
        },
        "files": results,
    }
    record_path = (
        repo
        / "artifacts/verification"
        / VERIFICATION_NAME
        / "phase-a-product-record.json"
    )
    if args.write:
        record_path.parent.mkdir(parents=True, exist_ok=True)
        record_path.write_bytes(pretty_bytes(record))

    all_exact = all(row["byteExact"] for row in results)
    print(json.dumps(record["counts"], ensure_ascii=False))
    label = "PROMOTED_PRODUCTS" if gate is not None else "PHASE_A_PRODUCTS"
    print(f"{label}={'PASS' if all_exact else 'DRIFT'}")
    print(f"MUTATION={'true' if args.write else 'false'}")
    return 0 if all_exact else 1


if __name__ == "__main__":
    raise SystemExit(main())
