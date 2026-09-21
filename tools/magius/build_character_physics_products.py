from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path
from typing import Any

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler


UNITY_VERSION = "2022.3.62f2"
CATALOG_SCHEMA = "magius.character-physics-catalog.v1"
PROFILE_SCHEMA = "magius.character-physics-profile.v1"
AUTHORITY_SCHEMA = "magius.character-physics-authority.v1"

MAGICA_RUNTIME_COMPONENTS = {
    "MagicaCloth",
    "MagicaCapsuleCollider",
    "MagicaSphereCollider",
    "MagicaPlaneCollider",
    "MagicaWindZone",
}

NATIVE_RUNTIME_COMPONENTS = {
    "CapsuleCollider",
    "MeshCollider",
    "SphereCollider",
}

NATIVE_PHYSICS_TYPES = {
    "BoxCollider",
    "CapsuleCollider",
    "CharacterController",
    "CharacterJoint",
    "Cloth",
    "ConfigurableJoint",
    "FixedJoint",
    "HingeJoint",
    "MeshCollider",
    "Rigidbody",
    "SphereCollider",
    "SpringJoint",
    "WindZone",
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def normalize(value: Any) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            result[key] = str(item) if key == "m_PathID" else normalize(item)
        return result
    if isinstance(value, list):
        return [normalize(item) for item in value]
    return value


def path_id(value: Any) -> int:
    if isinstance(value, dict):
        return int(value.get("m_PathID", 0) or 0)
    return int(getattr(value, "path_id", 0) or 0)


def vector(value: Any, axes: str = "xyz") -> dict[str, float]:
    return {axis: float(getattr(value, axis)) for axis in axes}


def resource_location(resource_name: str) -> tuple[str, Path]:
    if resource_name.endswith("_battle_unit"):
        logical_key = f"battle/character/{resource_name}"
        return logical_key, Path("battle") / "character" / resource_name
    if resource_name.endswith("_model"):
        logical_key = f"home/{resource_name}"
        return logical_key, Path("home") / resource_name
    raise ValueError(f"Unsupported official character resource family: {resource_name}")


def character_resource_id(resource_name: str) -> int:
    match = re.fullmatch(r"chara_(\d+)_(?:battle_unit|model)", resource_name)
    if match is None:
        raise ValueError(f"Unsupported official character resource identity: {resource_name}")
    return int(match.group(1))


def component_key(logical_key: str, component_path_id: int) -> str:
    return f"unity-component:bundle={logical_key}|pathID={component_path_id}"


def transform_key(logical_key: str, transform_path_id: int) -> str:
    return f"unity-transform:bundle={logical_key}|pathID={transform_path_id}"


def model_relative_path(hierarchy_path: str) -> str | None:
    parts = hierarchy_path.split("/")
    try:
        root_index = parts.index("Root")
    except ValueError:
        return None
    return "/".join(parts[root_index:])


def visual_root_relative_path(hierarchy_path: str) -> str | None:
    parts = hierarchy_path.split("/")
    try:
        root_index = parts.index("VisualRoot")
    except ValueError:
        return None
    relative = parts[root_index + 1 :]
    return "/".join(relative) if relative else None


def extract_profile(
    style_row: dict[str, Any],
    source_path: Path,
    logical_key: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    environment = UnityPy.load(str(source_path))
    objects = list(environment.objects)
    object_by_id = {obj.path_id: obj for obj in objects}

    game_objects: dict[int, dict[str, Any]] = {}
    transforms: dict[int, dict[str, Any]] = {}
    for obj in objects:
        if obj.type.name == "GameObject":
            data = obj.read()
            game_objects[obj.path_id] = {
                "name": data.m_Name,
                "active": bool(getattr(data, "m_IsActive", True)),
            }
    for obj in objects:
        if obj.type.name not in {"Transform", "RectTransform"}:
            continue
        data = obj.read()
        transforms[obj.path_id] = {
            "gameObjectPathId": path_id(data.m_GameObject),
            "parentTransformPathId": path_id(data.m_Father),
            "localPosition": vector(data.m_LocalPosition),
            "localRotation": vector(data.m_LocalRotation, "xyzw"),
            "localScale": vector(data.m_LocalScale),
        }

    transform_by_game_object = {
        record["gameObjectPathId"]: transform_id
        for transform_id, record in transforms.items()
    }
    children_by_transform: dict[int, list[int]] = collections.defaultdict(list)
    for transform_id, record in transforms.items():
        children_by_transform[record["parentTransformPathId"]].append(transform_id)

    def transform_path(transform_path_id: int) -> str:
        parts: list[str] = []
        seen: set[int] = set()
        current = transform_path_id
        while current and current not in seen:
            seen.add(current)
            transform = transforms.get(current)
            if transform is None:
                parts.append(f"<Transform:{current}>")
                break
            game_object_id = transform["gameObjectPathId"]
            parts.append(
                game_objects.get(game_object_id, {}).get(
                    "name", f"<GameObject:{game_object_id}>"
                )
            )
            current = transform["parentTransformPathId"]
        return "/".join(reversed(parts))

    def game_object_path(game_object_id: int) -> str:
        return transform_path(transform_by_game_object.get(game_object_id, 0))

    def component_scope(hierarchy_path: str) -> str:
        if (
            model_relative_path(hierarchy_path) is not None
            or hierarchy_path == style_row["resourceName"]
            or hierarchy_path.startswith(f'{style_row["resourceName"]}/')
        ):
            return "persistent-model"
        root_name = hierarchy_path.split("/", 1)[0]
        if re.fullmatch(r"Character[A-Za-z0-9]+Timeline\d+", root_name):
            return "action-timeline-registration"
        return "auxiliary-prefab-registration"

    def transform_active_in_hierarchy(transform_path_id: int) -> bool:
        seen: set[int] = set()
        current = transform_path_id
        while current and current not in seen:
            seen.add(current)
            transform = transforms.get(current)
            if transform is None:
                return False
            if not game_objects.get(transform["gameObjectPathId"], {}).get("active", True):
                return False
            current = transform["parentTransformPathId"]
        return True

    magica_components: list[dict[str, Any]] = []
    component_by_path_id: dict[int, dict[str, Any]] = {}
    collider_game_objects: set[int] = set()
    script_counts: collections.Counter[str] = collections.Counter()
    component_errors: list[dict[str, str]] = []

    for obj in objects:
        if obj.type.name != "MonoBehaviour":
            continue
        data = obj.read(check_read=False)
        try:
            script_name = getattr(data.m_Script.read(), "m_Name", "")
        except Exception:
            continue
        if not script_name.startswith("Magica"):
            continue
        script_counts[script_name] += 1
        try:
            tree = normalize(obj.read_typetree())
        except Exception as error:
            component_errors.append(
                {
                    "script": script_name,
                    "componentPathID": str(obj.path_id),
                    "reason": f"typetree-read-failed:{type(error).__name__}:{error}",
                }
            )
            continue
        game_object_id = int(tree.get("m_GameObject", {}).get("m_PathID", 0))
        transform_id = transform_by_game_object.get(game_object_id, 0)
        component = {
            "script": script_name,
            "stableKey": component_key(logical_key, obj.path_id),
            "componentPathID": str(obj.path_id),
            "gameObjectPathID": str(game_object_id),
            "binding": {
                "transformStableKey": transform_key(logical_key, transform_id),
                "transformPathID": str(transform_id),
                "hierarchyPath": game_object_path(game_object_id),
                "modelRelativePath": model_relative_path(game_object_path(game_object_id)),
            },
            "activation": {
                "componentEnabled": bool(tree.get("m_Enabled", 1)),
                "gameObjectActive": bool(
                    game_objects.get(game_object_id, {}).get("active", True)
                ),
                "activeInHierarchy": transform_active_in_hierarchy(transform_id),
            },
            "serialized": tree,
        }
        magica_components.append(component)
        component_by_path_id[obj.path_id] = component
        if script_name in {
            "MagicaCapsuleCollider",
            "MagicaSphereCollider",
            "MagicaPlaneCollider",
        }:
            collider_game_objects.add(game_object_id)

    def transform_binding(transform_id: int) -> dict[str, Any]:
        hierarchy_path = transform_path(transform_id)
        record = transforms.get(transform_id)
        return {
            "stableKey": transform_key(logical_key, transform_id),
            "transformPathID": str(transform_id),
            "gameObjectPathID": str(record["gameObjectPathId"]) if record else "0",
            "hierarchyPath": hierarchy_path,
            "modelRelativePath": model_relative_path(hierarchy_path),
            "visualRootRelativePath": visual_root_relative_path(hierarchy_path),
            "localTRS": {
                key: value
                for key, value in (record or {}).items()
                if key.startswith("local")
            },
        }

    def center_transform_bindings(transform_id: int) -> list[dict[str, Any]]:
        """Publish the exact component-center ancestry, leaf to VisualRoot.

        Some older Viewer FBX products omit Unity's empty MagicaCloth/yure
        GameObjects.  Their authored local TRS still matters, so the runtime
        may only collapse an omitted suffix when every published transform in
        that suffix is identity.
        """
        result: list[dict[str, Any]] = []
        seen: set[int] = set()
        current = transform_id
        while current and current not in seen:
            seen.add(current)
            record = transforms.get(current)
            if record is None:
                break
            binding = transform_binding(current)
            result.append(binding)
            if binding["hierarchyPath"].split("/")[-1] == "VisualRoot":
                break
            current = int(record["parentTransformPathId"])
        return result

    def is_identity_transform(transform_id: int) -> bool:
        record = transforms.get(transform_id)
        if record is None:
            return False
        position = record["localPosition"]
        rotation = record["localRotation"]
        scale = record["localScale"]
        return (
            sum(float(position[axis]) ** 2 for axis in "xyz") <= 1e-8
            and sum((float(scale[axis]) - 1.0) ** 2 for axis in "xyz") <= 1e-8
            and sum(float(rotation[axis]) ** 2 for axis in "xyz") <= 2e-4 ** 2
            and abs(abs(float(rotation["w"])) - 1.0) <= 2e-4
        )

    def center_transform_candidates(
        transform_id: int,
        root_transform_ids: list[int],
    ) -> list[dict[str, Any]]:
        """Publish exact center-equivalent bindings with identity-edge proof.

        A zero local TRS edge makes its child and parent world poses identical.
        Traversing the connected identity component therefore covers both the
        authored empty center ancestry and an exact retained sibling branch in
        older FBX exports, without naming or character-ID fallback.
        """
        # Restrict traversal to the component ancestry and authored root-bone
        # ancestries. Unrelated identity siblings (meshes or another cloth
        # component) are equally positioned but are not part of this product's
        # binding proof and would only bloat the catalog.
        eligible: set[int] = set()
        for seed in [transform_id, *root_transform_ids]:
            current = seed
            branch_seen: set[int] = set()
            while current and current not in branch_seen and current in transforms:
                branch_seen.add(current)
                eligible.add(current)
                if transform_path(current).split("/")[-1] == "VisualRoot":
                    break
                current = int(transforms[current]["parentTransformPathId"])

        center_ancestry: set[int] = set()
        current = transform_id
        while current and current not in center_ancestry and current in transforms:
            center_ancestry.add(current)
            current = int(transforms[current]["parentTransformPathId"])

        def exact_export_relative_path(candidate_id: int) -> str | None:
            branch: list[int] = []
            current_id = candidate_id
            seen_ids: set[int] = set()
            while (
                current_id
                and current_id not in seen_ids
                and current_id in transforms
                and current_id not in center_ancestry
            ):
                seen_ids.add(current_id)
                branch.append(current_id)
                current_id = int(transforms[current_id]["parentTransformPathId"])
            if not branch or current_id not in center_ancestry:
                return None
            names = [
                game_objects.get(transforms[value]["gameObjectPathId"], {}).get(
                    "name", f"<GameObject:{transforms[value]['gameObjectPathId']}>"
                )
                for value in reversed(branch)
            ]
            return "/".join(names)

        result: list[dict[str, Any]] = []
        queue: collections.deque[tuple[int, tuple[int, ...]]] = collections.deque(
            [(transform_id, tuple())]
        )
        seen: set[int] = set()
        while queue:
            current, bridge = queue.popleft()
            if (
                not current
                or current in seen
                or current not in transforms
                or current not in eligible
            ):
                continue
            seen.add(current)
            result.append(
                {
                    "bindingStableKey": transform_key(logical_key, current),
                    "identityBridgeStableKeys": [
                        transform_key(logical_key, value) for value in bridge
                    ],
                    "exactExportRelativePath": exact_export_relative_path(current),
                }
            )
            record = transforms[current]
            current_name = transform_path(current).split("/")[-1]
            if current_name != "VisualRoot" and is_identity_transform(current):
                parent_id = int(record["parentTransformPathId"])
                if parent_id and parent_id not in seen and parent_id in eligible:
                    queue.append((parent_id, bridge + (current,)))
            for child_id in sorted(
                children_by_transform.get(current, []),
                key=lambda value: (transform_path(value), value),
            ):
                if (
                    child_id not in seen
                    and child_id in eligible
                    and is_identity_transform(child_id)
                ):
                    queue.append((child_id, bridge + (child_id,)))
        return result

    # MonoBehaviour records are discovered before the full Transform binding
    # helper is declared.  Normalize every component onto the same exact
    # pathID/path contract used by cloth chains and native colliders.  Keeping
    # two binding shapes here would make runtime lookup accidentally depend on
    # a component name, which is explicitly not a stable identity.
    for component in magica_components:
        component["binding"] = transform_binding(
            int(component["binding"]["transformPathID"])
        )

    def collect_chain_bindings(root_transform_id: int) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        stack = [root_transform_id]
        seen: set[int] = set()
        while stack:
            current = stack.pop()
            if not current or current in seen:
                continue
            seen.add(current)
            transform = transforms.get(current)
            if transform is None:
                continue
            game_object_id = transform["gameObjectPathId"]
            if game_object_id in collider_game_objects:
                continue
            result.append(transform_binding(current))
            stack.extend(reversed(children_by_transform.get(current, [])))
        return result

    cloths: list[dict[str, Any]] = []
    colliders: list[dict[str, Any]] = []
    wind_zones: list[dict[str, Any]] = []
    other_magica: list[dict[str, Any]] = []
    referenced_transform_ids: set[int] = set()

    for component in magica_components:
        script_name = component["script"]
        serialized = component["serialized"]
        if script_name == "MagicaCloth":
            settings = serialized.get("serializeData", {})
            center_bindings = center_transform_bindings(
                int(component["binding"]["transformPathID"])
            )
            serialized_root_ids = [
                int(value.get("m_PathID", 0))
                for value in settings.get("rootBones", [])
            ]
            root_ids = list(dict.fromkeys(
                value for value in serialized_root_ids if value != 0
            ))
            center_candidates = center_transform_candidates(
                int(component["binding"]["transformPathID"]), root_ids
            )
            root_bindings = [transform_binding(value) for value in root_ids]
            collision_bone_ids = [
                int(value.get("m_PathID", 0))
                for value in settings.get("colliderCollisionConstraint", {}).get(
                    "collisionBones", []
                )
                if int(value.get("m_PathID", 0)) != 0
            ]
            collision_bone_bindings = [
                transform_binding(value) for value in collision_bone_ids
            ]
            chain_bindings: list[dict[str, Any]] = []
            for root_id in root_ids:
                chain_bindings.extend(collect_chain_bindings(root_id))
            chain_bindings = list({
                value["stableKey"]: value for value in chain_bindings
            }.values())
            referenced_transform_ids.update(root_ids)
            referenced_transform_ids.update(collision_bone_ids)
            referenced_transform_ids.update(
                int(value["transformPathID"]) for value in chain_bindings
            )
            referenced_transform_ids.update(
                int(value["transformPathID"]) for value in center_bindings
            )
            for candidate in center_candidates:
                referenced_transform_ids.add(
                    int(candidate["bindingStableKey"].rsplit("=", 1)[-1])
                )
                referenced_transform_ids.update(
                    int(value.rsplit("=", 1)[-1])
                    for value in candidate["identityBridgeStableKeys"]
                )
            collider_references = []
            for pointer in settings.get("colliderCollisionConstraint", {}).get(
                "colliderList", []
            ):
                collider_id = int(pointer.get("m_PathID", 0))
                if collider_id == 0:
                    collider_references.append(
                        {
                            "stableKey": None,
                            "componentPathID": "0",
                            "resolved": True,
                            "nullReference": True,
                            "script": None,
                            "binding": None,
                        }
                    )
                    continue
                resolved = component_by_path_id.get(collider_id)
                collider_references.append(
                    {
                        "stableKey": component_key(logical_key, collider_id),
                        "componentPathID": str(collider_id),
                        "resolved": resolved is not None,
                        "script": resolved.get("script") if resolved else None,
                        "binding": resolved.get("binding") if resolved else None,
                    }
                )
            cloths.append(
                {
                    "stableKey": component["stableKey"],
                    "componentPathID": component["componentPathID"],
                    "binding": component["binding"],
                    "centerTransformBindingStableKeys": [
                        value["stableKey"] for value in center_bindings
                    ],
                    "centerTransformCandidates": center_candidates,
                    "activation": component["activation"],
                    "runtimeBinding": (
                        {
                            "status": "inactive",
                            "failClosedReasons": [],
                        }
                        if not all(component["activation"].values())
                        else {
                            "status": "runtime-ready",
                            "failClosedReasons": [],
                        }
                        if root_bindings and chain_bindings
                        else {
                            "status": "fail-closed",
                            "failClosedReasons": [
                                "official-root-bone-bindings-null:"
                                f"{sum(value == 0 for value in serialized_root_ids)}"
                                f"/{len(serialized_root_ids)}"
                            ],
                        }
                    ),
                    "rootBoneBindings": root_bindings,
                    "chainBindings": chain_bindings,
                    "collisionBoneBindings": collision_bone_bindings,
                    "colliderReferences": collider_references,
                    "serializeData": settings,
                    "serializeData2": serialized.get("serializeData2", {}),
                    "runtimeProperties": {
                        key: value
                        for key, value in serialized.items()
                        if key.endswith("Property")
                    },
                }
            )
        elif script_name in {
            "MagicaCapsuleCollider",
            "MagicaSphereCollider",
            "MagicaPlaneCollider",
        }:
            referenced_transform_ids.add(int(component["binding"]["transformPathID"]))
            colliders.append(
                {
                    "script": script_name,
                    "stableKey": component["stableKey"],
                    "componentPathID": component["componentPathID"],
                    "binding": component["binding"],
                    "activation": component["activation"],
                    "settings": {
                        key: value
                        for key, value in serialized.items()
                        if key not in {"m_GameObject", "m_Script", "m_Name"}
                    },
                }
            )
        elif script_name == "MagicaWindZone":
            wind_zones.append(
                {
                    "script": script_name,
                    "stableKey": component["stableKey"],
                    "componentPathID": component["componentPathID"],
                    "binding": component["binding"],
                    "activation": component["activation"],
                    "scope": component_scope(
                        component["binding"]["hierarchyPath"]
                    ),
                    "settings": {
                        key: value
                        for key, value in serialized.items()
                        if key not in {"m_GameObject", "m_Script", "m_Name"}
                    },
                }
            )
        else:
            other_magica.append(component)

    native_components: list[dict[str, Any]] = []
    native_counts: collections.Counter[str] = collections.Counter()
    for obj in objects:
        if obj.type.name not in NATIVE_PHYSICS_TYPES:
            continue
        native_counts[obj.type.name] += 1
        try:
            tree = normalize(obj.read_typetree())
        except Exception as error:
            component_errors.append(
                {
                    "script": obj.type.name,
                    "componentPathID": str(obj.path_id),
                    "reason": f"typetree-read-failed:{type(error).__name__}:{error}",
                }
            )
            continue
        game_object_id = int(tree.get("m_GameObject", {}).get("m_PathID", 0))
        transform_id = transform_by_game_object.get(game_object_id, 0)
        referenced_transform_ids.add(transform_id)
        native_component = {
                "type": obj.type.name,
                "stableKey": component_key(logical_key, obj.path_id),
                "componentPathID": str(obj.path_id),
                "binding": transform_binding(transform_id),
                "activation": {
                    "componentEnabled": bool(tree.get("m_Enabled", 1)),
                    "gameObjectActive": bool(
                        game_objects.get(game_object_id, {}).get("active", True)
                    ),
                    "activeInHierarchy": transform_active_in_hierarchy(transform_id),
                },
                "serialized": tree,
                "scope": component_scope(game_object_path(game_object_id)),
            }
        if obj.type.name == "MeshCollider":
            mesh_path_id = int(tree.get("m_Mesh", {}).get("m_PathID", 0))
            mesh_object = object_by_id.get(mesh_path_id)
            if mesh_object is None or mesh_object.type.name != "Mesh":
                component_errors.append(
                    {
                        "script": obj.type.name,
                        "componentPathID": str(obj.path_id),
                        "reason": f"mesh-collider-mesh-unresolved:{mesh_path_id}",
                    }
                )
            else:
                mesh_data = mesh_object.read()
                handler = MeshHandler(mesh_data)
                handler.process()
                native_component["mesh"] = {
                    "stableKey": (
                        f"unity-mesh:bundle={logical_key}|pathID={mesh_path_id}"
                    ),
                    "meshPathID": str(mesh_path_id),
                    "name": mesh_data.m_Name,
                    "vertices": handler.m_Vertices or [],
                    "indices": handler.m_IndexBuffer or [],
                    "subMeshes": [
                        {
                            "firstByte": int(submesh.firstByte),
                            "indexCount": int(submesh.indexCount),
                            "topology": int(submesh.topology),
                            "baseVertex": int(submesh.baseVertex),
                            "firstVertex": int(submesh.firstVertex),
                            "vertexCount": int(submesh.vertexCount),
                        }
                        for submesh in mesh_data.m_SubMeshes
                    ],
                }
        native_components.append(native_component)

    unsupported_magica = sorted(
        name for name in script_counts if name not in MAGICA_RUNTIME_COMPONENTS
    )
    unsupported_native = sorted(
        name for name in native_counts if name not in NATIVE_RUNTIME_COMPONENTS
    )
    unresolved_collider_references = sum(
        1
        for cloth in cloths
        for collider in cloth["colliderReferences"]
        if not collider["resolved"]
    )
    fail_closed_reasons = [row["reason"] for row in component_errors]
    fail_closed_reasons.extend(
        f"unsupported-magica-component:{name}" for name in unsupported_magica
    )
    fail_closed_reasons.extend(
        f"unsupported-native-physics-component:{name}" for name in unsupported_native
    )
    if unresolved_collider_references:
        fail_closed_reasons.append(
            f"unresolved-magica-collider-references:{unresolved_collider_references}"
        )

    character_id = int(style_row["style3dCharacterMstId"])
    resource_name = str(style_row["resourceName"])
    resource_id = character_resource_id(resource_name)
    stable_key = (
        f"character-physics:style3dCharacterMstId={character_id}"
        f"|resourceName={resource_name}"
    )
    profile = {
        "schema": PROFILE_SCHEMA,
        "stableKey": stable_key,
        "identity": {
            "style3dCharacterMstId": character_id,
            "characterResourceId": resource_id,
            "resourceName": resource_name,
            "displayName": style_row.get("name"),
        },
        "source": {
            "sourceStableKey": f"assetbundle:{logical_key}",
            "logicalKey": logical_key,
            "unityVersion": UNITY_VERSION,
        },
        "runtime": {
            "status": "runtime-ready" if not fail_closed_reasons else "fail-closed",
            "failClosedReasons": fail_closed_reasons,
            "bindingPolicy": {
                "identity": "logicalKey+pathID+exact-model-relative-path",
                "nameFallback": False,
                "missingBinding": "fail-closed-component",
                "writerPolicy": "single-post-animation-physics-writer",
                "actionOwnedBonePolicy": "animation-pose-is-read-only-input",
            },
            "fixedStepSeconds": 1 / 90,
            "maximumCatchUpSteps": 3,
        },
        "counts": {
            "magicaCloth": len(cloths),
            "magicaCapsuleCollider": script_counts["MagicaCapsuleCollider"],
            "magicaSphereCollider": script_counts["MagicaSphereCollider"],
            "magicaPlaneCollider": script_counts["MagicaPlaneCollider"],
            "otherMagicaComponents": len(other_magica),
            "magicaWindZone": len(wind_zones),
            "nativePhysicsComponents": len(native_components),
            "physicsTransformBindings": len(referenced_transform_ids),
            "runtimeReadyCloth": sum(
                value["runtimeBinding"]["status"] == "runtime-ready"
                for value in cloths
            ),
            "inactiveCloth": sum(
                value["runtimeBinding"]["status"] == "inactive"
                for value in cloths
            ),
            "failClosedCloth": sum(
                value["runtimeBinding"]["status"] == "fail-closed"
                for value in cloths
            ),
        },
        "components": {
            "cloth": cloths,
            "colliders": colliders,
            "windZones": wind_zones,
            "otherMagica": other_magica,
            "native": native_components,
        },
        "physicsTransformBindings": [
            transform_binding(value)
            for value in sorted(referenced_transform_ids)
            if value in transforms
        ],
    }
    authority = {
        "style3dCharacterMstId": character_id,
        "characterResourceId": resource_id,
        "resourceName": resource_name,
        "logicalKey": logical_key,
        "sourceAbsolutePath": str(source_path),
        "sourceBytes": source_path.stat().st_size,
        "objectCounts": dict(
            sorted(collections.Counter(obj.type.name for obj in objects).items())
        ),
        "magicaComponentCounts": dict(sorted(script_counts.items())),
        "nativePhysicsComponentCounts": dict(sorted(native_counts.items())),
        "componentErrors": component_errors,
        "runtimeStatus": profile["runtime"]["status"],
        "failClosedReasons": fail_closed_reasons,
    }
    return profile, authority


def build(args: argparse.Namespace) -> None:
    UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    catalog_source = load_json(args.character_catalog)
    style_rows = catalog_source["payload"]["mstList"]
    profiles: list[dict[str, Any]] = []
    authority_records: list[dict[str, Any]] = []
    catalog_entries: list[dict[str, Any]] = []
    aggregate_magica: collections.Counter[str] = collections.Counter()
    aggregate_native: collections.Counter[str] = collections.Counter()

    for style_row in style_rows:
        character_id = int(style_row["style3dCharacterMstId"])
        resource_name = str(style_row["resourceName"])
        resource_id = character_resource_id(resource_name)
        logical_key, relative_path = resource_location(resource_name)
        source_path = args.asset_root / relative_path
        product_relative = Path("characters") / str(character_id) / "profile.v1.json"
        if not source_path.is_file():
            stable_key = (
                f"character-physics:style3dCharacterMstId={character_id}"
                f"|resourceName={resource_name}"
            )
            profile = {
                "schema": PROFILE_SCHEMA,
                "stableKey": stable_key,
                "identity": {
                    "style3dCharacterMstId": character_id,
                    "characterResourceId": resource_id,
                    "resourceName": resource_name,
                    "displayName": style_row.get("name"),
                },
                "source": {
                    "sourceStableKey": f"assetbundle:{logical_key}",
                    "logicalKey": logical_key,
                    "unityVersion": UNITY_VERSION,
                },
                "runtime": {
                    "status": "fail-closed",
                    "failClosedReasons": ["official-source-bundle-missing"],
                    "bindingPolicy": {
                        "identity": "logicalKey+pathID+exact-model-relative-path",
                        "nameFallback": False,
                        "missingBinding": "fail-closed-component",
                        "writerPolicy": "single-post-animation-physics-writer",
                        "actionOwnedBonePolicy": "animation-pose-is-read-only-input",
                    },
                    "fixedStepSeconds": 1 / 90,
                    "maximumCatchUpSteps": 3,
                },
                "counts": {},
                "components": {
                    "cloth": [],
                    "colliders": [],
                    "windZones": [],
                    "otherMagica": [],
                    "native": [],
                },
                "physicsTransformBindings": [],
            }
            authority = {
                "style3dCharacterMstId": character_id,
                "resourceName": resource_name,
                "logicalKey": logical_key,
                "sourceAbsolutePath": str(source_path),
                "sourceBytes": 0,
                "objectCounts": {},
                "magicaComponentCounts": {},
                "nativePhysicsComponentCounts": {},
                "componentErrors": [],
                "runtimeStatus": "fail-closed",
                "failClosedReasons": ["official-source-bundle-missing"],
            }
        else:
            try:
                profile, authority = extract_profile(
                    style_row, source_path, logical_key
                )
            except Exception as error:
                stable_key = (
                    f"character-physics:style3dCharacterMstId={character_id}"
                    f"|resourceName={resource_name}"
                )
                reason = f"official-source-parse-failed:{type(error).__name__}:{error}"
                profile = {
                    "schema": PROFILE_SCHEMA,
                    "stableKey": stable_key,
                    "identity": {
                        "style3dCharacterMstId": character_id,
                        "characterResourceId": resource_id,
                        "resourceName": resource_name,
                        "displayName": style_row.get("name"),
                    },
                    "source": {
                        "sourceStableKey": f"assetbundle:{logical_key}",
                        "logicalKey": logical_key,
                        "unityVersion": UNITY_VERSION,
                    },
                    "runtime": {
                        "status": "fail-closed",
                        "failClosedReasons": [reason],
                        "bindingPolicy": {
                            "identity": "logicalKey+pathID+exact-model-relative-path",
                            "nameFallback": False,
                            "missingBinding": "fail-closed-component",
                            "writerPolicy": "single-post-animation-physics-writer",
                            "actionOwnedBonePolicy": "animation-pose-is-read-only-input",
                        },
                        "fixedStepSeconds": 1 / 90,
                        "maximumCatchUpSteps": 3,
                    },
                    "counts": {},
                    "components": {
                        "cloth": [],
                        "colliders": [],
                        "windZones": [],
                        "otherMagica": [],
                        "native": [],
                    },
                    "physicsTransformBindings": [],
                }
                authority = {
                    "style3dCharacterMstId": character_id,
                    "resourceName": resource_name,
                    "logicalKey": logical_key,
                    "sourceAbsolutePath": str(source_path),
                    "sourceBytes": source_path.stat().st_size,
                    "objectCounts": {},
                    "magicaComponentCounts": {},
                    "nativePhysicsComponentCounts": {},
                    "componentErrors": [],
                    "runtimeStatus": "fail-closed",
                    "failClosedReasons": [reason],
                }

        write_json(args.public_root / product_relative, profile)
        profiles.append(profile)
        authority_records.append(authority)
        aggregate_magica.update(authority["magicaComponentCounts"])
        aggregate_native.update(authority["nativePhysicsComponentCounts"])
        catalog_entries.append(
            {
                "stableKey": profile["stableKey"],
                "style3dCharacterMstId": character_id,
                "characterResourceId": resource_id,
                "resourceName": resource_name,
                "displayName": style_row.get("name"),
                "sourceStableKey": profile["source"]["sourceStableKey"],
                "productUrl": f"./{product_relative.as_posix()}",
                "runtimeStatus": profile["runtime"]["status"],
                "failClosedReasons": profile["runtime"]["failClosedReasons"],
                "counts": profile["counts"],
            }
        )

    runtime_ready = sum(
        profile["runtime"]["status"] == "runtime-ready" for profile in profiles
    )
    total_cloths = sum(
        int(profile.get("counts", {}).get("magicaCloth", 0))
        for profile in profiles
    )
    catalog = {
        "schema": CATALOG_SCHEMA,
        "lookupKey": "style3dCharacterMstId|characterResourceId",
        "bindingIdentity": "sourceStableKey+Unity pathID+exact modelRelativePath",
        "counts": {
            "characters": len(profiles),
            "runtimeReady": runtime_ready,
            "failClosed": len(profiles) - runtime_ready,
            "magicaCloth": total_cloths,
            "magicaComponents": sum(aggregate_magica.values()),
            "nativePhysicsComponents": sum(aggregate_native.values()),
        },
        "mechanismCounts": {
            "magica": dict(sorted(aggregate_magica.items())),
            "native": dict(sorted(aggregate_native.items())),
        },
        "runtimeMechanismCounts": {
            "cloth": dict(sorted(collections.Counter(
                cloth["runtimeBinding"]["status"]
                for profile in profiles
                for cloth in profile["components"]["cloth"]
            ).items())),
            "magicaColliders": {
                "runtime-ready": sum(
                    all(collider["activation"].values())
                    for profile in profiles
                    for collider in profile["components"]["colliders"]
                ),
                "inactive": sum(
                    not all(collider["activation"].values())
                    for profile in profiles
                    for collider in profile["components"]["colliders"]
                ),
            },
            "windZones": {
                "runtime-ready": sum(
                    all(zone["activation"].values())
                    for profile in profiles
                    for zone in profile["components"]["windZones"]
                ),
                "inactive": sum(
                    not all(zone["activation"].values())
                    for profile in profiles
                    for zone in profile["components"]["windZones"]
                ),
            },
            "nativeColliders": {
                "runtime-ready": sum(
                    all(collider["activation"].values())
                    for profile in profiles
                    for collider in profile["components"]["native"]
                ),
                "inactive": sum(
                    not all(collider["activation"].values())
                    for profile in profiles
                    for collider in profile["components"]["native"]
                ),
            },
        },
        "entries": catalog_entries,
    }
    authority = {
        "schema": AUTHORITY_SCHEMA,
        "sources": {
            "characterCatalog": str(args.character_catalog),
            "assetRoot": str(args.asset_root),
            "selectionRule": (
                "exact getStyle3dCharacterMstList resourceName; "
                "_battle_unit -> battle/character; _model -> home"
            ),
            "inventoryRescan": False,
        },
        "counts": catalog["counts"],
        "mechanismCounts": catalog["mechanismCounts"],
        "records": authority_records,
    }
    write_json(args.public_root / "manifest.v1.json", catalog)
    write_json(args.artifact_root / "authority.v1.json", authority)
    write_json(
        args.artifact_root / "generation-summary.json",
        {
            "schema": "magius.character-physics-generation-summary.v1",
            "catalog": str(args.public_root / "manifest.v1.json"),
            "authority": str(args.artifact_root / "authority.v1.json"),
            "counts": catalog["counts"],
            "mechanismCounts": catalog["mechanismCounts"],
        },
    )
    print(json.dumps(catalog["counts"], ensure_ascii=False, sort_keys=True))
    print(json.dumps(catalog["mechanismCounts"], ensure_ascii=False, sort_keys=True))


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--character-catalog",
        type=Path,
        default=repo_root
        / "magia-exedra-character-three"
        / "getStyle3dCharacterMstList.json",
    )
    parser.add_argument(
        "--asset-root",
        type=Path,
        default=Path(r"D:\magia\ma-ex-data\gamedata\AssetBundles"),
    )
    parser.add_argument(
        "--public-root",
        type=Path,
        default=repo_root / "public" / "character-physics",
    )
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=repo_root
        / "artifacts"
        / "research"
        / "20260829-character-physics-native-authority",
    )
    build(parser.parse_args())


if __name__ == "__main__":
    main()
