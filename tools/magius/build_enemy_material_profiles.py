#!/usr/bin/env python3
"""Publish exact serialized enemy material profiles for existing Viewer models.

The input set is the already-published ``model-runtime.v1.json`` corpus.  The
tool opens only each product's declared source/dependency closure; it does not
enumerate the upstream AssetBundles inventory.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "magius.enemy-material-profile.v1"
RUNTIME_SCHEMA = "magius.enemy-model-runtime.v1"
UNITY_VERSION = "2022.3.62f2"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def finite_number(value: Any) -> float | int:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"Non-finite serialized material number: {value!r}")
    return int(number) if number.is_integer() else number


def vector(value: Any, fields: tuple[str, ...]) -> list[float | int]:
    return [finite_number(getattr(value, field)) for field in fields]


def tuples_to_number_maps(
    values: Iterable[Any],
) -> tuple[dict[str, float | int], dict[str, str]]:
    result: dict[str, float | int] = {}
    non_finite: dict[str, str] = {}
    for item in values:
        key, value = item
        number = float(value)
        if math.isfinite(number):
            result[str(key)] = int(number) if number.is_integer() else number
        else:
            non_finite[str(key)] = (
                "positive-infinity"
                if number > 0
                else "negative-infinity"
                if number < 0
                else "nan"
            )
    return dict(sorted(result.items())), dict(sorted(non_finite.items()))


def tuples_to_color_maps(
    values: Iterable[Any],
) -> tuple[dict[str, list[float | int]], dict[str, list[float | int | str]]]:
    result: dict[str, list[float | int]] = {}
    non_finite: dict[str, list[float | int | str]] = {}
    for key, value in values:
        components = [float(getattr(value, field)) for field in ("r", "g", "b", "a")]
        if all(math.isfinite(component) for component in components):
            result[str(key)] = [
                int(component) if component.is_integer() else component
                for component in components
            ]
        else:
            non_finite[str(key)] = [
                int(component)
                if math.isfinite(component) and component.is_integer()
                else component
                if math.isfinite(component)
                else "positive-infinity"
                if component > 0
                else "negative-infinity"
                if component < 0
                else "nan"
                for component in components
            ]
    return dict(sorted(result.items())), dict(sorted(non_finite.items()))


def pointer_external_cab(pointer: Any) -> str | None:
    if int(pointer.path_id) == 0:
        return None
    if int(pointer.file_id) == 0:
        return str(pointer.assetsfile.name)
    index = int(pointer.file_id) - 1
    externals = pointer.assetsfile.externals
    if index < 0 or index >= len(externals):
        return None
    return str(externals[index].name)


def pointer_record(pointer: Any, cab_to_bundle: dict[str, str]) -> dict[str, Any] | None:
    path_id = int(pointer.path_id)
    if path_id == 0:
        return None
    cab = pointer_external_cab(pointer)
    record: dict[str, Any] = {
        "stableKey": f"unity-object:cab={cab or 'unresolved'}|pathID={path_id}",
        "pathId": str(path_id),
        "cab": cab,
        "bundleKey": cab_to_bundle.get((cab or "").lower()),
        "resolved": False,
        "type": None,
        "name": None,
    }
    try:
        reader = pointer.deref()
        record.update(
            {
                "stableKey": (
                    f"unity-object:cab={reader.assets_file.name}|pathID={path_id}"
                ),
                "cab": str(reader.assets_file.name),
                "bundleKey": cab_to_bundle.get(str(reader.assets_file.name).lower()),
                "resolved": True,
                "type": str(reader.type.name),
                "name": str(reader.peek_name() or ""),
            }
        )
    except Exception as error:
        record["failClosedReason"] = f"{type(error).__name__}: {error}"
    return record


def game_object_hierarchy_path(game_object: Any) -> str:
    names: list[str] = []
    seen: set[tuple[str, int]] = set()
    try:
        transform = game_object.m_Transform.deref_parse_as_object()
        while True:
            current_game_object = transform.m_GameObject.deref_parse_as_object()
            names.append(str(current_game_object.m_Name))
            father = transform.m_Father
            identity = (str(father.assetsfile.name), int(father.path_id))
            if int(father.path_id) == 0 or identity in seen:
                break
            seen.add(identity)
            transform = father.deref_parse_as_object()
    except Exception:
        if not names:
            names.append(str(getattr(game_object, "m_Name", "")))
    return "/".join(reversed([name for name in names if name]))


def alpha_extrema(path: Path) -> dict[str, int | bool]:
    from PIL import Image

    with Image.open(path) as image:
        if "A" not in image.getbands() and "transparency" not in image.info:
            return {"present": False, "minimum": 255, "maximum": 255}
        alpha = image.convert("RGBA").getchannel("A")
        minimum, maximum = alpha.getextrema()
        return {
            "present": minimum < 255,
            "minimum": int(minimum),
            "maximum": int(maximum),
        }


def material_runtime_projection(
    material: dict[str, Any],
    model_directory: Path,
    runtime_files: dict[str, str],
) -> dict[str, Any]:
    floats = material["serializedFloats"]
    colors = material["serializedColors"]
    keywords = {str(value).upper() for value in material["validKeywords"]}
    render_queue = int(material["renderQueue"])
    surface = float(floats.get("_Surface", 0))
    transparent = (
        surface > 0.5
        or render_queue >= 3000
        or "_SURFACE_TYPE_TRANSPARENT" in keywords
    )
    main_property = next(
        (name for name in ("_MainTex", "_BaseMap") if name in material["textures"]),
        None,
    )
    main_texture = material["textures"].get(main_property) if main_property else None
    runtime_file = None
    runtime_alpha = {"present": False, "minimum": 255, "maximum": 255}
    if main_texture and main_texture.get("name"):
        runtime_file = runtime_files.get(str(main_texture["name"]).lower())
        if runtime_file:
            runtime_alpha = alpha_extrema(model_directory / runtime_file)
            main_texture["runtimeFile"] = runtime_file
            main_texture["runtimeUrl"] = (
                f"/enemies/models/{model_directory.name}/{runtime_file}"
            )
            main_texture["runtimeAlpha"] = runtime_alpha

    explicit_alpha_test = (
        "_ALPHATEST_ON" in keywords
        or float(floats.get("_AlphaClip", 0)) != 0
    )
    serialized_enemy_threshold = "_AlphaClippingThreshold" in floats
    alpha_test_enabled = (
        not transparent
        and bool(runtime_alpha["present"])
        and (explicit_alpha_test or serialized_enemy_threshold)
    )
    threshold = float(
        floats.get(
            "_Alpha_Clip",
            floats.get(
                "_Cutoff",
                floats.get("_AlphaClippingThreshold", 0.5),
            ),
        )
    )
    src_blend = int(float(floats.get("_SrcBlend", 1)))
    dst_blend = int(float(floats.get("_DstBlend", 0)))
    if transparent and (src_blend, dst_blend) == (5, 1):
        blending = "additive"
    elif transparent and (src_blend, dst_blend) == (2, 0):
        blending = "multiply"
    else:
        blending = "normal"
    cull = int(float(floats.get("_Cull", 2)))
    side = {0: "double", 1: "back", 2: "front"}.get(cull, "front")
    color = colors.get("_BaseColor") or colors.get("_Color")
    emission = colors.get("_EmissionColor")
    return {
        "mainTextureProperty": main_property,
        "mainTextureRuntimeFile": runtime_file,
        "mainTextureAlpha": runtime_alpha,
        "transparent": transparent,
        "depthWrite": float(floats.get("_ZWrite", 1)) != 0,
        "alphaToCoverage": float(floats.get("_AlphaToMask", 0)) != 0,
        "alphaTest": {
            "enabled": alpha_test_enabled,
            "threshold": threshold,
            "authority": (
                "serialized-alpha-flag+runtime-texture-alpha"
                if explicit_alpha_test
                else "serialized-enemy-threshold+runtime-texture-alpha"
                if serialized_enemy_threshold and runtime_alpha["present"]
                else "disabled"
            ),
        },
        "blending": blending,
        "sourceBlend": src_blend,
        "destinationBlend": dst_blend,
        "side": side,
        "color": color,
        "emissionColor": emission,
        "castShadow": (
            "SHADOWCASTER"
            not in {str(value).upper() for value in material["disabledShaderPasses"]}
            and float(floats.get("_CastShadows", 1)) != 0
        ),
        "receiveShadow": (
            "_RECEIVE_SHADOWS_OFF" not in keywords
            and float(floats.get("_ReceiveShadows", 1)) != 0
        ),
    }


def bundle_path(asset_root: Path, key: str) -> Path:
    prefix = "AssetBundles/"
    if not key.startswith(prefix):
        raise ValueError(f"Invalid AssetBundles stable key: {key}")
    return asset_root / Path(key[len(prefix) :])


def build_one(task: tuple[str, str, str]) -> dict[str, Any]:
    model_directory = Path(task[0])
    output_directory = Path(task[1])
    asset_root = Path(task[2])
    runtime_path = model_directory / "model-runtime.v1.json"
    runtime = read_json(runtime_path)
    if runtime.get("schema") != RUNTIME_SCHEMA:
        raise ValueError(f"Unsupported model runtime schema: {runtime_path}")

    import UnityPy
    from UnityPy import config

    config.FALLBACK_UNITY_VERSION = runtime.get("unityVersion") or UNITY_VERSION
    keys = list(
        dict.fromkeys(
            [runtime["sourceBundleKey"], *runtime.get("dependencyBundleKeys", [])]
        )
    )
    paths = [bundle_path(asset_root, key) for key in keys]
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Declared enemy closure is missing: {missing}")
    environment = UnityPy.load(*[str(path) for path in paths])
    cab_to_bundle: dict[str, str] = {}
    path_to_key = {str(path.resolve()).lower(): key for path, key in zip(paths, keys)}
    for loaded_path, bundle in environment.files.items():
        key = path_to_key.get(str(Path(loaded_path).resolve()).lower())
        if not key:
            continue
        for cab in getattr(bundle, "files", {}).keys():
            cab_to_bundle[str(cab).lower()] = key

    requested = {
        (str(item["pathId"]), str(item["name"]))
        for item in runtime.get("materials", [])
    }
    renderer_bundle_keys = {
        runtime["sourceBundleKey"],
        *runtime.get("modelBundleKeys", []),
    }
    renderer_bindings: list[dict[str, Any]] = []
    renderer_material_keys: set[str] = set()
    unresolved_renderer_materials: list[dict[str, Any]] = []
    for reader in environment.objects:
        if reader.type.name not in ("SkinnedMeshRenderer", "MeshRenderer"):
            continue
        source_bundle_key = cab_to_bundle.get(str(reader.assets_file.name).lower())
        if source_bundle_key not in renderer_bundle_keys:
            continue
        renderer = reader.read()
        try:
            game_object = renderer.m_GameObject.deref_parse_as_object()
            game_object_name = str(game_object.m_Name)
            hierarchy_path = game_object_hierarchy_path(game_object)
            active = bool(getattr(game_object, "m_IsActive", True))
        except Exception:
            game_object_name = ""
            hierarchy_path = ""
            active = True
        mesh_pointer = getattr(renderer, "m_Mesh", None)
        mesh = pointer_record(mesh_pointer, cab_to_bundle) if mesh_pointer else None
        mesh_name = str((mesh or {}).get("name") or game_object_name)
        mesh_vertex_count = None
        mesh_index_count = None
        mesh_submesh_count = None
        if mesh_pointer and int(mesh_pointer.path_id) != 0:
            try:
                mesh_object = mesh_pointer.deref_parse_as_object()
                mesh_vertex_count = int(mesh_object.m_VertexData.m_VertexCount)
                mesh_submesh_count = len(mesh_object.m_SubMeshes)
                mesh_index_count = sum(
                    int(submesh.indexCount) for submesh in mesh_object.m_SubMeshes
                )
            except Exception:
                pass
        material_keys: list[str | None] = []
        for slot, pointer in enumerate(renderer.m_Materials):
            material_pointer = pointer_record(pointer, cab_to_bundle)
            if material_pointer is None:
                material_keys.append(None)
                continue
            stable_key = str(material_pointer["stableKey"]).replace(
                "unity-object:",
                "unity-material:",
                1,
            )
            material_keys.append(stable_key)
            if material_pointer.get("resolved"):
                renderer_material_keys.add(stable_key)
            else:
                unresolved_renderer_materials.append(
                    {
                        "rendererPathId": str(reader.path_id),
                        "gameObjectName": game_object_name,
                        "meshName": mesh_name,
                        "materialSlot": slot,
                        "materialStableKey": stable_key,
                        "reason": material_pointer.get("failClosedReason")
                        or "unresolved-material-pointer",
                    }
                )
        renderer_bindings.append(
            {
                "stableKey": (
                    f"unity-renderer:cab={reader.assets_file.name}|pathID={reader.path_id}"
                ),
                "rendererType": str(reader.type.name),
                "rendererPathId": str(reader.path_id),
                "sourceCab": str(reader.assets_file.name),
                "sourceBundleKey": source_bundle_key,
                "priority": (
                    0 if source_bundle_key == runtime["sourceBundleKey"] else 1
                ),
                "enabled": bool(getattr(renderer, "m_Enabled", True)),
                "active": active,
                "gameObjectName": game_object_name,
                "hierarchyPath": hierarchy_path,
                "meshName": mesh_name,
                "meshStableKey": (mesh or {}).get("stableKey"),
                "meshVertexCount": mesh_vertex_count,
                "meshIndexCount": mesh_index_count,
                "meshSubmeshCount": mesh_submesh_count,
                "materialProfileKeys": material_keys,
            }
        )
    renderer_bindings.sort(
        key=lambda value: (
            value["priority"],
            value["gameObjectName"],
            value["meshName"],
            value["stableKey"],
        )
    )
    profiles: list[dict[str, Any]] = []
    covered: set[tuple[str, str]] = set()
    runtime_files = {
        Path(name).stem.lower(): str(name)
        for name in runtime.get("runtime", {}).get("textureFiles", [])
    }
    for reader in environment.objects:
        if reader.type.name != "Material":
            continue
        material = reader.read()
        identity = (str(reader.path_id), str(material.m_Name))
        stable_key = (
            f"unity-material:cab={reader.assets_file.name}|pathID={reader.path_id}"
        )
        if identity not in requested and stable_key not in renderer_material_keys:
            continue
        covered.add(identity)
        saved = material.m_SavedProperties
        shader = pointer_record(material.m_Shader, cab_to_bundle)
        textures: dict[str, Any] = {}
        for property_name, texture_env in saved.m_TexEnvs:
            pointer = pointer_record(texture_env.m_Texture, cab_to_bundle)
            if pointer is None:
                continue
            pointer["scale"] = vector(texture_env.m_Scale, ("x", "y"))
            pointer["offset"] = vector(texture_env.m_Offset, ("x", "y"))
            textures[str(property_name)] = pointer
        serialized_floats, non_finite_floats = tuples_to_number_maps(saved.m_Floats)
        serialized_ints, non_finite_ints = tuples_to_number_maps(
            getattr(saved, "m_Ints", [])
        )
        serialized_colors, non_finite_colors = tuples_to_color_maps(saved.m_Colors)
        profile: dict[str, Any] = {
            "stableKey": stable_key,
            "pathId": str(reader.path_id),
            "materialName": str(material.m_Name),
            "sourceCab": str(reader.assets_file.name),
            "sourceBundleKey": cab_to_bundle.get(str(reader.assets_file.name).lower()),
            "shader": shader,
            "renderQueue": int(material.m_CustomRenderQueue),
            "validKeywords": sorted(str(value) for value in material.m_ValidKeywords),
            "invalidKeywords": sorted(
                str(value) for value in material.m_InvalidKeywords
            ),
            "legacyShaderKeywords": (
                str(material.m_ShaderKeywords)
                if getattr(material, "m_ShaderKeywords", None)
                else None
            ),
            "disabledShaderPasses": sorted(
                str(value)
                for value in getattr(material, "m_DisabledShaderPasses", [])
            ),
            "serializedFloats": serialized_floats,
            "serializedNonFiniteFloats": non_finite_floats,
            "serializedInts": serialized_ints,
            "serializedNonFiniteInts": non_finite_ints,
            "serializedColors": serialized_colors,
            "serializedNonFiniteColors": non_finite_colors,
            "textures": dict(sorted(textures.items())),
        }
        profile["runtime"] = material_runtime_projection(
            profile,
            model_directory,
            runtime_files,
        )
        profiles.append(profile)
    profiles.sort(key=lambda value: (value["materialName"], value["stableKey"]))
    profile_keys = {profile["stableKey"] for profile in profiles}
    missing_renderer_profile_keys = sorted(renderer_material_keys - profile_keys)

    missing_materials = sorted(requested - covered)
    fail_closed_reasons: list[str] = []
    if missing_materials:
        fail_closed_reasons.append(
            "declared-material-object-not-resolved:" + json.dumps(missing_materials)
        )
    if unresolved_renderer_materials:
        fail_closed_reasons.append(
            f"unresolved-renderer-material-slots:{len(unresolved_renderer_materials)}"
        )
    if missing_renderer_profile_keys:
        fail_closed_reasons.append(
            "renderer-material-profile-not-published:"
            + json.dumps(missing_renderer_profile_keys)
        )
    output = {
        "schema": SCHEMA,
        "modelPrefabName": runtime["modelPrefabName"],
        "sourceBundleKey": runtime["sourceBundleKey"],
        "lookup": {
            "primary": "materialName",
            "disambiguation": "mainTextureRuntimeFile",
            "idSpecialCases": False,
        },
        "status": "runtime-ready" if not fail_closed_reasons else "fail-closed",
        "runtimeReady": not fail_closed_reasons,
        "failClosedReasons": fail_closed_reasons,
        "counts": {
            "declaredMaterialObjects": len(requested),
            "resolvedMaterialObjects": len(requested & covered),
            "materialProfiles": len(profiles),
            "runtimeTextureFiles": len(runtime_files),
            "rendererBindings": len(renderer_bindings),
            "rendererBoundMaterialProfiles": len(renderer_material_keys),
            "alphaTestProfiles": sum(
                bool(profile["runtime"]["alphaTest"]["enabled"])
                for profile in profiles
            ),
            "transparentProfiles": sum(
                bool(profile["runtime"]["transparent"]) for profile in profiles
            ),
        },
        "rendererBindings": renderer_bindings,
        "unresolvedRendererMaterials": unresolved_renderer_materials,
        "profiles": profiles,
    }
    output_path = output_directory / model_directory.name / "material-profile.v1.json"
    write_json(output_path, output)
    return {
        "modelPrefabName": runtime["modelPrefabName"],
        "output": str(output_path),
        "runtimeReady": output["runtimeReady"],
        **output["counts"],
        "bytes": output_path.stat().st_size,
    }


def parse_args() -> argparse.Namespace:
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-root",
        type=Path,
        default=repository / "public" / "enemies" / "models",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=repository / "public" / "enemies" / "models",
    )
    parser.add_argument(
        "--asset-root",
        type=Path,
        default=Path(r"D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles"),
    )
    parser.add_argument("--model", action="append", default=[])
    parser.add_argument(
        "--workers",
        type=int,
        default=max(1, min(6, (os.cpu_count() or 2) // 2)),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    requested = set(args.model)
    model_directories = sorted(
        path
        for path in args.model_root.iterdir()
        if path.is_dir()
        and (path / "model-runtime.v1.json").is_file()
        and (not requested or path.name in requested)
    )
    if requested - {path.name for path in model_directories}:
        raise ValueError(
            f"Requested model products are absent: "
            f"{sorted(requested - {path.name for path in model_directories})}"
        )
    if not model_directories:
        raise ValueError("No enemy model products matched")

    tasks = [
        (str(path), str(args.output_root), str(args.asset_root))
        for path in model_directories
    ]
    summaries: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    warnings.filterwarnings("ignore", message="No valid Unity version found")
    workers = max(1, min(args.workers, len(tasks)))
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(build_one, task): Path(task[0]).name for task in tasks}
        for index, future in enumerate(as_completed(futures), 1):
            model = futures[future]
            try:
                summaries.append(future.result())
            except Exception as error:
                failures.append(
                    {"modelPrefabName": model, "error": f"{type(error).__name__}: {error}"}
                )
            if index % 25 == 0 or index == len(futures):
                print(
                    f"ENEMY_MATERIAL_PROFILE_PROGRESS={index}/{len(futures)} "
                    f"FAILURES={len(failures)}",
                    flush=True,
                )
    summaries.sort(key=lambda value: value["modelPrefabName"])
    report = {
        "schema": "magius.enemy-material-profile-build-report.v1",
        "requested": len(tasks),
        "completed": len(summaries),
        "runtimeReady": sum(item["runtimeReady"] for item in summaries),
        "failClosed": sum(not item["runtimeReady"] for item in summaries),
        "failed": len(failures),
        "materialProfiles": sum(item["materialProfiles"] for item in summaries),
        "alphaTestProfiles": sum(item["alphaTestProfiles"] for item in summaries),
        "transparentProfiles": sum(item["transparentProfiles"] for item in summaries),
        "bytes": sum(item["bytes"] for item in summaries),
        "products": summaries,
        "failures": sorted(failures, key=lambda value: value["modelPrefabName"]),
    }
    report_path = args.output_root / "material-profile-build-report.v1.json"
    write_json(report_path, report)
    print(json.dumps({**{k: report[k] for k in (
        "requested", "completed", "runtimeReady", "failClosed", "failed",
        "materialProfiles", "alphaTestProfiles", "transparentProfiles", "bytes",
    )}, "report": str(report_path)}, ensure_ascii=False))
    return 2 if failures or report["failClosed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
