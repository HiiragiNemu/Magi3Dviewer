#!/usr/bin/env python3
"""Build the Viewer enemy catalog from existing local JP/Steam/TW evidence."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


SCHEMA = "magius.enemy-resource-manifest.v1"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def mst_rows(path: Path) -> list[dict[str, Any]]:
    document = read_json(path)
    payload = document.get("payload", document)
    rows = payload.get("mstList")
    if not isinstance(rows, list):
        raise ValueError(f"mstList is missing from {path}")
    return rows


def clean_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value and value != "-" else None


def asset_bundle_key(logical_key: str) -> str:
    return f"AssetBundles/{logical_key}"


def catalog_lookup(path: Path) -> dict[str, dict[str, Any]]:
    document = read_json(path)
    payload = document.get("payload", document)
    paths = {
        int(row["pathId"]): str(row["path"])
        for row in payload["pathMappingMstList"]
    }
    return {
        f"{paths[int(row['pathId'])]}{row['name']}": row
        for row in payload["mstList"]
    }


def runtime_metadata(model_root: Path, model_name: str) -> dict[str, Any] | None:
    path = model_root / model_name / "model-runtime.v1.json"
    if not path.is_file():
        return None
    metadata = read_json(path)
    if metadata.get("schema") != "magius.enemy-model-runtime.v1":
        raise ValueError(f"Unsupported model runtime schema: {path}")
    return metadata


def material_profile_metadata(
    model_root: Path,
    model_name: str,
) -> dict[str, Any] | None:
    path = model_root / model_name / "material-profile.v1.json"
    if not path.is_file():
        return None
    metadata = read_json(path)
    if metadata.get("schema") != "magius.enemy-material-profile.v1":
        raise ValueError(f"Unsupported enemy material profile schema: {path}")
    if metadata.get("modelPrefabName") != model_name:
        raise ValueError(f"Enemy material profile identity mismatch: {path}")
    return metadata


def extract_thumbnail(source: Path, output: Path) -> None:
    import UnityPy  # Existing local extraction runtime; no network dependency.

    UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"

    environment = UnityPy.load(str(source))
    textures = [obj.read() for obj in environment.objects if obj.type.name == "Texture2D"]
    if len(textures) != 1:
        raise ValueError(f"Expected one Texture2D in {source}, found {len(textures)}")
    output.parent.mkdir(parents=True, exist_ok=True)
    textures[0].image.save(output)


def build_manifest(args: argparse.Namespace) -> dict[str, Any]:
    jp_rows = [row for row in mst_rows(args.jp_enemy_master) if int(row["enemyType"]) != 4]
    en_by_id = {int(row["enemyMstId"]): row for row in mst_rows(args.en_enemy_master)}
    tw_by_id = {int(row["enemyMstId"]): row for row in mst_rows(args.tw_enemy_master)}
    jp_by_id = {int(row["enemyMstId"]): row for row in jp_rows}

    appearances = mst_rows(args.appearance_master)
    skill_set_rows = mst_rows(args.skill_set_master)
    skills = {int(row["skillMstId"]): row for row in mst_rows(args.skill_master)}
    skill_ids_by_set: dict[int, set[int]] = defaultdict(set)
    for row in skill_set_rows:
        skill_ids_by_set[int(row["enemySkillSetId"])].add(int(row["skillMstId"]))
    skill_sets_by_enemy: dict[int, set[int]] = defaultdict(set)
    for row in appearances:
        skill_sets_by_enemy[int(row["enemyMstId"])].add(int(row["enemySkillSetId"]))

    catalog = catalog_lookup(args.catalog)
    entries: list[dict[str, Any]] = []
    model_names: set[str] = set()
    family_ids: set[int] = set()
    render_ready_models: set[str] = set()
    material_profile_models: set[str] = set()
    material_profile_runtime_ready_models: set[str] = set()
    thumbnail_names: set[str] = set()

    for row in sorted(jp_rows, key=lambda value: int(value["enemyMstId"])):
        enemy_id = int(row["enemyMstId"])
        family_id = int(row["enemyUniqueId"])
        model_name = str(row["modelPrefabName"])
        icon_name = str(row["iconResourceName"])
        model_names.add(model_name)
        family_ids.add(family_id)
        thumbnail_names.add(icon_name)

        model_logical_key = f"battle/enemy/{model_name}"
        model_catalog = catalog.get(model_logical_key)
        if model_catalog is None:
            raise ValueError(f"Steam model catalog entry is missing: {model_logical_key}")
        model_source = args.asset_root / Path(model_logical_key)
        if not model_source.is_file():
            raise ValueError(f"Steam model bundle is missing: {model_source}")

        dependencies = [
            value
            for value in str(model_catalog.get("dependencies", "")).split(",")
            if value
        ]
        metadata = runtime_metadata(args.model_root, model_name)
        material_profile = material_profile_metadata(args.model_root, model_name)
        if metadata is not None:
            render_ready_models.add(model_name)
        elif args.require_runtime:
            raise ValueError(f"Model runtime is missing: {model_name}")
        if material_profile is not None:
            material_profile_models.add(model_name)
            if material_profile.get("runtimeReady") is True:
                material_profile_runtime_ready_models.add(model_name)

        skill_set_ids = sorted(skill_sets_by_enemy.get(enemy_id, set()))
        exact_skill_ids = sorted(
            {
                skill_id
                for skill_set_id in skill_set_ids
                for skill_id in skill_ids_by_set.get(skill_set_id, set())
            }
        )
        exact_directions: dict[str, dict[str, Any]] = {}
        for skill_id in exact_skill_ids:
            skill = skills.get(skill_id)
            if skill is None:
                continue
            direction = str(skill.get("directionName", ""))
            if not direction:
                continue
            logical_key = f"battle/skill/{direction}"
            catalog_row = catalog.get(logical_key)
            local_path = args.asset_root / Path(logical_key)
            exact_directions[direction] = {
                "directionName": direction,
                "bundleKey": asset_bundle_key(logical_key) if catalog_row else None,
                "localBundleAvailable": local_path.is_file(),
                "skillMstIds": [],
                "skillTypes": [],
                "hitEffectResourceNames": [],
            }
        for skill_id in exact_skill_ids:
            skill = skills.get(skill_id)
            if skill is None:
                continue
            direction = str(skill.get("directionName", ""))
            target = exact_directions.get(direction)
            if target is None:
                continue
            target["skillMstIds"].append(skill_id)
            target["skillTypes"].append(int(skill["type"]))
            effect = clean_name(skill.get("hitEffectResourceName"))
            if effect:
                target["hitEffectResourceNames"].append(effect)
        for target in exact_directions.values():
            target["skillMstIds"] = sorted(set(target["skillMstIds"]))
            target["skillTypes"] = sorted(set(target["skillTypes"]))
            target["hitEffectResourceNames"] = sorted(
                set(target["hitEffectResourceNames"])
            )

        en = en_by_id.get(enemy_id, {})
        tw = tw_by_id.get(enemy_id, {})
        jp = jp_by_id[enemy_id]
        thumbnail_source = args.asset_root / "enemy" / f"{icon_name}_thumbnail"
        thumbnail_output = args.thumbnail_root / f"{icon_name}.png"
        if args.extract_thumbnails and not thumbnail_output.is_file():
            if not thumbnail_source.is_file():
                raise ValueError(f"Thumbnail bundle is missing: {thumbnail_source}")
            extract_thumbnail(thumbnail_source, thumbnail_output)

        entries.append(
            {
                "enemyMstId": enemy_id,
                "enemyUniqueId": family_id,
                "enemyType": int(row["enemyType"]),
                "size": int(row["size"]),
                "modelPrefabName": model_name,
                "names": {
                    "en": clean_name(en.get("name")),
                    "ja": clean_name(jp.get("name")),
                    "zhHant": clean_name(tw.get("name")),
                    "runes": clean_name(row.get("runesName")),
                },
                "model": {
                    "bundleKey": asset_bundle_key(model_logical_key),
                    "runtimeUrl": (
                        f"/enemies/models/{model_name}/VisualRoot.fbxdata"
                        if metadata is not None
                        else None
                    ),
                    "materialProfileUrl": (
                        f"/enemies/models/{model_name}/material-profile.v1.json"
                        if material_profile is not None
                        else None
                    ),
                    "rootName": model_name,
                    "renderReady": metadata is not None,
                    "modelBundleKeys": [
                        asset_bundle_key(value)
                        for value in dependencies
                        if value.startswith("model/")
                    ],
                    "animatorBundleKeys": [
                        asset_bundle_key(value)
                        for value in dependencies
                        if value.startswith("animator/")
                    ],
                    "textureBundleKeys": [
                        asset_bundle_key(value)
                        for value in dependencies
                        if value.startswith("texture/")
                    ],
                    "shaderBundleKeys": [
                        asset_bundle_key(value)
                        for value in dependencies
                        if value.startswith("shader/")
                    ],
                    "controllers": metadata.get("controllers", []) if metadata else [],
                    "baseClips": metadata.get("clips", []) if metadata else [],
                    "materialObjects": metadata.get("materials", []) if metadata else [],
                },
                "actions": {
                    "enemySkillSetIds": skill_set_ids,
                    "directions": sorted(
                        exact_directions.values(),
                        key=lambda value: value["directionName"],
                    ),
                },
                "effects": {
                    "appearEffectPrefabName": clean_name(
                        row.get("appearEffectPrefabName")
                    ),
                    "skillDirectionBundleKeys": sorted(
                        {
                            value["bundleKey"]
                            for value in exact_directions.values()
                            if value["bundleKey"] is not None
                        }
                    ),
                },
                "thumbnail": {
                    "resourceName": icon_name,
                    "bundleKey": asset_bundle_key(
                        f"enemy/{icon_name}_thumbnail"
                    ),
                    "url": (
                        f"/enemies/thumbnails/{icon_name}.png"
                        if thumbnail_output.is_file()
                        else None
                    ),
                    "originalBundleKey": asset_bundle_key(
                        f"enemy/{icon_name}_original"
                    ),
                    "previewUrl": None,
                },
            }
        )

    manifest = {
        "schema": SCHEMA,
        "sourceAuthority": {
            "records": "authority://enemy-master/ja/getEnemyMstList.json",
            "englishNames": "authority://enemy-master/en/getEnemyMstList.json",
            "traditionalChineseNames": "authority://enemy-master/zhHant/getEnemyMstList.json",
            "steamResourceCatalog": "authority://steam-resource-catalog/get_resource_asset_bundle_mst_list.json",
            "assetRoot": "authority://official-assetbundles/",
        },
        "displayNameFallback": {
            "zh": ["zhHant", "en", "ja", "runes", "enemyMstId"],
            "ja": ["ja", "en", "zhHant", "runes", "enemyMstId"],
            "default": ["en", "ja", "zhHant", "runes", "enemyMstId"],
        },
        "counts": {
            "enemyRecords": len(entries),
            "modelResources": len(model_names),
            "enemyFamilies": len(family_ids),
            "renderReadyModels": len(render_ready_models),
            "materialProfileModels": len(material_profile_models),
            "materialProfileRuntimeReadyModels": len(
                material_profile_runtime_ready_models
            ),
            "localizedNames": {
                "en": sum(entry["names"]["en"] is not None for entry in entries),
                "ja": sum(entry["names"]["ja"] is not None for entry in entries),
                "zhHant": sum(
                    entry["names"]["zhHant"] is not None for entry in entries
                ),
            },
            "thumbnailResources": sum(
                entry["thumbnail"]["url"] is not None for entry in entries
            ),
        },
        "entries": entries,
    }
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--jp-enemy-master",
        type=Path,
        default=Path(
            r"D:\magia\magia_exedra_jp_data\manifests\ja-Jpan\getEnemyMstList.json"
        ),
    )
    parser.add_argument(
        "--en-enemy-master",
        type=Path,
        default=Path(
            r"C:\Users\proje\AppData\Local\MagiaExedraJPFullGallery\manifests\steam-ja-Jpan\getEnemyMstList.json"
        ),
    )
    parser.add_argument(
        "--tw-enemy-master",
        type=Path,
        default=Path(
            r"D:\magia\MyProducts\MagiaExedraTWData\MasterData\active\tables\getEnemyMstList.json"
        ),
    )
    full_gallery = Path(
        r"C:\Users\proje\AppData\Local\MagiaExedraJPFullGallery\manifests\steam-ja-Jpan"
    )
    parser.add_argument(
        "--appearance-master",
        type=Path,
        default=full_gallery / "getQuestEnemyAppearanceMstList.json",
    )
    parser.add_argument(
        "--skill-set-master",
        type=Path,
        default=full_gallery / "getQuestEnemySkillSetMstList.json",
    )
    parser.add_argument(
        "--skill-master",
        type=Path,
        default=full_gallery / "getSkillMstList.json",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path(
            r"D:\magia\.codex-work\steam-fullgallery-runtime-20260820-v4\home\resource-catalogs\steam-ja-Jpan\get_resource_asset_bundle_mst_list.json"
        ),
    )
    parser.add_argument(
        "--asset-root",
        type=Path,
        default=Path(
            r"D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles"
        ),
    )
    repository = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--model-root",
        type=Path,
        default=repository / "public" / "enemies" / "models",
    )
    parser.add_argument(
        "--thumbnail-root",
        type=Path,
        default=repository / "public" / "enemies" / "thumbnails",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repository / "public" / "enemies" / "manifest.v1.json",
    )
    parser.add_argument("--extract-thumbnails", action="store_true")
    parser.add_argument("--require-runtime", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = build_manifest(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "ok": True,
                "output": str(args.output),
                "counts": manifest["counts"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
