#!/usr/bin/env python3
"""Publish authority-backed stage and combat-VFX products into Viewer catalogs.

The script consumes already-produced, dependency-closed products.  It does not
scan game installations and it never teaches the runtime about concrete scene,
enemy, or direction IDs.  Every runtime lookup is keyed by catalog data.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any


STAGE_SHARD_URL = "./stages/catalogs/official-battle-direct.v1.json"
VFX_CATALOG_URL = "/vfx/catalog.v1.json"
URI_WITH_SLASHES = re.compile(r"\b([A-Za-z][A-Za-z0-9+.-]*):/{1,2}")
WINDOWS_HOST_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/][^'\"\r\n)\]}]+")


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


def public_url(public_root: Path, path: Path) -> str:
    return "/" + path.relative_to(public_root).as_posix()


def copy_tree(source: Path, destination: Path) -> None:
    if not source.is_dir():
        raise FileNotFoundError(source)
    destination.mkdir(parents=True, exist_ok=True)
    for path in source.rglob("*"):
        relative = path.relative_to(source)
        target = destination / relative
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def scrub_browser_unsafe_strings(value: Any) -> tuple[Any, int]:
    """Remove host-only paths and slash-form URI schemes from runtime JSON."""
    if isinstance(value, dict):
        output = {}
        changes = 0
        for key, child in value.items():
            output[key], count = scrub_browser_unsafe_strings(child)
            changes += count
        return output, changes
    if isinstance(value, list):
        output = []
        changes = 0
        for child in value:
            scrubbed, count = scrub_browser_unsafe_strings(child)
            output.append(scrubbed)
            changes += count
        return output, changes
    if not isinstance(value, str):
        return value, 0
    scrubbed = URI_WITH_SLASHES.sub(r"\1:", value)
    scrubbed = WINDOWS_HOST_PATH.sub("<host-path>", scrubbed)
    return scrubbed, int(scrubbed != value)


def publish_enemy_vfx(repo: Path, public_root: Path) -> int:
    artifact_root = (
        repo
        / "artifacts/research/20260825-p0-enemy-skill-vfx-products-closure-v2"
    )
    authority = read_json(artifact_root / "manifest.v2.json")
    published = 0
    for row in authority["products"]:
        direction = str(row["directionName"])
        source = artifact_root / "products" / direction
        destination = public_root / "vfx" / "enemy" / direction
        copy_tree(source, destination)
        product = read_json(destination / "product.json")
        if product.get("bundleLogicalPath") != normalize_bundle_key(row["bundleKey"]):
            raise ValueError(f"VFX bundle identity changed: {direction}")
        published += 1
    return published


def infer_product_domain(relative: Path) -> tuple[str, str]:
    parts = relative.parts
    if "enemy" in parts:
        owner = next((part for part in parts if part.startswith("enemy_")), "enemy")
        return "enemy", owner
    owner = next((part for part in parts if part.startswith("chara_")), "character")
    return "character", owner


def generate_vfx_catalog(public_root: Path) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    seen_bundle_keys: set[str] = set()
    seen_stable_keys: set[str] = set()
    for product_path in sorted((public_root / "vfx").rglob("product.json")):
        product = read_json(product_path)
        if (
            product.get("schemaVersion") != 2
            or product.get("productType") != "magius-official-combat-vfx-v2"
        ):
            continue
        bundle_key = normalize_bundle_key(str(product["bundleLogicalPath"]))
        stable_key = str(product["vfxKey"])
        if bundle_key in seen_bundle_keys:
            raise ValueError(f"Duplicate VFX bundle key: {bundle_key}")
        if stable_key in seen_stable_keys:
            raise ValueError(f"Duplicate VFX stable key: {stable_key}")
        seen_bundle_keys.add(bundle_key)
        seen_stable_keys.add(stable_key)
        relative = product_path.relative_to(public_root)
        domain, owner_key = infer_product_domain(relative)
        particle_runtime = product.get("particleRuntime") or {}
        timeline = product.get("timeline") or {}
        entries.append(
            {
                "stableKey": stable_key,
                "domain": domain,
                "ownerKey": owner_key,
                "directionKey": str(product["action"]),
                "bundleKey": bundle_key,
                "effectId": str(product["effectId"]),
                "skillUniqueId": product.get("skillUniqueId"),
                "skillMstId": product.get("skillMstId"),
                "productUrl": public_url(public_root, product_path),
                "schemaVersion": 2,
                "runtimeReady": True,
                "lifetimeSeconds": timeline.get("lifetimeSeconds"),
                "particleSystemCount": len(particle_runtime.get("particleSystems", [])),
                "textureCount": len(particle_runtime.get("textureUrls", [])),
            }
        )
    counts = {
        "products": len(entries),
        "enemyProducts": sum(row["domain"] == "enemy" for row in entries),
        "characterProducts": sum(row["domain"] == "character" for row in entries),
        "runtimeReady": sum(bool(row["runtimeReady"]) for row in entries),
    }
    catalog = {
        "schema": "magius.combat-vfx-catalog.v1",
        "lookupContract": {
            "primary": "stableKey",
            "direction": "domain + ownerKey + directionKey",
            "bundle": "normalized bundleKey without AssetBundles prefix",
            "missing": "fail-closed",
        },
        "counts": counts,
        "entries": entries,
    }
    write_json(public_root / "vfx/catalog.v1.json", catalog)
    return catalog


def connect_enemy_manifest(public_root: Path, catalog: dict[str, Any]) -> dict[str, int]:
    manifest_path = public_root / "enemies/manifest.v1.json"
    manifest = read_json(manifest_path)
    by_bundle = {row["bundleKey"]: row for row in catalog["entries"]}
    direction_records = 0
    catalog_records = 0
    connected_records = 0
    catalog_products: set[str] = set()
    connected_products: set[str] = set()
    for entry in manifest["entries"]:
        for direction in entry["actions"]["directions"]:
            direction_records += 1
            bundle_key = normalize_bundle_key(str(direction.get("bundleKey") or ""))
            direction["stableDirectionKey"] = f"enemy-direction:{bundle_key}"
            product = by_bundle.get(bundle_key)
            direction["catalogProduct"] = (
                {
                    "stableKey": product["stableKey"],
                    "productStableKey": product.get("productStableKey", product["stableKey"]),
                    "productUrl": product["productUrl"],
                    "schemaVersion": product["schemaVersion"],
                    "status": product.get("status", "runtime-ready"),
                    "runtimeReady": bool(product["runtimeReady"]),
                    "failClosedReasons": product.get("failClosedReasons") or [],
                }
                if product and product["domain"] == "enemy"
                else None
            )
            direction["runtimeProduct"] = (
                {
                    "stableKey": product["stableKey"],
                    "productUrl": product["productUrl"],
                    "schemaVersion": product["schemaVersion"],
                }
                if product
                and product["domain"] == "enemy"
                and product["runtimeReady"]
                else None
            )
            if direction["catalogProduct"]:
                catalog_records += 1
                catalog_products.add(direction["catalogProduct"]["stableKey"])
            if direction["runtimeProduct"]:
                connected_records += 1
                connected_products.add(direction["runtimeProduct"]["stableKey"])
    manifest["vfxCatalogUrl"] = VFX_CATALOG_URL
    manifest["counts"]["directionRecords"] = direction_records
    manifest["counts"]["directionRecordsWithCatalogProduct"] = catalog_records
    manifest["counts"]["uniqueCatalogVfxProducts"] = len(catalog_products)
    manifest["counts"]["directionRecordsWithRuntimeProduct"] = connected_records
    manifest["counts"]["uniqueRuntimeVfxProducts"] = len(connected_products)
    write_json(manifest_path, manifest)
    return {
        "directionRecords": direction_records,
        "catalogDirectionRecords": catalog_records,
        "uniqueCatalogVfxProducts": len(catalog_products),
        "connectedDirectionRecords": connected_records,
        "uniqueRuntimeVfxProducts": len(connected_products),
    }


def stage_names(authority_row: dict[str, Any]) -> dict[str, str | None]:
    names = (authority_row.get("nameAuthority") or [{}])[0].get("names") or {}
    reuse_locales = (authority_row.get("questReuseAuthority") or {}).get("locales") or {}

    def value(locale: str) -> str | None:
        official = (names.get(locale) or {}).get("value")
        if official:
            return official
        samples = (reuse_locales.get(locale) or {}).get("samples") or []
        return samples[0].get("questGroupName") if samples else None

    return {
        "en": value("en"),
        "ja": value("ja"),
        "zhHant": value("zhHant"),
    }


def viewer_stage_id(authority_row: dict[str, Any]) -> str:
    family = authority_row["family"]
    resource_name = authority_row["resourceName"]
    if family != "battle-direct":
        prefixes = {
            "alternative-story-3d": "alternative",
            "battle-bosspoint-helper": "bosspoint",
            "battle-tower-data": "tower",
            "dungeon-background": "dungeon",
            "field-background": "field",
            "gallery-3d-controller": "gallery-controller",
            "gallery-diorama-original": "gallery-diorama",
            "home-dollhouse-3d-background": "dollhouse",
        }
        prefix = prefixes.get(family)
        if prefix is None:
            raise ValueError(f"Unsupported official scene family: {family}")
        parent = Path(authority_row["assetRelativePath"]).parent.name
        suffix = re.sub(r"[^a-z0-9]+", "-", f"{parent}-{resource_name}".lower()).strip("-")
        return f"{prefix}-{suffix}"
    ids = {
        authority.get("viewerStageId")
        for authority in authority_row.get("nameAuthority") or []
        if authority.get("viewerStageId")
    }
    if len(ids) == 1:
        return ids.pop()
    if len(ids) > 1:
        raise ValueError(
            f"Ambiguous Viewer stage IDs for {authority_row['logicalPath']}: {ids}"
        )
    if not resource_name.startswith("bg_3d_"):
        raise ValueError(f"No stable Viewer stage identity for {resource_name}")
    return "battle-" + resource_name.removeprefix("bg_3d_").replace("_", "-")


def publish_stage(
    repo: Path,
    public_root: Path,
    stage_id: str,
    source_product: Path,
) -> dict[str, Any]:
    inventory = read_json(
        repo
        / "artifacts/research/20260825-viewer-official-resource-gap-inventory"
        / "official-resource-gap-inventory.v1.json"
    )
    row = next(
        item
        for item in inventory["sceneAudit"]["officialLocalUnlisted"]
        if viewer_stage_id(item) == stage_id
    )
    closure_document = read_json(
        repo
        / "artifacts/delivery/20260826-scene-enemy-batch01/authority"
        / "official-scene-closures.v2.json"
    )
    closure = next(
        item for item in closure_document["closures"]
        if item["logicalPath"] == row["logicalPath"]
    )
    if not closure["fullyResolved"]:
        raise ValueError(f"Scene closure is unresolved: {stage_id}")
    destination = public_root / "stages/official" / stage_id
    copy_tree(source_product, destination)
    browser_model = next(
        (path for path in destination.iterdir() if path.name.endswith(".fbxdata")),
        None,
    )
    if browser_model is None:
        gltf_model = next(
            (path for path in destination.iterdir() if path.name.endswith(".gltf")),
            None,
        )
    else:
        gltf_model = None
    if browser_model is None and gltf_model is None:
        compressed_model = next(
            (path for path in destination.iterdir() if path.name.endswith(".fbx.gz")),
            None,
        )
        if compressed_model is None:
            raise FileNotFoundError(f"No Viewer model in scene product: {source_product}")
        # Vite labels files ending in `.gz` as HTTP Content-Encoding gzip. Some
        # browsers then expose an empty body for an already-compressed static
        # asset. Keep the gzip bytes but publish with the Viewer suffix.
        browser_model = compressed_model.with_name(
            compressed_model.name.removesuffix(".fbx.gz") + ".fbxdata"
        )
        compressed_model.replace(browser_model)
    model = browser_model or gltf_model
    if model is None:
        raise RuntimeError(f"Scene model selection failed: {stage_id}")
    model_name = model.name
    asset_type = "fbx" if browser_model else "gltf"
    profile_path = destination / "scene-profile.json"
    if profile_path.is_file():
        profile, _ = scrub_browser_unsafe_strings(read_json(profile_path))
        write_json(profile_path, profile)
    product_manifest_path = destination / "scene-product.json"
    product_manifest = (
        read_json(product_manifest_path) if product_manifest_path.is_file() else {}
    )
    names = stage_names(row)
    categories = {
        "alternative-story-3d": "adv",
        "battle-bosspoint-helper": "battle",
        "battle-direct": "battle",
        "battle-tower-data": "battle",
        "dungeon-background": "dungeon",
        "field-background": "field",
        "gallery-3d-controller": "gallery",
        "gallery-diorama-original": "gallery",
        "home-dollhouse-3d-background": "gallery",
    }
    product_kind = product_manifest.get("kind") or "geometry"
    entry = {
        "id": stage_id,
        "stableKey": row["logicalPath"],
        "name": names["en"] or names["ja"] or row["resourceName"],
        "names": names,
        "category": categories[row["family"]],
        "family": row["family"],
        "official": True,
        "assetBundleName": row["assetRelativePath"],
        "backgroundResourceName": row["resourceName"],
        "type": asset_type,
        "url": f"./stages/official/{stage_id}/{model_name}",
        "scale": 1,
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "dynamic": {
            "expected": product_kind == "geometry",
            "status": "recovered" if product_kind == "geometry" else "product-presentation",
            "evidence": [
                "dependency-closed official bundle product",
                product_manifest.get("presentationMode")
                or "serialized scene profile with lights/materials/runtime components",
            ],
        },
        "product": {
            "schema": product_manifest.get("schema") or "magius.official-scene-product.v1",
            "kind": product_kind,
            "fullyResolved": True,
            "sourceBytes": row["sourceBytes"],
            "externalCabCount": closure["externalCabCount"],
            "syntheticMarker": bool(product_manifest.get("syntheticMarker")),
        },
    }
    if profile_path.is_file():
        entry["sceneProfileUrl"] = f"./stages/official/{stage_id}/scene-profile.json"
    family = row["family"]
    shard_url = f"./stages/catalogs/official-{family}.v1.json"
    shard_path = public_root / f"stages/catalogs/official-{family}.v1.json"
    shard = read_json(shard_path) if shard_path.is_file() else {
        "schema": "magius.official-stage-catalog.v1",
        "version": 1,
        "family": family,
        "stages": [],
    }
    by_id = {item["id"]: item for item in shard["stages"]}
    by_id[stage_id] = entry
    shard["stages"] = [by_id[key] for key in sorted(by_id)]
    shard["counts"] = {
        "visible": len(shard["stages"]),
        "target": sum(
            item["family"] == family
            for item in inventory["sceneAudit"]["officialLocalUnlisted"]
        ),
        "fullyResolved": sum(
            bool(item.get("product", {}).get("fullyResolved"))
            for item in shard["stages"]
        ),
    }
    write_json(shard_path, shard)

    root_catalog_path = public_root / "stages/catalog.json"
    root_catalog = read_json(root_catalog_path)
    catalogs = list(root_catalog.get("catalogs") or [])
    if shard_url not in catalogs:
        catalogs.append(shard_url)
    root_catalog["catalogs"] = catalogs
    write_json(root_catalog_path, root_catalog)
    return entry


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--stage-id", required=True)
    parser.add_argument("--stage-product", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo = args.repo_root.resolve()
    public_root = repo / "public"
    p0_count = publish_enemy_vfx(repo, public_root)
    catalog = generate_vfx_catalog(public_root)
    enemy_counts = connect_enemy_manifest(public_root, catalog)
    stage = publish_stage(repo, public_root, args.stage_id, args.stage_product.resolve())
    print(
        json.dumps(
            {
                "stage": stage["id"],
                "p0EnemyVfxPublished": p0_count,
                "vfxCatalog": catalog["counts"],
                "enemyConnections": enemy_counts,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
