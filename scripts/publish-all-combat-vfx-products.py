#!/usr/bin/env python3
"""Publish the authority-complete direction-keyed combat VFX product set.

Only browser runtime data is copied: a gzip-compressed JSON product plus the
textures named by that product. Raw bundles, extraction profiles and staged CAB
closures remain research evidence and never enter ``public``.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import shutil
from pathlib import Path, PurePosixPath
from typing import Any

from importlib.machinery import SourceFileLoader


ABSOLUTE_PATH = re.compile(r"^[A-Za-z]:[\\/]")
AUTHORITY_NAME = "20260826-all-enemy-character-skill-vfx-products-v2"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def normalize_bundle_key(value: str) -> str:
    return value.replace("\\", "/").removeprefix("AssetBundles/")


def authority_uri(value: str) -> str:
    normalized = value.replace("\\", "/")
    lowered = normalized.lower()
    authority_marker = f"/artifacts/research/{AUTHORITY_NAME.lower()}/"
    if authority_marker in lowered:
        tail = normalized[lowered.index(authority_marker) + len(authority_marker) :]
        return f"authority://{AUTHORITY_NAME}/{tail}"
    bundle_marker = "/assetbundles/"
    if bundle_marker in lowered:
        tail = normalized[lowered.index(bundle_marker) + len(bundle_marker) :]
        return f"authority://official-assetbundles/{tail}"
    return f"authority://external/{Path(normalized).name}"


def scrub_absolute_paths(value: Any) -> tuple[Any, int]:
    if isinstance(value, str):
        return (authority_uri(value), 1) if ABSOLUTE_PATH.match(value) else (value, 0)
    if isinstance(value, list):
        result = []
        replacements = 0
        for item in value:
            sanitized, count = scrub_absolute_paths(item)
            result.append(sanitized)
            replacements += count
        return result, replacements
    if isinstance(value, dict):
        result = {}
        replacements = 0
        for key, item in value.items():
            sanitized, count = scrub_absolute_paths(item)
            result[key] = sanitized
            replacements += count
        return result, replacements
    return value, 0


def checked_runtime_relative_url(value: str) -> PurePosixPath:
    path = PurePosixPath(value.split("?", 1)[0].split("#", 1)[0])
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise ValueError(f"Unsafe VFX runtime URL: {value}")
    return path


def prune_non_runtime_files(destination: Path, allowed_files: set[Path]) -> int:
    removed = 0
    for path in sorted(destination.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        if path.is_file() and path.resolve() not in allowed_files:
            path.unlink()
            removed += 1
        elif path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    return removed


def owner_key(kind: str, product: dict[str, Any], record: dict[str, Any]) -> str:
    if kind == "enemy":
        values = product.get("enemyUniqueIds") or record.get("enemyUniqueIds") or []
        return f"enemy_{values[0]}" if values else "enemy"
    identities = product.get("characterIdentities") or []
    character_id = identities[0].get("characterId") if identities else None
    return f"chara_{character_id}" if character_id else "character"


def catalog_entry(
    kind: str,
    direction: str,
    product: dict[str, Any],
    record: dict[str, Any],
    product_url: str,
) -> dict[str, Any]:
    status = str(record["status"])
    timeline = product.get("timeline") or {}
    particles = product.get("particleRuntime") or {}
    identities = product.get("characterIdentities") or []
    subject_ids = (
        product.get("enemyUniqueIds") or record.get("enemyUniqueIds") or []
        if kind == "enemy"
        else [row.get("characterId") for row in identities if row.get("characterId")]
    )
    return {
        "stableKey": f"{kind}|{direction}",
        "productStableKey": str(product["vfxKey"]),
        "domain": kind,
        "subjectKind": kind,
        "ownerKey": owner_key(kind, product, record),
        "directionKey": direction,
        "directionName": direction,
        "bundleKey": normalize_bundle_key(str(product["bundleLogicalPath"])),
        "effectId": str(product["effectId"]),
        "skillUniqueId": product.get("skillUniqueId"),
        "skillMstId": product.get("skillMstId"),
        "skillMstIds": product.get("skillMstIds") or record.get("skillMstIds") or [],
        "actionIds": product.get("actionIds") or record.get("actionIds") or [],
        "subjectIds": subject_ids,
        "productUrl": product_url,
        "schemaVersion": 2,
        "status": status,
        "runtimeReady": status == "runtime-ready",
        "publicationScope": "target",
        "failClosedReasons": record.get("failClosedReasons") or [],
        "lifetimeSeconds": timeline.get("lifetimeSeconds"),
        "particleSystemCount": len(particles.get("particleSystems", [])),
        "textureCount": len(particles.get("textureUrls", [])),
    }


def legacy_entries(public_root: Path, target_keys: set[str]) -> list[dict[str, Any]]:
    entries = []
    for product_path in sorted((public_root / "vfx").rglob("product.json")):
        product = read_json(product_path)
        if (
            product.get("schemaVersion") != 2
            or product.get("productType") != "magius-official-combat-vfx-v2"
        ):
            continue
        relative = product_path.relative_to(public_root)
        kind = "enemy" if "enemy" in relative.parts else "character"
        direction = str(product.get("directionName") or product["action"])
        stable_key = f"{kind}|{direction}"
        if stable_key in target_keys:
            continue
        particles = product.get("particleRuntime") or {}
        timeline = product.get("timeline") or {}
        entries.append(
            {
                "stableKey": stable_key,
                "productStableKey": str(product["vfxKey"]),
                "domain": kind,
                "subjectKind": kind,
                "ownerKey": owner_key(kind, product, {}),
                "directionKey": direction,
                "directionName": direction,
                "bundleKey": normalize_bundle_key(str(product["bundleLogicalPath"])),
                "effectId": str(product["effectId"]),
                "skillUniqueId": product.get("skillUniqueId"),
                "skillMstId": product.get("skillMstId"),
                "skillMstIds": product.get("skillMstIds") or [],
                "actionIds": product.get("actionIds") or [],
                "subjectIds": [],
                "productUrl": "/" + relative.as_posix(),
                "schemaVersion": 2,
                "status": "runtime-ready",
                "runtimeReady": True,
                "publicationScope": "legacy",
                "failClosedReasons": [],
                "lifetimeSeconds": timeline.get("lifetimeSeconds"),
                "particleSystemCount": len(particles.get("particleSystems", [])),
                "textureCount": len(particles.get("textureUrls", [])),
            }
        )
    return entries


def validate_catalog(entries: list[dict[str, Any]]) -> None:
    for field in ("stableKey", "productStableKey", "bundleKey"):
        values = [str(entry[field]) for entry in entries]
        if len(values) != len(set(values)):
            raise ValueError(f"Duplicate combat VFX catalog {field}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument(
        "--authority-root",
        type=Path,
        default=None,
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo = args.repo_root.resolve()
    authority_root = (
        args.authority_root.resolve()
        if args.authority_root
        else repo / "artifacts/research" / AUTHORITY_NAME
    )
    manifest = read_json(authority_root / "manifest.v2.json")
    public_root = repo / "public"
    entries = []
    scrubbed_absolute_values = 0
    copied_textures = 0
    compressed_bytes = 0
    uncompressed_bytes = 0
    pruned_non_runtime_files = 0

    for kind in ("enemy", "character"):
        records = manifest["products"][kind]
        expected = manifest["counts"][f"{kind}Target"]
        if len(records) != expected:
            raise ValueError(f"{kind} authority count changed: {len(records)} != {expected}")
        for record in records:
            direction = str(record["directionName"])
            if record.get("subjectKind") != kind:
                raise ValueError(f"VFX subject mismatch: {kind}|{direction}")
            source_product = Path(record["productPath"]).resolve()
            expected_source = (authority_root / "products" / kind / direction / "product.json").resolve()
            if source_product != expected_source or not source_product.is_file():
                raise ValueError(f"VFX product path escaped authority root: {kind}|{direction}")
            product = read_json(source_product)
            if (
                product.get("schemaVersion") != 2
                or product.get("productType") != "magius-official-combat-vfx-v2"
                or product.get("subjectKind") != kind
                or product.get("directionName") != direction
                or normalize_bundle_key(str(product.get("bundleLogicalPath") or ""))
                != normalize_bundle_key(str(record["bundleKey"]))
            ):
                raise ValueError(f"VFX product contract changed: {kind}|{direction}")

            destination = public_root / "vfx" / kind / direction
            destination.mkdir(parents=True, exist_ok=True)
            sanitized, replacement_count = scrub_absolute_paths(product)
            scrubbed_absolute_values += replacement_count
            payload = json.dumps(
                sanitized,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            compressed = gzip.compress(payload, compresslevel=9, mtime=0)
            product_target = destination / "product.vfxdata"
            product_target.write_bytes(compressed)
            allowed_files = {product_target.resolve()}
            uncompressed_bytes += len(payload)
            compressed_bytes += len(compressed)
            stale_json = destination / "product.json"
            if stale_json.is_file():
                stale_json.unlink()

            for url in (product.get("particleRuntime") or {}).get("textureUrls", []):
                relative = checked_runtime_relative_url(str(url))
                source_texture = source_product.parent.joinpath(*relative.parts)
                if not source_texture.is_file():
                    raise FileNotFoundError(
                        f"Missing VFX texture {kind}|{direction}: {source_texture}"
                    )
                target_texture = destination.joinpath(*relative.parts)
                target_texture.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_texture, target_texture)
                allowed_files.add(target_texture.resolve())
                copied_textures += 1

            pruned_non_runtime_files += prune_non_runtime_files(
                destination,
                allowed_files,
            )

            entries.append(
                catalog_entry(
                    kind,
                    direction,
                    sanitized,
                    record,
                    "/" + product_target.relative_to(public_root).as_posix(),
                )
            )

    target_keys = {entry["stableKey"] for entry in entries}
    target_entries = list(entries)
    entries.extend(legacy_entries(public_root, target_keys))
    entries.sort(key=lambda entry: (entry["domain"], entry["directionKey"]))
    validate_catalog(entries)

    target_enemy = [entry for entry in target_entries if entry["domain"] == "enemy"]
    target_character = [entry for entry in target_entries if entry["domain"] == "character"]
    if len(target_enemy) != 443 or len(target_character) != 211:
        raise ValueError("Target VFX catalog partition is not 443 enemy + 211 character")
    counts = {
        "products": len(entries),
        "enemyProducts": sum(entry["domain"] == "enemy" for entry in entries),
        "characterProducts": sum(entry["domain"] == "character" for entry in entries),
        "runtimeReady": sum(bool(entry["runtimeReady"]) for entry in entries),
        "failClosed": sum(not entry["runtimeReady"] for entry in entries),
        "targetProducts": len(target_entries),
        "targetEnemyProducts": len(target_enemy),
        "targetCharacterProducts": len(target_character),
        "targetRuntimeReady": sum(bool(entry["runtimeReady"]) for entry in target_entries),
        "targetFailClosed": sum(not entry["runtimeReady"] for entry in target_entries),
        "legacyProducts": sum(entry["publicationScope"] == "legacy" for entry in entries),
    }
    catalog = {
        "schema": "magius.combat-vfx-catalog.v1",
        "lookupContract": {
            "primary": "subjectKind + directionName",
            "direction": "subjectKind + directionName",
            "productIdentity": "productStableKey",
            "bundle": "normalized bundleKey without AssetBundles prefix",
            "missing": "fail-closed",
        },
        "authority": f"authority://{AUTHORITY_NAME}/manifest.v2.json",
        "counts": counts,
        "entries": entries,
    }
    write_json(public_root / "vfx/catalog.v1.json", catalog)

    fail_closed = read_json(authority_root / "fail-closed-authority.v2.json")
    sanitized_fail_closed, fail_closed_replacements = scrub_absolute_paths(fail_closed)
    scrubbed_absolute_values += fail_closed_replacements
    write_json(public_root / "vfx/fail-closed-authority.v2.json", sanitized_fail_closed)

    publication = {
        "schema": "magius.combat-vfx-publication.v2",
        "authority": f"authority://{AUTHORITY_NAME}/manifest.v2.json",
        "counts": counts,
        "products": [
            {
                "stableKey": entry["stableKey"],
                "productStableKey": entry["productStableKey"],
                "subjectKind": entry["subjectKind"],
                "directionName": entry["directionName"],
                "status": entry["status"],
                "productUrl": entry["productUrl"],
                "failClosedReasons": entry["failClosedReasons"],
            }
            for entry in target_entries
        ],
    }
    write_json(public_root / "vfx/publication.v2.json", publication)

    module = SourceFileLoader(
        "official_resource_publisher",
        str(repo / "scripts/publish-official-resource-batch.py"),
    ).load_module()
    enemy_connections = module.connect_enemy_manifest(public_root, catalog)
    result = {
        "catalog": counts,
        "enemyConnections": enemy_connections,
        "copiedTextures": copied_textures,
        "prunedNonRuntimeFiles": pruned_non_runtime_files,
        "scrubbedAbsoluteValues": scrubbed_absolute_values,
        "productBytes": {
            "uncompressed": uncompressed_bytes,
            "compressed": compressed_bytes,
        },
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
