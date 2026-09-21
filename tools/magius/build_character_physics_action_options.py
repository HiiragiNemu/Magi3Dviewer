from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path
from typing import Any

import UnityPy


UNITY_VERSION = "2022.3.62f2"
SCHEMA = "magius.character-physics-action-options.v1"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def path_id(value: Any) -> int:
    if isinstance(value, dict):
        return int(value.get("m_PathID", 0) or 0)
    return int(getattr(value, "path_id", 0) or 0)


def component_reference_id(value: Any) -> int:
    if isinstance(value, dict):
        return path_id(value.get("component", value))
    return path_id(getattr(value, "component", value))


def vector(value: Any, axes: str = "xyz") -> dict[str, float]:
    return {axis: float(getattr(value, axis)) for axis in axes}


def phase_kind(timeline_name: str) -> str:
    if re.fullmatch(r"SpecialSkillReserveTimeline\d+", timeline_name):
        return "special-skill-reserve"
    if re.fullmatch(r"CharacterSpReserveAndPreSpTimeline\d+", timeline_name):
        return "special-skill-reserve-and-pre-special"
    return "official-timeline"


class SourceIndex:
    def __init__(self, source_path: Path, logical_key: str) -> None:
        environment = UnityPy.load(str(source_path))
        self.logical_key = logical_key
        self.objects = {int(obj.path_id): obj for obj in environment.objects}
        self.game_objects: dict[int, dict[str, Any]] = {}
        self.transforms: dict[int, dict[str, Any]] = {}
        for obj in self.objects.values():
            if obj.type.name != "GameObject":
                continue
            data = obj.read()
            self.game_objects[int(obj.path_id)] = {
                "name": str(data.m_Name),
                "active": bool(getattr(data, "m_IsActive", True)),
                "components": [
                    component_reference_id(value)
                    for value in getattr(data, "m_Component", [])
                ],
            }
        for obj in self.objects.values():
            if obj.type.name not in {"Transform", "RectTransform"}:
                continue
            data = obj.read()
            self.transforms[int(obj.path_id)] = {
                "gameObjectPathId": path_id(data.m_GameObject),
                "parentTransformPathId": path_id(data.m_Father),
                "localPosition": vector(data.m_LocalPosition),
                "localRotation": vector(data.m_LocalRotation, "xyzw"),
                "localScale": vector(data.m_LocalScale),
            }

    def root_transform_id(self, transform_path_id: int) -> int:
        current = transform_path_id
        seen: set[int] = set()
        last = current
        while current and current not in seen:
            seen.add(current)
            record = self.transforms.get(current)
            if record is None:
                raise ValueError(f"transform-unresolved:{current}")
            last = current
            current = int(record["parentTransformPathId"])
        return last

    def transform_path(self, transform_path_id: int) -> str:
        parts: list[str] = []
        current = transform_path_id
        seen: set[int] = set()
        while current and current not in seen:
            seen.add(current)
            record = self.transforms.get(current)
            if record is None:
                raise ValueError(f"transform-unresolved:{current}")
            game_object_id = int(record["gameObjectPathId"])
            game_object = self.game_objects.get(game_object_id)
            if game_object is None:
                raise ValueError(f"game-object-unresolved:{game_object_id}")
            parts.append(str(game_object["name"]))
            current = int(record["parentTransformPathId"])
        return "/".join(reversed(parts))

    def transform_binding(self, transform_path_id: int) -> dict[str, Any]:
        record = self.transforms[transform_path_id]
        hierarchy_path = self.transform_path(transform_path_id)
        return {
            "stableKey": (
                f"unity-transform:bundle={self.logical_key}"
                f"|pathID={transform_path_id}"
            ),
            "transformPathID": str(transform_path_id),
            "gameObjectPathID": str(record["gameObjectPathId"]),
            "hierarchyPath": hierarchy_path,
            "modelRelativePath": None,
            "visualRootRelativePath": None,
            "localTRS": {
                "localPosition": record["localPosition"],
                "localRotation": record["localRotation"],
                "localScale": record["localScale"],
            },
        }

    def playable_director(self, root_transform_id: int) -> tuple[int, dict[str, Any]]:
        record = self.transforms[root_transform_id]
        game_object = self.game_objects[int(record["gameObjectPathId"])]
        director_ids = [
            component_id
            for component_id in game_object["components"]
            if component_id in self.objects
            and self.objects[component_id].type.name == "PlayableDirector"
        ]
        if len(director_ids) != 1:
            raise ValueError(f"playable-director-count:{len(director_ids)}")
        director_id = director_ids[0]
        return director_id, self.objects[director_id].read_typetree()


def exact_relative_path(root_path: str, binding_path: str) -> str:
    prefix = f"{root_path}/"
    if not binding_path.startswith(prefix):
        raise ValueError(f"binding-outside-phase-root:{binding_path}:{root_path}")
    return binding_path[len(prefix) :]


def action_phase_entry(
    profile: dict[str, Any],
    zones: list[dict[str, Any]],
    source_index: SourceIndex,
) -> dict[str, Any]:
    first_binding = zones[0]["binding"]
    first_transform_id = int(first_binding["transformPathID"])
    root_transform_id = source_index.root_transform_id(first_transform_id)
    root_path = source_index.transform_path(root_transform_id)
    if any(
        source_index.root_transform_id(int(zone["binding"]["transformPathID"]))
        != root_transform_id
        for zone in zones
    ):
        raise ValueError(f"phase-root-mismatch:{root_path}")
    director_id, director = source_index.playable_director(root_transform_id)
    timeline_asset_id = path_id(director.get("m_PlayableAsset", {}))
    timeline_object = source_index.objects.get(timeline_asset_id)
    if timeline_object is None:
        raise ValueError(f"timeline-asset-unresolved:{timeline_asset_id}")
    timeline = timeline_object.read_typetree()
    timeline_name = str(timeline.get("m_Name", ""))
    if not timeline_name:
        raise ValueError(f"timeline-name-missing:{timeline_asset_id}")
    stable_key = (
        "character-physics-action-phase:"
        f"source={profile['source']['logicalKey']}"
        f"|timelineAssetPathID={timeline_asset_id}"
    )
    requirements = []
    for zone in sorted(zones, key=lambda value: value["stableKey"]):
        binding = zone["binding"]
        requirements.append(
            {
                "stableKey": f"{stable_key}|binding={binding['stableKey']}",
                "componentKind": "MagicaWindZone",
                "componentStableKey": zone["stableKey"],
                "bindingStableKey": binding["stableKey"],
                "exactRelativePath": exact_relative_path(
                    root_path, binding["hierarchyPath"]
                ),
                "binding": binding,
                "activation": zone["activation"],
            }
        )
    editor_settings = timeline.get("m_EditorSettings", {})
    return {
        "stableKey": stable_key,
        "optionValue": stable_key,
        "character": profile["identity"],
        "phaseKind": phase_kind(timeline_name),
        "officialDisplayName": timeline_name,
        "phaseRoot": {
            "officialGameObjectName": root_path,
            "binding": source_index.transform_binding(root_transform_id),
        },
        "timeline": {
            "playableDirectorPathID": str(director_id),
            "timelineAssetPathID": str(timeline_asset_id),
            "timelineAssetName": timeline_name,
            "durationMode": int(timeline.get("m_DurationMode", 0)),
            "fixedDurationSeconds": float(timeline.get("m_FixedDuration", 0.0)),
            "frameRate": float(editor_settings.get("m_Framerate", 0.0)),
            "initialState": int(director.get("m_InitialState", 0)),
            "wrapMode": int(director.get("m_WrapMode", 0)),
        },
        "registrationBindings": requirements,
        "availability": {
            "sourceStatus": "source-ready",
            "bindingStatus": "runtime-ready",
            "playbackStatus": "consumer-pending",
            "failClosedReasons": [
                "official-action-phase-playback-consumer-not-attached"
            ],
        },
    }


def auxiliary_registration(
    profile: dict[str, Any],
    component: dict[str, Any],
) -> dict[str, Any]:
    path = str(component["binding"]["hierarchyPath"])
    root_name, _, relative = path.partition("/")
    stable_key = (
        "character-physics-auxiliary-binding:"
        f"source={profile['source']['logicalKey']}"
        f"|componentPathID={component['componentPathID']}"
    )
    return {
        "stableKey": stable_key,
        "character": profile["identity"],
        "componentKind": component["type"],
        "componentStableKey": component["stableKey"],
        "prefabRootName": root_name,
        "bindingStableKey": component["binding"]["stableKey"],
        "exactRelativePath": relative,
        "binding": component["binding"],
        "activation": component["activation"],
        "scope": "auxiliary-prefab-registration",
        "selectableAction": False,
        "availability": {
            "sourceStatus": "source-ready",
            "bindingStatus": "runtime-ready",
            "failClosedReasons": [],
        },
    }


def build(args: argparse.Namespace) -> None:
    UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    catalog = load_json(args.physics_catalog)
    profiles: list[dict[str, Any]] = []
    for entry in catalog["entries"]:
        product_path = args.physics_catalog.parent / str(entry["productUrl"])
        profiles.append(load_json(product_path.resolve()))

    action_entries: list[dict[str, Any]] = []
    auxiliary_entries: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for profile in profiles:
        action_zones = [
            value
            for value in profile["components"]["windZones"]
            if value.get("scope") == "action-timeline-registration"
        ]
        grouped: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
        for zone in action_zones:
            grouped[str(zone["binding"]["hierarchyPath"]).split("/", 1)[0]].append(zone)
        if grouped:
            source_path = args.asset_root.joinpath(
                *str(profile["source"]["logicalKey"]).split("/")
            )
            source_index = SourceIndex(source_path, profile["source"]["logicalKey"])
            for root_name, zones in sorted(grouped.items()):
                try:
                    entry = action_phase_entry(profile, zones, source_index)
                    if entry["phaseRoot"]["officialGameObjectName"] != root_name:
                        raise ValueError(
                            f"phase-root-name-mismatch:{root_name}:"
                            f"{entry['phaseRoot']['officialGameObjectName']}"
                        )
                    action_entries.append(entry)
                except Exception as error:
                    errors.append(
                        {
                            "characterResourceId": profile["identity"]["characterResourceId"],
                            "phaseRoot": root_name,
                            "reason": f"{type(error).__name__}:{error}",
                        }
                    )
        for component in profile["components"]["native"]:
            if component.get("scope") == "auxiliary-prefab-registration":
                auxiliary_entries.append(auxiliary_registration(profile, component))

    action_entries.sort(
        key=lambda value: (
            value["character"]["characterResourceId"],
            value["officialDisplayName"],
        )
    )
    auxiliary_entries.sort(key=lambda value: value["stableKey"])
    character_ids = {
        str(entry["character"]["characterResourceId"])
        for entry in action_entries
    }
    combat_manifest = load_json(args.combat_action_manifest)
    viewer_action_options = []
    for action in combat_manifest["entries"]:
        identity = action.get("characterIdentity", {})
        if (
            action.get("groupId") != "official-combat-complete-actions"
            or str(identity.get("characterId")) not in character_ids
        ):
            continue
        viewer_action_options.append(
            {
                "actionId": action["id"],
                "label": action["label"],
                "characterResourceId": int(identity["characterId"]),
                "style3dCharacterMstId": int(identity["style3dCharacterMstId"]),
                "availability": action["availability"],
                "semantic": action.get("skill", {}).get("semantic"),
                "directionName": action.get("skill", {}).get("directionName"),
                "runtimeUrl": action.get("resource", {}).get("runtimeUrl"),
                "phaseBindingRelation": "character-identity-only-no-phase-inference",
            }
        )
    viewer_action_options.sort(key=lambda value: value["actionId"])

    output = {
        "schema": SCHEMA,
        "lookupKey": "characterResourceId+phaseStableKey",
        "bindingIdentity": "sourceStableKey+Unity pathID+exact phase-relative path",
        "counts": {
            "characters": len(character_ids),
            "actionPhases": len(action_entries),
            "actionRegistrationBindings": sum(
                len(entry["registrationBindings"]) for entry in action_entries
            ),
            "auxiliaryRegistrationBindings": len(auxiliary_entries),
            "relatedViewerActionOptions": len(viewer_action_options),
            "relatedViewerActionsSourceAvailable": sum(
                value["availability"]["status"] == "source-available"
                for value in viewer_action_options
            ),
            "relatedViewerActionsUnavailable": sum(
                value["availability"]["status"] == "unavailable"
                for value in viewer_action_options
            ),
            "failClosed": len(errors),
        },
        "policy": {
            "phaseToViewerActionMapping": "not-inferred",
            "externalBinding": "exact-registration-only",
            "missingBinding": "fail-closed",
            "uiAvailability": "show-source-options;disable-unregistered-playback",
        },
        "entries": action_entries,
        "viewerActionOptions": viewer_action_options,
        "auxiliaryRegistrations": auxiliary_entries,
        "failClosedRecords": errors,
    }
    write_json(args.output, output)
    print(json.dumps(output["counts"], ensure_ascii=False, sort_keys=True))


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--physics-catalog",
        type=Path,
        default=repo_root / "public" / "character-physics" / "manifest.v1.json",
    )
    parser.add_argument(
        "--combat-action-manifest",
        type=Path,
        default=repo_root
        / "public"
        / "character-actions"
        / "combat-jump"
        / "manifest.v1.json",
    )
    parser.add_argument(
        "--asset-root",
        type=Path,
        default=Path(r"D:\magia\ma-ex-data\gamedata\AssetBundles"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "public" / "character-physics" / "action-options.v1.json",
    )
    build(parser.parse_args())


if __name__ == "__main__":
    main()
