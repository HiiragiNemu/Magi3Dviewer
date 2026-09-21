#!/usr/bin/env python3
"""Build bounded Steam/JP combat Timeline authority for Viewer characters.

The output is research/build input.  It never edits Viewer source, UI, shader,
scene, or dist files and it never infers identity from a display label.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import re
from pathlib import Path
from typing import Any, Iterable

import UnityPy
import UnityPy.config


UNITY_VERSION = "2022.3.62f2"
UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repository-root",
        type=Path,
        default=Path(r"D:\magia\MyProducts\Magius3Dviewer-JP"),
    )
    parser.add_argument(
        "--masterdata-root",
        type=Path,
        default=Path(
            r"C:\Users\proje\AppData\Local\MagiaExedraJPFullGallery"
            r"\manifests\steam-ja-Jpan"
        ),
    )
    parser.add_argument(
        "--steam-asset-root",
        type=Path,
        default=Path(r"D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles"),
    )
    parser.add_argument(
        "--jp-mobile-asset-root",
        type=Path,
        default=Path(r"D:\magia\Madoka Magica Magia Exedra JP_GL\AssetBundles"),
    )
    parser.add_argument(
        "--tw-asset-root",
        type=Path,
        default=Path(r"D:\magia\Madoka Magica Magia Exedra TW\AssetBundles"),
    )
    parser.add_argument(
        "--tw-masterdata-root",
        type=Path,
        default=Path(r"D:\magia\Madoka Magica Magia Exedra TW\MasterData\active\tables"),
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def read_rows(root: Path, name: str) -> list[dict[str, Any]]:
    value = json.loads((root / name).read_text(encoding="utf-8"))
    payload = value.get("payload", value) if isinstance(value, dict) else value
    rows = payload.get("mstList", payload) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise TypeError(f"{root / name} has no mstList")
    return rows


def path_id(value: Any) -> int:
    if isinstance(value, dict):
        return int(value.get("m_PathID", value.get("path_id", 0)) or 0)
    return int(getattr(value, "path_id", 0) or 0)


def finite_number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def object_name(obj: Any) -> str:
    try:
        return str(getattr(obj.read(), "m_Name", "") or "")
    except Exception:
        return ""


def object_tree(obj: Any) -> dict[str, Any] | None:
    try:
        value = obj.read_typetree()
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def viewer_model_ids(model_root: Path) -> list[int]:
    result: list[int] = []
    pattern = re.compile(r"chara_(\d{6})_(?:battle_unit|model)")
    for directory in model_root.iterdir():
        match = pattern.fullmatch(directory.name)
        if not directory.is_dir() or not match:
            continue
        if any(
            file.is_file() and file.name.endswith((".fbx", ".fbx.gz", ".fbxdata"))
            for file in directory.iterdir()
        ):
            result.append(int(match.group(1)))
    return sorted(set(result))


def canonical_styles(
    model_ids: Iterable[int],
    styles: list[dict[str, Any]],
    figures: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
    figures_by_model: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
    for figure in figures:
        match = re.fullmatch(r"chara_(\d{6})_battle_unit", str(figure.get("modelName", "")))
        if match:
            figures_by_model[int(match.group(1))].append(figure)

    candidates: list[dict[str, Any]] = []
    style_by_figure: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
    for style in styles:
        style_by_figure[int(style.get("styleFigureMstId", 0) or 0)].append(style)
    for model_id in model_ids:
        for figure in figures_by_model.get(model_id, []):
            for style in style_by_figure.get(int(figure["styleFigureMstId"]), []):
                candidates.append({"characterId": model_id, "figure": figure, "style": style})

    grouped: dict[tuple[Any, ...], list[dict[str, Any]]] = collections.defaultdict(list)
    for candidate in candidates:
        style = candidate["style"]
        grouped[
            (
                candidate["characterId"],
                str(style.get("resourceName", "")),
            )
        ].append(candidate)

    def score(candidate: dict[str, Any]) -> tuple[int, int]:
        style = candidate["style"]
        resource_name = str(style.get("resourceName", ""))
        style_id = int(style.get("styleMstId", 0) or 0)
        return (int(resource_name.isdigit() and style_id == int(resource_name)), style_id)

    canonical = []
    for group in grouped.values():
        exact = [candidate for candidate in group if score(candidate)[0] == 1]
        # Steam snapshots retain one early fixture row (styleMstId=200) whose
        # skill chain differs from the production 10020201 row.  The canonical
        # style identity is the row whose numeric styleMstId equals resourceName.
        canonical.extend(exact if exact else [max(group, key=score)])
    canonical.sort(key=lambda row: (row["characterId"], str(row["style"].get("resourceName", ""))))
    primary_figure = {
        model_id: sorted(rows, key=lambda row: int(row.get("styleFigureMstId", 0)))[0]
        for model_id, rows in figures_by_model.items()
    }
    return canonical, primary_figure


def classify_animation_role(name: str, ancestors: list[str], sibling_index: int) -> str | None:
    lowered = name.lower().strip()
    ancestry = " / ".join(ancestors).lower()
    if lowered.startswith("self animation track"):
        return "body"
    if lowered.startswith("self weapon a animation track"):
        return "weapon-a"
    if lowered.startswith("self weapon b animation track"):
        return "weapon-b"
    if "skill cam" in lowered or "dcc camera" in lowered or "camera animation" in lowered:
        return "camera-animation"
    if "weapon group" in ancestry and lowered.startswith("animation track"):
        return f"weapon-a-copy-{sibling_index + 1}"
    if "weapon" in lowered and "animation track" in lowered:
        return "attachment"
    return None


def classify_extension_types(name: str, ancestors: list[str]) -> list[str]:
    text = " / ".join([*ancestors, name]).lower()
    result: list[str] = []
    if "camera" in text or "cinemachine" in text:
        result.append("camera")
    if any(token in text for token in ("tween", "activation", "model control", "battle unit")):
        result.append("scene-root")
    if any(token in text for token in ("cloth", "magica", "spring", "skirt", "hair reset")):
        result.append("cloth-control")
    if any(
        token in text
        for token in (
            "effect",
            "spfx",
            "postprocess",
            "post process",
            "screen fader",
            "signal",
            "rim light",
            "tint",
            "bloom",
            "gradation",
            "vignette",
            "chromatic",
            "blur",
            "dof",
            "light track",
        )
    ):
        result.append("combat-vfx-cue")
    if not result:
        result.append("scene-root")
    return sorted(set(result))


def inspect_skill_bundle(path: Path) -> dict[str, Any]:
    environment = UnityPy.load(str(path))
    objects = {int(obj.path_id): obj for obj in environment.objects}
    tree_cache: dict[int, dict[str, Any] | None] = {}

    def tree(pid: int) -> dict[str, Any] | None:
        if pid not in tree_cache:
            obj = objects.get(pid)
            tree_cache[pid] = object_tree(obj) if obj else None
        return tree_cache[pid]

    def name(pid: int) -> str:
        obj = objects.get(pid)
        return object_name(obj) if obj else ""

    animation_metadata: dict[int, dict[str, Any]] = {}
    for pid, obj in objects.items():
        if obj.type.name != "AnimationClip":
            continue
        clip = obj.read()
        stop_time = finite_number(getattr(getattr(clip, "m_MuscleClip", None), "m_StopTime", 0.0))
        sample_rate = finite_number(getattr(clip, "m_SampleRate", 0.0))
        bindings = getattr(getattr(clip, "m_ClipBindingConstant", None), "genericBindings", [])
        animation_metadata[pid] = {
            "pathId": str(pid),
            "name": str(getattr(clip, "m_Name", "") or ""),
            "durationSeconds": stop_time,
            "sampleRate": sample_rate,
            "genericBindings": len(bindings or []),
        }

    roots: list[tuple[int, dict[str, Any]]] = []
    for pid, obj in objects.items():
        if obj.type.name != "MonoBehaviour":
            continue
        value = tree(pid)
        if value and "m_Tracks" in value and "m_FixedDuration" in value:
            roots.append((pid, value))

    timelines: list[dict[str, Any]] = []
    components: list[dict[str, Any]] = []
    extension_tracks: list[dict[str, Any]] = []

    for root_pid, root in sorted(roots, key=lambda item: item[0]):
        flattened: list[dict[str, Any]] = []

        def visit(track_pid: int, ancestors: list[str], sibling_index: int) -> None:
            value = tree(track_pid)
            if not value:
                return
            track_name = str(value.get("m_Name", "") or "")
            role = classify_animation_role(track_name, ancestors, sibling_index)
            clips: list[dict[str, Any]] = []
            for clip_record in value.get("m_Clips", []) or []:
                if not isinstance(clip_record, dict):
                    continue
                asset_pid = path_id(clip_record.get("m_Asset"))
                asset_tree = tree(asset_pid) or {}
                animation_pid = path_id(asset_tree.get("m_Clip"))
                start = finite_number(clip_record.get("m_Start"))
                duration = finite_number(clip_record.get("m_Duration"))
                clip_value = {
                    "displayName": str(clip_record.get("m_DisplayName", "") or ""),
                    "startSeconds": start,
                    "durationSeconds": duration,
                    "endSeconds": start + duration,
                    "assetPathId": str(asset_pid),
                    "assetName": name(asset_pid),
                    "assetType": objects[asset_pid].type.name if asset_pid in objects else "typed BLANK",
                    "animationClipPathId": str(animation_pid) if animation_pid else "",
                }
                if animation_pid:
                    clip_value["animationClip"] = animation_metadata.get(
                        animation_pid,
                        {
                            "pathId": str(animation_pid),
                            "name": name(animation_pid),
                            "durationSeconds": duration,
                            "sampleRate": 0.0,
                            "genericBindings": 0,
                        },
                    )
                clips.append(clip_value)
                if role and animation_pid:
                    components.append(
                        {
                            "role": role,
                            "timelinePathId": str(root_pid),
                            "timelineName": str(root.get("m_Name", "") or ""),
                            "trackPathId": str(track_pid),
                            "trackName": track_name,
                            "ancestorNames": ancestors,
                            "segmentStartSeconds": start,
                            "segmentDurationSeconds": duration,
                            **clip_value["animationClip"],
                        }
                    )
            record = {
                "pathId": str(track_pid),
                "name": track_name,
                "parentPathId": str(path_id(value.get("m_Parent"))),
                "ancestorNames": ancestors,
                "animationRole": role or "",
                "clips": clips,
                "childCount": len(value.get("m_Children", []) or []),
            }
            flattened.append(record)
            if (clips or not (value.get("m_Children", []) or [])) and role not in {
                "body",
                "weapon-a",
                "weapon-b",
            }:
                extension_tracks.append(
                    {
                        **record,
                        "timelinePathId": str(root_pid),
                        "timelineName": str(root.get("m_Name", "") or ""),
                        "extensionTypes": classify_extension_types(track_name, ancestors),
                    }
                )
            children = value.get("m_Children", []) or []
            for index, child in enumerate(children):
                visit(path_id(child), [*ancestors, track_name], index)

        for index, pointer in enumerate(root.get("m_Tracks", []) or []):
            visit(path_id(pointer), [], index)
        duration = max(
            (
                finite_number(clip.get("endSeconds"))
                for track in flattened
                for clip in track["clips"]
            ),
            default=finite_number(root.get("m_FixedDuration")),
        )
        timelines.append(
            {
                "pathId": str(root_pid),
                "name": str(root.get("m_Name", "") or ""),
                "durationSeconds": duration,
                "durationMode": root.get("m_DurationMode"),
                "trackCount": len(flattened),
                "tracks": flattened,
            }
        )

    body = sorted(
        (component for component in components if component["role"] == "body"),
        key=lambda component: (component["segmentStartSeconds"], component["pathId"]),
    )
    primary_weapons = sorted(
        (
            component
            for component in components
            if component["role"] in {"weapon-a", "weapon-b"}
        ),
        key=lambda component: (component["role"], component["segmentStartSeconds"], component["pathId"]),
    )
    copies = [
        component
        for component in components
        if component["role"].startswith("weapon-a-copy-") or component["role"] == "attachment"
    ]
    reasons: list[str] = []
    if not timelines:
        reasons.append("TimelineAsset missing")
    if not body:
        reasons.append("Self Animation Track body clip missing")
    if len(body) > 3:
        reasons.append(f"body sequence has {len(body)} clips; consumer supports at most start/loop/end")
    if copies:
        reasons.append(f"{len(copies)} external weapon/attachment copy clips require separate instances")
    for role in ("weapon-a", "weapon-b"):
        role_clips = [component for component in primary_weapons if component["role"] == role]
        if role_clips and len(role_clips) != len(body):
            reasons.append(f"{role} sequence count {len(role_clips)} does not match body {len(body)}")
            continue
        for body_component, role_component in zip(body, role_clips):
            if (
                abs(body_component["segmentStartSeconds"] - role_component["segmentStartSeconds"]) > 1 / 120
                or abs(body_component["segmentDurationSeconds"] - role_component["segmentDurationSeconds"]) > 1 / 120
            ):
                reasons.append(f"{role} segment timing does not match body")
                break

    extension_types = sorted(
        {
            kind
            for track in extension_tracks
            for kind in track.get("extensionTypes", [])
        }
    )
    return {
        "timelineCount": len(timelines),
        "durationSeconds": max((timeline["durationSeconds"] for timeline in timelines), default=0.0),
        "timelines": timelines,
        "components": components,
        "bodyComponentCount": len(body),
        "primaryWeaponComponentCount": len(primary_weapons),
        "externalCopyComponentCount": len(copies),
        "requiredExtensionTypes": extension_types,
        "extensionTracks": extension_tracks,
        "sourceStatus": "source-available" if not reasons else "unavailable",
        "unavailableReasons": reasons,
    }


def model_rig_authority(model_bundle: Path, character_id: int) -> dict[str, Any]:
    environment = UnityPy.load(str(model_bundle))
    objects = {int(obj.path_id): obj for obj in environment.objects}
    root_name = f"chara_{character_id:06d}_battle_unit"
    root_ids = [pid for pid, obj in objects.items() if obj.type.name == "GameObject" and object_name(obj) == root_name]
    renderer_count = 0
    bone_ids: set[int] = set()
    bind_pose_count = 0
    target_names: set[str] = set()
    for obj in objects.values():
        if obj.type.name == "GameObject":
            value = object_name(obj)
            if value and ("weapon" in value.lower() or value.endswith("_model")):
                target_names.add(value)
        if obj.type.name != "SkinnedMeshRenderer":
            continue
        renderer_count += 1
        value = obj.read()
        bone_ids.update(path_id(pointer) for pointer in (getattr(value, "m_Bones", []) or []) if path_id(pointer))
        mesh_pointer = getattr(value, "m_Mesh", None)
        mesh_obj = objects.get(path_id(mesh_pointer))
        if mesh_obj:
            try:
                bind_pose_count += len(getattr(mesh_obj.read(), "m_BindPose", []) or [])
            except Exception:
                pass
    root_pid = root_ids[0] if len(root_ids) == 1 else 0
    fingerprint = (
        f"unity-model:{character_id}:root:{root_pid}:smr:{renderer_count}:"
        f"bones:{len(bone_ids)}:bindposes:{bind_pose_count}"
    )
    return {
        "modelRootName": root_name,
        "rootGameObjectPathId": str(root_pid) if root_pid else "typed BLANK",
        "rootMatchCount": len(root_ids),
        "skinnedMeshRendererCount": renderer_count,
        "uniqueBonePathIdCount": len(bone_ids),
        "bindPoseCount": bind_pose_count,
        "rigFingerprint": fingerprint,
        "modelTargetNames": sorted(target_names),
    }


def main() -> None:
    args = parse_args()
    repository_root: Path = args.repository_root.resolve()
    model_root = repository_root / "magia-exedra-character-three" / "models"
    model_ids = viewer_model_ids(model_root)

    styles = read_rows(args.masterdata_root, "getStyleMstList.json")
    figures = read_rows(args.masterdata_root, "getStyleFigureMstList.json")
    groups = read_rows(args.masterdata_root, "getStyle3dCharacterGroupMstList.json")
    style3d_rows = read_rows(args.masterdata_root, "getStyle3dCharacterMstList.json")
    skills = read_rows(args.masterdata_root, "getSkillMstList.json")
    characters = read_rows(args.masterdata_root, "getCharacterMstList.json")
    canonical, primary_figures = canonical_styles(model_ids, styles, figures)

    group_by_style = {int(row["styleMstId"]): row for row in groups}
    style3d_by_id = {int(row["style3dCharacterMstId"]): row for row in style3d_rows}
    skill_rows_by_unique: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
    for row in skills:
        skill_rows_by_unique[int(row["skillUniqueId"])].append(row)
    skill_by_unique = {
        unique_id: min(rows, key=lambda row: (int(row.get("level", 0) or 0), int(row["skillMstId"])))
        for unique_id, rows in skill_rows_by_unique.items()
    }
    character_by_id = {int(row["characterMstId"]): row for row in characters}

    tw_styles = []
    tw_skills = []
    tw_characters = []
    if args.tw_masterdata_root.exists():
        tw_styles = read_rows(args.tw_masterdata_root, "getStyleMstList.json")
        tw_skills = read_rows(args.tw_masterdata_root, "getSkillMstList.json")
        tw_characters = read_rows(args.tw_masterdata_root, "getCharacterMstList.json")
    tw_style_by_resource = {str(row.get("resourceName", "")): row for row in tw_styles}
    tw_skill_rows_by_unique: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
    for row in tw_skills:
        tw_skill_rows_by_unique[int(row["skillUniqueId"])].append(row)
    tw_skill_by_unique = {
        unique_id: min(rows, key=lambda row: (int(row.get("level", 0) or 0), int(row["skillMstId"])))
        for unique_id, rows in tw_skill_rows_by_unique.items()
    }
    tw_character_by_id = {int(row["characterMstId"]): row for row in tw_characters}

    styles_by_character: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
    for candidate in canonical:
        styles_by_character[int(candidate["characterId"])].append(candidate)

    character_records: list[dict[str, Any]] = []
    action_records: list[dict[str, Any]] = []
    unavailable_slots: list[dict[str, Any]] = []
    scan_errors: list[dict[str, Any]] = []

    for character_id in model_ids:
        model_name = f"chara_{character_id:06d}_battle_unit"
        model_key = f"battle/character/{model_name}"
        model_bundle = args.steam_asset_root / "battle" / "character" / model_name
        figure = primary_figures.get(character_id)
        character_mst_id = int(figure.get("characterMstId", 0)) if figure else 0
        en_character = character_by_id.get(character_mst_id, {}).get("name", "")
        tw_character = tw_character_by_id.get(character_mst_id, {}).get("name", "")
        rig = model_rig_authority(model_bundle, character_id) if model_bundle.is_file() else {
            "modelRootName": model_name,
            "rootGameObjectPathId": "typed BLANK",
            "rootMatchCount": 0,
            "skinnedMeshRendererCount": 0,
            "uniqueBonePathIdCount": 0,
            "bindPoseCount": 0,
            "rigFingerprint": f"unity-model:{character_id}:typed-BLANK",
            "modelTargetNames": [],
        }
        style_summaries: list[dict[str, Any]] = []
        for candidate in styles_by_character.get(character_id, []):
            style = candidate["style"]
            style_id = int(style["styleMstId"])
            style_resource = str(style["resourceName"])
            group = group_by_style.get(style_id)
            style3d_id = int(group.get("style3dCharacterMstId", 0)) if group else 0
            style3d = style3d_by_id.get(style3d_id, {})
            tw_style = tw_style_by_resource.get(style_resource, {})
            style_summary = {
                "styleMstId": style_id,
                "styleResourceName": style_resource,
                "styleFigureMstId": int(style["styleFigureMstId"]),
                "style3dCharacterMstId": str(style3d_id) if style3d_id else "typed BLANK",
                "style3dResourceName": str(style3d.get("resourceName", "")) or "typed BLANK",
                "names": {
                    "en": str(style.get("name", "")),
                    "zhHant": str(tw_style.get("name", "")) or "typed BLANK",
                },
                "actionIds": [],
            }
            for semantic, field in (
                ("normalAttack", "normalAttack"),
                ("skill", "skill1"),
                ("special", "specialAttackMstId"),
            ):
                skill_unique_id = int(style.get(field, 0) or 0)
                if skill_unique_id == 0:
                    unavailable_slots.append(
                        {
                            "characterId": str(character_id),
                            "styleMstId": str(style_id),
                            "styleResourceName": style_resource,
                            "semantic": semantic,
                            "reason": f"{field}=0 in official StyleMst",
                        }
                    )
                    continue
                skill = skill_by_unique[skill_unique_id]
                direction_name = str(skill["directionName"])
                bundle_key = f"battle/skill/{direction_name}"
                bundle_path = args.steam_asset_root / "battle" / "skill" / direction_name
                action_id = (
                    f"official-combat:{character_id}:{style_id}:{skill_unique_id}:"
                    f"{int(skill['skillMstId'])}:{direction_name}"
                )
                tw_skill = tw_skill_by_unique.get(skill_unique_id, {})
                try:
                    timeline = inspect_skill_bundle(bundle_path)
                except Exception as error:
                    timeline = {
                        "timelineCount": 0,
                        "durationSeconds": 0.0,
                        "timelines": [],
                        "components": [],
                        "bodyComponentCount": 0,
                        "primaryWeaponComponentCount": 0,
                        "externalCopyComponentCount": 0,
                        "requiredExtensionTypes": [],
                        "extensionTracks": [],
                        "sourceStatus": "unavailable",
                        "unavailableReasons": [f"bundle parse error: {type(error).__name__}: {error}"],
                    }
                    scan_errors.append({"actionId": action_id, "bundle": str(bundle_path), "error": repr(error)})
                region_presence = {
                    "steamJP": bundle_path.is_file(),
                    "jpMobile": (args.jp_mobile_asset_root / "battle" / "skill" / direction_name).is_file(),
                    "tw": (args.tw_asset_root / "battle" / "skill" / direction_name).is_file(),
                }
                action = {
                    "id": action_id,
                    "characterId": str(character_id),
                    "characterMstId": str(character_mst_id) if character_mst_id else "typed BLANK",
                    "styleMstId": str(style_id),
                    "styleResourceName": style_resource,
                    "styleFigureMstId": str(style["styleFigureMstId"]),
                    "style3dCharacterMstId": str(style3d_id) if style3d_id else "typed BLANK",
                    "style3dResourceName": str(style3d.get("resourceName", "")) or "typed BLANK",
                    "styleFigureModelName": model_name,
                    "semantic": semantic,
                    "skillUniqueId": str(skill_unique_id),
                    "skillMstId": str(skill["skillMstId"]),
                    "directionName": direction_name,
                    "bundleLogicalKey": bundle_key,
                    "bundlePath": str(bundle_path),
                    "names": {
                        "characterEn": str(en_character) or "typed BLANK",
                        "characterZhHant": str(tw_character) or "typed BLANK",
                        "styleEn": str(style.get("name", "")) or "typed BLANK",
                        "styleZhHant": str(tw_style.get("name", "")) or "typed BLANK",
                        "skillEn": str(skill.get("name", "")) or "typed BLANK",
                        "skillZhHant": str(tw_skill.get("name", "")) or "typed BLANK",
                    },
                    "regionBundlePresence": region_presence,
                    "modelKey": model_key,
                    "modelRootName": model_name,
                    "rigFingerprint": rig["rigFingerprint"],
                    "timeline": timeline,
                }
                action_records.append(action)
                style_summary["actionIds"].append(action_id)
            style_summaries.append(style_summary)

        battle_reason = None
        if not style_summaries:
            battle_reason = "official StyleFigure/StyleMst battle mapping is absent"
            unavailable_slots.append(
                {
                    "characterId": str(character_id),
                    "styleMstId": "typed BLANK",
                    "styleResourceName": "typed BLANK",
                    "semantic": "all-combat",
                    "reason": battle_reason,
                }
            )
        character_records.append(
            {
                "characterId": str(character_id),
                "characterMstId": str(character_mst_id) if character_mst_id else "typed BLANK",
                "modelKey": model_key,
                "modelBundlePath": str(model_bundle),
                "names": {
                    "en": str(en_character) or "typed BLANK",
                    "zhHant": str(tw_character) or "typed BLANK",
                },
                "battleAvailability": {
                    "status": "source-available" if style_summaries else "unavailable",
                    "reason": battle_reason,
                },
                "rig": rig,
                "styles": style_summaries,
            }
        )

    output = {
        "schema": "magius.all-character-combat-jump-authority.v1",
        "unityVersion": UNITY_VERSION,
        "identityRule": (
            "characterId + styleMstId + skillUniqueId + skillMstId + directionName + "
            "Timeline track pathID + AnimationClip pathID; names are descriptive only"
        ),
        "sources": {
            "steamMasterDataRoot": str(args.masterdata_root.resolve()),
            "steamAssetRoot": str(args.steam_asset_root.resolve()),
            "jpMobileAssetRoot": str(args.jp_mobile_asset_root.resolve()),
            "twAssetRoot": str(args.tw_asset_root.resolve()),
            "viewerModelRoot": str(model_root.resolve()),
        },
        "counts": {
            "viewerModels": len(model_ids),
            "mappedBattleModels": sum(1 for record in character_records if record["styles"]),
            "canonicalStyleVariants": sum(len(record["styles"]) for record in character_records),
            "actionBundles": len(action_records),
            "sourceAvailableActions": sum(
                action["timeline"]["sourceStatus"] == "source-available" for action in action_records
            ),
            "unavailableActions": sum(
                action["timeline"]["sourceStatus"] != "source-available" for action in action_records
            ),
            "zeroSkillSlots": len([slot for slot in unavailable_slots if "=0" in slot["reason"]]),
            "scanErrors": len(scan_errors),
        },
        "characters": character_records,
        "actions": action_records,
        "unavailableSlots": unavailable_slots,
        "scanErrors": scan_errors,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {"status": "PASS" if not scan_errors else "PARTIAL", "output": str(args.output), **output["counts"]},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
