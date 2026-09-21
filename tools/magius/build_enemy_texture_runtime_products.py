#!/usr/bin/env python3
"""Publish enemy texture products from the already-declared model closures.

Only bundle keys in the existing 493 model-runtime products are opened. Exact
stable-key matches from existing stage and combat-VFX products are accepted as
fallbacks. The upstream inventory is never enumerated.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import warnings
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "magius.enemy-texture-runtime-products.v1"
MATERIAL_SCHEMA = "magius.enemy-material-profile.v1"
UNITY_VERSION = "2022.3.62f2"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def normalized_key(cab: str | None, path_id: str | int | None) -> str | None:
    if not cab or path_id is None:
        return None
    return f"{cab.lower()}|{int(path_id)}"


def runtime_filename(cab: str, path_id: str | int) -> str:
    cab_part = re.sub(r"[^a-z0-9]+", "-", cab.lower()).strip("-")
    numeric = int(path_id)
    path_part = f"n{abs(numeric)}" if numeric < 0 else f"p{numeric}"
    return f"{cab_part}__pathid-{path_part}.png"


def image_metadata(path: Path) -> dict[str, Any]:
    from PIL import Image

    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        minimum, maximum = rgba.getchannel("A").getextrema()
        return {
            "width": rgba.width,
            "height": rgba.height,
            "alpha": {
                "present": minimum < 255,
                "minimum": minimum,
                "maximum": maximum,
            },
        }


def resolve_product_url(profile_path: Path, public_root: Path, value: str) -> Path:
    normalized = value.replace("\\", "/")
    if normalized.startswith("/"):
        return public_root / normalized.lstrip("/")
    if normalized.startswith("./stages/") or normalized.startswith("./enemies/"):
        return public_root / normalized[2:]
    if normalized.startswith("stages/") or normalized.startswith("enemies/"):
        return public_root / normalized
    return profile_path.parent / normalized.removeprefix("./")


@dataclass(frozen=True)
class Candidate:
    key: str
    path: Path
    kind: str
    authority: str
    source_bundle_key: str | None = None
    name: str | None = None
    color_space: str | None = None
    wrap_u: str | None = None
    wrap_v: str | None = None
    filter_mode: str | None = None
    anisotropy: int | None = None


def add_candidate(index: dict[str, list[Candidate]], candidate: Candidate) -> None:
    if candidate.path.is_file():
        index[candidate.key].append(candidate)


def material_product_candidates(
    profile_paths: Iterable[Path], public_root: Path
) -> dict[str, list[Candidate]]:
    index: dict[str, list[Candidate]] = defaultdict(list)
    for profile_path in profile_paths:
        product = read_json(profile_path)
        for material in product.get("profiles", []):
            main_property = material.get("runtime", {}).get("mainTextureProperty")
            for property_name, texture in material.get("textures", {}).items():
                key = normalized_key(texture.get("cab"), texture.get("pathId"))
                runtime_url = texture.get("runtimeUrl")
                if (
                    not key
                    or not runtime_url
                    or not str(runtime_url).startswith("/enemies/models/")
                ):
                    continue
                add_candidate(
                    index,
                    Candidate(
                        key=key,
                        path=resolve_product_url(profile_path, public_root, runtime_url),
                        kind="enemy-runtime-product",
                        authority=profile_path.relative_to(public_root.parent).as_posix(),
                        source_bundle_key=texture.get("bundleKey"),
                        name=texture.get("name"),
                        color_space="srgb" if property_name == main_property else None,
                    ),
                )
    return index


def texture_records(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        if (
            isinstance(value.get("sourceTextureCab"), str)
            and value.get("sourceTexturePathId") is not None
            and isinstance(value.get("url"), str)
        ):
            yield value
        for child in value.values():
            yield from texture_records(child)
    elif isinstance(value, list):
        for child in value:
            yield from texture_records(child)


def generic_product_candidates(
    profile_paths: Iterable[Path], public_root: Path, kind: str
) -> dict[str, list[Candidate]]:
    index: dict[str, list[Candidate]] = defaultdict(list)
    for profile_path in profile_paths:
        try:
            product = read_json(profile_path)
        except (OSError, json.JSONDecodeError):
            continue
        for texture in texture_records(product):
            key = normalized_key(
                texture.get("sourceTextureCab"), texture.get("sourceTexturePathId")
            )
            if not key:
                continue
            add_candidate(
                index,
                Candidate(
                    key=key,
                    path=resolve_product_url(profile_path, public_root, texture["url"]),
                    kind=kind,
                    authority=str(profile_path),
                    name=Path(texture["url"]).stem,
                    color_space=texture.get("colorSpace")
                    or texture.get("serializedColorSpace"),
                    wrap_u=(texture.get("wrap") or {}).get("u"),
                    wrap_v=(texture.get("wrap") or {}).get("v"),
                    filter_mode=texture.get("filter"),
                    anisotropy=texture.get("anisotropy"),
                ),
            )
    return index


_WORKER_NEEDED: set[str] = set()
_WORKER_OUTPUT: Path | None = None


def init_extract_worker(needed: set[str], output: str) -> None:
    global _WORKER_NEEDED, _WORKER_OUTPUT
    _WORKER_NEEDED = needed
    _WORKER_OUTPUT = Path(output)
    warnings.filterwarnings("ignore", message="No valid Unity version found")


def texture_runtime_image(texture: Any) -> Any:
    """Decode a Texture2D, including Unity R8 control maps.

    The installed Pillow release rejects UnityPy's legacy RGB/raw-R decoder.
    R8 is one byte per pixel, so preserve the exact channel as a vertically
    corrected grayscale image before publishing PNG.
    """
    try:
        return texture.image.convert("RGBA")
    except ValueError as error:
        if int(getattr(texture, "m_TextureFormat", -1)) != 24:
            raise
        from PIL import Image

        width = int(texture.m_Width)
        height = int(texture.m_Height)
        data = texture.get_image_data()
        if len(data) != width * height:
            raise error
        return Image.frombytes("L", (width, height), data).transpose(
            Image.Transpose.FLIP_TOP_BOTTOM
        )


def extract_bundle(task: tuple[int, str, str]) -> dict[str, Any]:
    task_index, bundle_key, path_value = task
    import UnityPy
    from UnityPy import config

    config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    environment = UnityPy.load(path_value)
    assert _WORKER_OUTPUT is not None
    output_directory = _WORKER_OUTPUT / f"{task_index:04d}"
    output_directory.mkdir(parents=True, exist_ok=True)
    matches: list[dict[str, Any]] = []
    for reader in environment.objects:
        if reader.type.name != "Texture2D":
            continue
        cab = str(reader.assets_file.name)
        key = normalized_key(cab, reader.path_id)
        if key not in _WORKER_NEEDED:
            continue
        texture = reader.read()
        output_path = output_directory / runtime_filename(cab, reader.path_id)
        texture_runtime_image(texture).save(output_path, format="PNG")
        settings = getattr(texture, "m_TextureSettings", None)
        wrap_names = {0: "repeat", 1: "clamp", 2: "mirror", 3: "mirror-once"}
        filter_names = {0: "nearest", 1: "bilinear", 2: "trilinear"}
        matches.append(
            {
                "key": key,
                "path": str(output_path),
                "bundleKey": bundle_key,
                "name": str(getattr(texture, "m_Name", "")) or None,
                "colorSpace": "srgb"
                if int(getattr(texture, "m_ColorSpace", 0)) == 1
                else "linear",
                "anisotropy": int(getattr(settings, "m_Aniso", 1))
                if settings is not None
                else None,
                "wrapU": wrap_names.get(int(getattr(settings, "m_WrapU", 0)))
                if settings is not None
                else None,
                "wrapV": wrap_names.get(int(getattr(settings, "m_WrapV", 0)))
                if settings is not None
                else None,
                "filter": filter_names.get(int(getattr(settings, "m_FilterMode", 1)))
                if settings is not None
                else None,
            }
        )
    return {"bundleKey": bundle_key, "matches": matches}


def collect_targets(
    material_paths: list[Path],
) -> tuple[
    dict[str, dict[str, Any]], dict[str, set[str]], dict[str, set[str]]
]:
    targets: dict[str, dict[str, Any]] = {}
    key_bundle_keys: dict[str, set[str]] = defaultdict(set)
    key_models: dict[str, set[str]] = defaultdict(set)
    for path in material_paths:
        product = read_json(path)
        if product.get("schema") != MATERIAL_SCHEMA:
            raise ValueError(f"Unsupported material product: {path}")
        model = product["modelPrefabName"]
        for material in product.get("profiles", []):
            for property_name, texture in material.get("textures", {}).items():
                key = normalized_key(texture.get("cab"), texture.get("pathId"))
                if not key:
                    continue
                target = targets.setdefault(
                    key,
                    {
                        "stableKey": texture["stableKey"],
                        "cab": texture.get("cab"),
                        "pathId": str(texture["pathId"]),
                        "references": 0,
                        "properties": set(),
                    },
                )
                target["references"] += 1
                target["properties"].add(property_name)
                if texture.get("bundleKey"):
                    key_bundle_keys[key].add(texture["bundleKey"])
                key_models[key].add(model)
    return targets, key_bundle_keys, key_models


def active_texture_properties(material: dict[str, Any]) -> set[str]:
    textures = material.get("textures", {})
    floats = material.get("serializedFloats", {})
    required: set[str] = set()
    main = material.get("runtime", {}).get("mainTextureProperty")
    if main and main in textures:
        required.add(main)
    switches = {
        "_MercuryMatCap": ("_IsMercury",),
        "_WindNoiseTex": ("_UseWind", "_UseSubWind"),
        "_OffsetAnimationTex": ("_UseOffsetAnimation",),
        "_NoiseTex": ("_Noise",),
        "_DissolveTex": ("_DissolveFade",),
        "_OutlineEdgeTex": ("_UseOutlineEdge",),
        "_ChigiriEdgeNoiseTex": ("_ChigiriEdge",),
    }
    for property_name, flags in switches.items():
        if property_name in textures and any(float(floats.get(flag, 0)) != 0 for flag in flags):
            required.add(property_name)
    return required


def parse_args() -> argparse.Namespace:
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--profile-root",
        type=Path,
        default=repository / "public" / "enemies" / "models",
    )
    parser.add_argument(
        "--public-root", type=Path, default=repository / "public"
    )
    parser.add_argument(
        "--output-enemy-root",
        type=Path,
        default=repository / "public" / "enemies",
    )
    parser.add_argument(
        "--asset-root",
        type=Path,
        default=Path(r"D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles"),
    )
    parser.add_argument(
        "--vfx-product-root",
        type=Path,
        default=repository
        / "artifacts"
        / "research"
        / "20260826-all-enemy-character-skill-vfx-products-v2"
        / "products",
    )
    parser.add_argument(
        "--cab-index",
        type=Path,
        default=repository
        / "artifacts"
        / "bulk-stage-expansion-20260817"
        / "cab-index.json",
    )
    parser.add_argument(
        "--scratch-root",
        type=Path,
        default=repository
        / "artifacts"
        / "verification"
        / "20260829-official-scene-enemy-material-products"
        / "iteration-02-enemy-texture-runtime"
        / "scratch",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=max(1, min(6, (os.cpu_count() or 2) // 2)),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    material_paths = sorted(args.profile_root.glob("*/material-profile.v1.json"))
    runtime_paths = sorted(args.profile_root.glob("*/model-runtime.v1.json"))
    if len(material_paths) != 493 or len(runtime_paths) != 493:
        raise ValueError(
            f"Expected bounded 493 products, got material={len(material_paths)} "
            f"runtime={len(runtime_paths)}"
        )
    targets, key_bundle_keys, key_models = collect_targets(material_paths)
    needed = set(targets)
    runtime_by_model: dict[str, dict[str, Any]] = {}
    for runtime_path in runtime_paths:
        runtime = read_json(runtime_path)
        runtime_by_model[runtime["modelPrefabName"]] = runtime

    candidates = material_product_candidates(material_paths, args.public_root)
    stage_profiles = sorted(
        (args.public_root / "stages" / "official").glob("*/scene-profile.json")
    )
    for key, values in generic_product_candidates(
        stage_profiles, args.public_root, "stage-runtime-product"
    ).items():
        candidates[key].extend(values)
    vfx_profiles = sorted(args.vfx_product_root.glob("**/profile.json"))
    for key, values in generic_product_candidates(
        vfx_profiles, args.public_root, "combat-vfx-runtime-product"
    ).items():
        candidates[key].extend(values)

    direct_tasks: dict[str, Path] = {}
    direct_task_kind: dict[str, str] = {}
    for key, bundle_keys in key_bundle_keys.items():
        for bundle_key in bundle_keys:
            if not bundle_key.startswith("AssetBundles/"):
                continue
            path = args.asset_root / Path(bundle_key[len("AssetBundles/") :])
            if path.is_file():
                direct_tasks[bundle_key] = path
                direct_task_kind[bundle_key] = "declared-enemy-bundle-closure"
    # Some Unity pointers retained their exact CAB/pathID but could not be
    # dereferenced while the material product was built, so bundleKey is null.
    # Search only the already-declared closures of the models that reference
    # those keys; this remains bounded and avoids an inventory scan.
    unresolved_for_closure = {
        key for key in needed if key not in candidates and key not in key_bundle_keys
    }
    for key in unresolved_for_closure:
        for model in key_models[key]:
            runtime = runtime_by_model[model]
            closure_keys = [
                runtime["sourceBundleKey"],
                *runtime.get("textureBundleKeys", []),
                *runtime.get("shaderBundleKeys", []),
                *runtime.get("modelBundleKeys", []),
            ]
            for bundle_key in closure_keys:
                if not bundle_key.startswith("AssetBundles/"):
                    continue
                path = args.asset_root / Path(bundle_key[len("AssetBundles/") :])
                if path.is_file():
                    direct_tasks[bundle_key] = path
                    direct_task_kind[bundle_key] = "declared-enemy-bundle-closure"

    # Resolve the remaining exact CAB identities through the already-published
    # CAB index. Each selected path is a direct mapping for a requested key;
    # no directory or inventory enumeration occurs here.
    cab_index = read_json(args.cab_index)
    cab_lookup = {
        str(cab).lower(): records for cab, records in cab_index["cabs"].items()
    }
    cab_index_mapped_bundles: set[str] = set()
    for key in needed:
        if key in candidates or key in key_bundle_keys:
            continue
        cab = targets[key]["cab"]
        records = cab_lookup.get(str(cab).lower(), [])
        existing: list[tuple[str, Path]] = []
        for record in records:
            bundle_key = str(record["logicalPath"])
            if not bundle_key.startswith("AssetBundles/"):
                continue
            path = args.asset_root / Path(bundle_key[len("AssetBundles/") :])
            if path.is_file():
                existing.append((bundle_key, path))
        if len(existing) != 1:
            continue
        bundle_key, path = existing[0]
        if bundle_key not in direct_tasks:
            direct_tasks[bundle_key] = path
            direct_task_kind[bundle_key] = "cab-index-bounded-exact"
        cab_index_mapped_bundles.add(bundle_key)

    extract_root = args.scratch_root / "declared-closure-extracts"
    if extract_root.exists():
        shutil.rmtree(extract_root)
    extract_root.mkdir(parents=True)
    warnings.filterwarnings("ignore", message="No valid Unity version found")
    extract_failures: list[dict[str, str]] = []
    direct_matches = 0
    workers = max(1, min(args.workers, len(direct_tasks) or 1))
    with ProcessPoolExecutor(
        max_workers=workers,
        initializer=init_extract_worker,
        initargs=(needed, str(extract_root)),
    ) as executor:
        futures = {}
        for task_index, (bundle_key, path) in enumerate(sorted(direct_tasks.items())):
            task = (task_index, bundle_key, str(path))
            futures[executor.submit(extract_bundle, task)] = bundle_key
        for index, future in enumerate(as_completed(futures), 1):
            bundle_key = futures[future]
            try:
                result = future.result()
                for match in result["matches"]:
                    add_candidate(
                        candidates,
                        Candidate(
                            key=match["key"],
                            path=Path(match["path"]),
                            kind=direct_task_kind[bundle_key],
                            authority=bundle_key,
                            source_bundle_key=bundle_key,
                            name=match.get("name"),
                            color_space=match.get("colorSpace"),
                            wrap_u=match.get("wrapU"),
                            wrap_v=match.get("wrapV"),
                            filter_mode=match.get("filter"),
                            anisotropy=match.get("anisotropy"),
                        ),
                    )
                    direct_matches += 1
            except Exception as error:
                extract_failures.append(
                    {"bundleKey": bundle_key, "error": f"{type(error).__name__}: {error}"}
                )
            if index % 100 == 0 or index == len(futures):
                print(
                    f"ENEMY_TEXTURE_EXTRACT_PROGRESS={index}/{len(futures)} "
                    f"MATCHES={direct_matches} FAILURES={len(extract_failures)}",
                    flush=True,
                )

    priority = {
        "cab-index-bounded-exact": 0,
        "declared-enemy-bundle-closure": 1,
        "enemy-runtime-product": 2,
        "stage-runtime-product": 3,
        "combat-vfx-runtime-product": 4,
    }
    output_texture_root = args.output_enemy_root / "textures"
    output_texture_root.mkdir(parents=True, exist_ok=True)
    manifest_entries: list[dict[str, Any]] = []
    runtime_by_key: dict[str, dict[str, Any]] = {}
    copied_bytes = 0
    for key, target in sorted(targets.items(), key=lambda item: item[1]["stableKey"]):
        available = sorted(
            candidates.get(key, []),
            key=lambda value: (
                priority.get(value.kind, 99),
                value.authority.lower(),
                str(value.path).lower(),
            ),
        )
        if not available:
            entry = {
                "stableKey": target["stableKey"],
                "cab": target["cab"],
                "pathId": target["pathId"],
                "status": "fail-closed",
                "runtimeReady": False,
                "runtimeUrl": None,
                "failClosedReasons": ["exact-runtime-texture-product-not-found"],
                "references": target["references"],
                "properties": sorted(target["properties"]),
                "modelCount": len(key_models[key]),
            }
            manifest_entries.append(entry)
            runtime_by_key[key] = entry
            continue
        selected = available[0]
        filename = runtime_filename(target["cab"], target["pathId"])
        output_path = output_texture_root / filename
        shutil.copyfile(selected.path, output_path)
        metadata = image_metadata(output_path)
        copied_bytes += output_path.stat().st_size
        entry = {
            "stableKey": target["stableKey"],
            "cab": target["cab"],
            "pathId": target["pathId"],
            "name": selected.name,
            "status": "runtime-ready",
            "runtimeReady": True,
            "runtimeUrl": f"/enemies/textures/{filename}",
            "runtimeFile": filename,
            "bytes": output_path.stat().st_size,
            **metadata,
            "colorSpace": selected.color_space,
            "wrap": {"u": selected.wrap_u, "v": selected.wrap_v},
            "filter": selected.filter_mode,
            "anisotropy": selected.anisotropy,
            "authority": {
                "kind": selected.kind,
                "source": selected.authority,
                "sourceBundleKey": selected.source_bundle_key,
            },
            "candidateCount": len(available),
            "references": target["references"],
            "properties": sorted(target["properties"]),
            "modelCount": len(key_models[key]),
            "failClosedReasons": [],
        }
        manifest_entries.append(entry)
        runtime_by_key[key] = entry

    product_summaries: list[dict[str, Any]] = []
    required_refs = missing_required_refs = all_refs = ready_refs = 0
    for material_path in material_paths:
        product = read_json(material_path)
        texture_failures: list[str] = []
        product_ref_count = product_ready_count = 0
        product_required_count = product_missing_required_count = 0
        for material in product.get("profiles", []):
            required = active_texture_properties(material)
            material["runtime"]["requiredTextureProperties"] = sorted(required)
            missing_required: list[str] = []
            for property_name, texture in material.get("textures", {}).items():
                product_ref_count += 1
                all_refs += 1
                key = normalized_key(texture.get("cab"), texture.get("pathId"))
                runtime = runtime_by_key.get(key or "")
                if runtime and runtime["runtimeReady"]:
                    product_ready_count += 1
                    ready_refs += 1
                    texture["sourceResolved"] = bool(texture.get("resolved"))
                    texture["resolved"] = True
                    texture["type"] = texture.get("type") or "Texture2D"
                    texture["name"] = texture.get("name") or runtime.get("name")
                    texture["runtimeReady"] = True
                    texture["runtimeFile"] = runtime["runtimeFile"]
                    texture["runtimeUrl"] = runtime["runtimeUrl"]
                    texture["runtimeAlpha"] = runtime["alpha"]
                    texture["runtimeColorSpace"] = runtime.get("colorSpace")
                    texture["runtimeWrap"] = runtime.get("wrap")
                    texture["runtimeFilter"] = runtime.get("filter")
                    texture["runtimeAnisotropy"] = runtime.get("anisotropy")
                    texture["runtimeAuthority"] = runtime["authority"]
                    texture.pop("failClosedReason", None)
                    texture.pop("runtimeFailClosedReasons", None)
                else:
                    texture["runtimeReady"] = False
                    texture["runtimeUrl"] = None
                    texture["runtimeFailClosedReasons"] = (
                        runtime["failClosedReasons"]
                        if runtime
                        else ["texture-stable-key-missing-from-runtime-manifest"]
                    )
                if property_name in required:
                    product_required_count += 1
                    required_refs += 1
                    if not runtime or not runtime["runtimeReady"]:
                        product_missing_required_count += 1
                        missing_required_refs += 1
                        missing_required.append(property_name)
            material["runtime"]["missingRequiredTextureProperties"] = sorted(
                missing_required
            )
            if missing_required:
                texture_failures.append(
                    f"{material['stableKey']}:missing-required-textures="
                    f"{','.join(sorted(missing_required))}"
                )
            main = material.get("runtime", {}).get("mainTextureProperty")
            if main and main in material.get("textures", {}):
                texture = material["textures"][main]
                material["runtime"]["mainTextureRuntimeFile"] = texture.get("runtimeFile")
                material["runtime"]["mainTextureAlpha"] = texture.get(
                    "runtimeAlpha",
                    {"present": False, "minimum": 255, "maximum": 255},
                )
        product["textureStatus"] = (
            "runtime-ready" if not texture_failures else "fail-closed"
        )
        product["textureRuntimeReady"] = not texture_failures
        product["textureFailClosedReasons"] = texture_failures
        product["counts"].update(
            {
                "runtimeTextureReferences": product_ready_count,
                "missingRuntimeTextureReferences": product_ref_count - product_ready_count,
                "requiredRuntimeTextureReferences": product_required_count,
                "missingRequiredRuntimeTextureReferences": product_missing_required_count,
            }
        )
        output_path = (
            args.output_enemy_root
            / "models"
            / product["modelPrefabName"]
            / "material-profile.v1.json"
        )
        write_json(output_path, product)
        product_summaries.append(
            {
                "modelPrefabName": product["modelPrefabName"],
                "textureRuntimeReady": product["textureRuntimeReady"],
                "runtimeTextureReferences": product_ready_count,
                "missingRuntimeTextureReferences": product_ref_count - product_ready_count,
                "requiredRuntimeTextureReferences": product_required_count,
                "missingRequiredRuntimeTextureReferences": product_missing_required_count,
            }
        )

    counts = {
        "models": len(material_paths),
        "uniqueTextureProducts": len(manifest_entries),
        "runtimeReadyTextureProducts": sum(
            entry["runtimeReady"] for entry in manifest_entries
        ),
        "failClosedTextureProducts": sum(
            not entry["runtimeReady"] for entry in manifest_entries
        ),
        "textureReferences": all_refs,
        "runtimeReadyTextureReferences": ready_refs,
        "failClosedTextureReferences": all_refs - ready_refs,
        "requiredTextureReferences": required_refs,
        "missingRequiredTextureReferences": missing_required_refs,
        "textureRuntimeReadyModels": sum(
            item["textureRuntimeReady"] for item in product_summaries
        ),
        "textureFailClosedModels": sum(
            not item["textureRuntimeReady"] for item in product_summaries
        ),
        "publishedBytes": copied_bytes,
        "declaredBundleTasks": len(direct_tasks),
        "declaredBundleMatches": direct_matches,
        "declaredBundleFailures": len(extract_failures),
        "cabIndexMappedBundles": len(cab_index_mapped_bundles),
        "stageProfilesRead": len(stage_profiles),
        "vfxProfilesRead": len(vfx_profiles),
    }
    manifest = {
        "schema": SCHEMA,
        "lookup": {
            "stableKey": "unity-object:cab=<CAB>|pathID=<pathID>",
            "idSpecialCases": False,
        },
        "sourceAuthority": {
            "enemyProducts": "public/enemies/models/*/{model-runtime.v1.json,material-profile.v1.json}",
            "boundedBundleRule": "only model-runtime sourceBundleKey/dependencyBundleKeys",
            "cabIndexFallback": str(args.cab_index),
            "stageFallback": "public/stages/official/*/scene-profile.json",
            "combatVfxFallback": str(args.vfx_product_root),
        },
        "counts": counts,
        "entries": manifest_entries,
    }
    write_json(args.output_enemy_root / "texture-runtime-products.v1.json", manifest)
    write_json(
        args.output_enemy_root / "texture-runtime-build-report.v1.json",
        {
            "schema": "magius.enemy-texture-runtime-build-report.v1",
            "counts": counts,
            "products": product_summaries,
            "extractFailures": sorted(
                extract_failures, key=lambda item: item["bundleKey"]
            ),
        },
    )
    print(json.dumps(counts, ensure_ascii=False))
    return 2 if extract_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
