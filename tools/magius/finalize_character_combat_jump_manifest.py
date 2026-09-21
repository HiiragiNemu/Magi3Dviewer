from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


MANIFEST_SCHEMA = "magius.all-character-combat-jump-resource-manifest.v1"
RUNTIME_SCHEMA = "magius.combat-jump-action-runtime.v1"
CATALOG_SCHEMA = "magius.official-character-action-catalog.v1"
SYNCHRONIZED_SCHEMA = "official-synchronized-character-action-v1"
COMBAT_GROUP_ID = "official-combat-complete-actions"
JUMP_GROUP_ID = "official-combat-jump-donors"
PHASE_ORDER = {"start": 0, "loop": 1, "end": 2}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def stable_identity(action: dict[str, Any]) -> dict[str, str]:
    return {
        "characterId": str(action["characterId"]),
        "characterMstId": str(action["characterMstId"]),
        "styleMstId": str(action["styleMstId"]),
        "styleFigureMstId": str(action["styleFigureMstId"]),
        "style3dCharacterMstId": str(action["style3dCharacterMstId"]),
        "resourceName": str(action["modelRootName"]),
        "logicalBundleKey": str(action["modelKey"]),
        "style3dResourceName": str(action["style3dResourceName"]),
        "styleFigureModelName": str(action["styleFigureModelName"]),
    }


def action_label(action: dict[str, Any]) -> str:
    names = action.get("names") or {}
    character = names.get("characterEn") or action["characterId"]
    style = names.get("styleEn") or action["styleMstId"]
    skill = names.get("skillEn") or action["semantic"]
    return f"{character} · {style} · {skill}"


def clip_descriptor(serialized: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(serialized["runtimeName"]),
        "pathId": str(serialized["sourceClipPathId"]),
        "durationSeconds": float(serialized["sourceDurationSeconds"]),
        "sampleRate": float(serialized["sourceSampleRate"]),
    }


def extension_events(action: dict[str, Any]) -> list[dict[str, Any]]:
    timeline = action["timeline"]
    required_types = set(timeline.get("requiredExtensionTypes") or [])
    events: list[dict[str, Any]] = []
    seen: set[str] = set()
    for track_index, track in enumerate(timeline.get("extensionTracks") or []):
        types = list(track.get("extensionTypes") or [])
        clips = list(track.get("clips") or [])
        if not clips:
            clips = [{
                "displayName": "typed BLANK",
                "startSeconds": 0.0,
                "durationSeconds": 0.0,
                "endSeconds": 0.0,
                "assetPathId": "typed BLANK",
                "assetName": "typed BLANK",
                "assetType": "typed BLANK",
                "animationClipPathId": "typed BLANK",
            }]
        for extension_type in types:
            for clip_index, clip in enumerate(clips):
                event_id = (
                    f"{action['id']}:extension:{track.get('timelinePathId')}:"
                    f"{track.get('pathId')}:{extension_type}:"
                    f"{clip.get('assetPathId', clip_index)}:{clip_index}"
                )
                if event_id in seen:
                    continue
                seen.add(event_id)
                events.append({
                    "id": event_id,
                    "timeSeconds": float(clip.get("startSeconds") or 0.0),
                    "type": extension_type,
                    "required": extension_type in required_types,
                    "payload": {
                        "bundleLogicalKey": action["bundleLogicalKey"],
                        "directionName": action["directionName"],
                        "timelinePathId": str(track.get("timelinePathId", "typed BLANK")),
                        "timelineName": str(track.get("timelineName", "typed BLANK")),
                        "trackPathId": str(track.get("pathId", "typed BLANK")),
                        "trackName": str(track.get("name", "typed BLANK")),
                        "ancestorNames": list(track.get("ancestorNames") or []),
                        "clip": clip,
                    },
                })
    return sorted(events, key=lambda event: (event["timeSeconds"], event["id"]))


def runtime_components_by_action(runtime: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    clips = {
        (
            str(clip["actionId"]),
            str(clip["role"]),
            str(clip["sequencePhase"]),
            str(clip["sourceClipPathId"]),
        ): clip
        for clip in runtime["clips"]
    }
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for component in runtime["components"]:
        key = (
            str(component["actionId"]),
            str(component["role"]),
            str(component["sequencePhase"]),
            str(component["sourceClipPathId"]),
        )
        serialized = clips.get(key)
        if serialized is None:
            raise RuntimeError(f"runtime clip is missing for component {key}")
        grouped[str(component["actionId"])].append({
            **component,
            "clip": clip_descriptor(serialized),
        })
    return grouped


def build_synchronized_action(
    action: dict[str, Any],
    components: list[dict[str, Any]],
) -> dict[str, Any]:
    by_role: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for component in components:
        by_role[str(component["role"])].append(component)
    authority_by_role: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for component in action["timeline"].get("components") or []:
        authority_by_role[str(component["role"])].append(component)
    targets: list[dict[str, Any]] = []
    for role in sorted(by_role, key=lambda value: (value != "body", value)):
        role_components = sorted(
            by_role[role],
            key=lambda component: PHASE_ORDER[str(component["sequencePhase"])],
        )
        authority_components = sorted(
            authority_by_role[role],
            key=lambda component: (
                float(component["segmentStartSeconds"]),
                str(component["pathId"]),
            ),
        )
        if len(role_components) != len(authority_components):
            raise RuntimeError(
                f"runtime/Timeline component count mismatch for {action['id']} {role}: "
                f"{len(role_components)} != {len(authority_components)}"
            )
        sequence: dict[str, Any] = {}
        inventory: list[dict[str, Any]] = []
        seen_inventory: set[tuple[str, str]] = set()
        for component, authority_component in zip(role_components, authority_components):
            phase = str(component["sequencePhase"])
            if phase in sequence:
                raise RuntimeError(f"duplicate {phase} phase for {action['id']} {role}")
            descriptor = {
                **component["clip"],
                "durationSeconds": float(authority_component["segmentDurationSeconds"]),
                "sourceDurationSeconds": float(component["clip"]["durationSeconds"]),
                "segmentStartSeconds": float(authority_component["segmentStartSeconds"]),
            }
            sequence[phase] = descriptor
            inventory_key = (descriptor["name"], descriptor["pathId"])
            if inventory_key not in seen_inventory:
                inventory.append({"name": descriptor["name"], "pathId": descriptor["pathId"]})
                seen_inventory.add(inventory_key)
        targets.append({
            "role": role,
            "targetId": f"combat:{action['characterId']}:{role}",
            "resourceName": f"{action['modelRootName']}#{role}",
            "sequence": sequence,
            "inventory": inventory,
        })
    return {
        "schema": SYNCHRONIZED_SCHEMA,
        "characterId": str(action["characterId"]),
        "actionId": str(action["id"]),
        "semantic": str(action["semantic"]),
        "targets": targets,
    }


def required_components(action: dict[str, Any]) -> list[dict[str, Any]]:
    return [{
        "role": str(component["role"]),
        "timelinePathId": str(component["timelinePathId"]),
        "timelineName": str(component["timelineName"]),
        "trackPathId": str(component["trackPathId"]),
        "trackName": str(component["trackName"]),
        "segmentStartSeconds": float(component["segmentStartSeconds"]),
        "segmentDurationSeconds": float(component["segmentDurationSeconds"]),
        "pathId": str(component["pathId"]),
        "name": str(component["name"]),
        "durationSeconds": float(component["durationSeconds"]),
        "sampleRate": float(component["sampleRate"]),
        "genericBindings": int(component["genericBindings"]),
    } for component in action["timeline"].get("components") or []]


def build_combat_entry(
    action: dict[str, Any],
    components: list[dict[str, Any]],
    runtime_url: str | None,
) -> dict[str, Any]:
    source_available = action["timeline"]["sourceStatus"] == "source-available"
    reasons = list(action["timeline"].get("unavailableReasons") or [])
    if source_available and not components:
        raise RuntimeError(f"source-available action has no runtime components: {action['id']}")
    synchronized = build_synchronized_action(action, components) if source_available else {
        "schema": SYNCHRONIZED_SCHEMA,
        "characterId": str(action["characterId"]),
        "actionId": str(action["id"]),
        "semantic": str(action["semantic"]),
        "targets": [],
    }
    loop_durations = [
        float(component["segmentDurationSeconds"])
        for component in action["timeline"].get("components") or []
        if any(
            runtime_component["role"] == component["role"]
            and runtime_component["sourceClipPathId"] == str(component["pathId"])
            and runtime_component["sequencePhase"] == "loop"
            for runtime_component in components
        )
    ]
    hold_seconds = max(loop_durations) if loop_durations else None
    all_extension_events = extension_events(action)
    synchronized_duration = 0.0
    for target in synchronized["targets"]:
        sequence = target["sequence"]
        target_duration = sum(
            float(sequence[phase]["durationSeconds"])
            for phase in ["start", "end"]
            if phase in sequence
        )
        if "loop" in sequence:
            target_duration += float(hold_seconds or 0.0)
        synchronized_duration = max(synchronized_duration, target_duration)
    latest_required_extension = max(
        (float(event["timeSeconds"]) for event in all_extension_events if event["required"]),
        default=0.0,
    )
    playback_ready = source_available and latest_required_extension <= synchronized_duration + 1e-6
    if source_available and not playback_ready:
        reasons.append(
            "required extension event begins after synchronized animation coverage: "
            f"{latest_required_extension:.9f}s > {synchronized_duration:.9f}s"
        )
        synchronized = {
            "schema": SYNCHRONIZED_SCHEMA,
            "characterId": str(action["characterId"]),
            "actionId": str(action["id"]),
            "semantic": str(action["semantic"]),
            "targets": [],
        }
    entry = {
        "id": str(action["id"]),
        "label": action_label(action),
        "groupId": COMBAT_GROUP_ID,
        "group": "完整官方战斗动作",
        "playbackKind": "timeline",
        "characterIdentity": stable_identity(action),
        "availability": {
            "status": "source-available" if playback_ready else "unavailable",
            "reason": None if playback_ready else "; ".join(reasons),
            "regionBundlePresence": action["regionBundlePresence"],
        },
        "playback": {
            "kind": "timeline",
            "synchronizedAction": synchronized,
            "extensionEvents": all_extension_events if playback_ready else [],
        },
        "playbackOptions": {
            "holdSeconds": hold_seconds,
        },
        "sourceFamily": {
            "id": str(action["rigFingerprint"]),
            "compatibility": "exact-rig" if playback_ready else "incompatible",
        },
        "resource": {
            "runtimeUrl": runtime_url if source_available else None,
            "runtimeSchema": RUNTIME_SCHEMA if source_available else None,
            "modelKey": action["modelKey"],
            "modelRootName": action["modelRootName"],
            "rigFingerprint": action["rigFingerprint"],
        },
        "skill": {
            "semantic": action["semantic"],
            "skillUniqueId": str(action["skillUniqueId"]),
            "skillMstId": str(action["skillMstId"]),
            "directionName": action["directionName"],
            "bundleLogicalKey": action["bundleLogicalKey"],
            "timelineDurationSeconds": float(action["timeline"]["durationSeconds"]),
        },
        "names": action["names"],
        "requiredComponents": required_components(action),
        "requiredExtensionTypes": list(action["timeline"].get("requiredExtensionTypes") or []),
        "extensionAuthority": all_extension_events,
        "synchronizedDurationSeconds": synchronized_duration,
        "latestRequiredExtensionSeconds": latest_required_extension,
        "sourceStatus": action["timeline"]["sourceStatus"],
        "unavailableReasons": reasons,
    }
    return entry


def build_jump_entry(
    action: dict[str, Any],
    candidate: dict[str, Any],
    runtime_url: str,
) -> dict[str, Any]:
    grade = str(candidate["grade"])
    usable = grade in {"A", "B"} and len(candidate.get("segments") or []) == 3
    source_clip = candidate["sourceClip"]
    clip = {
        "name": str(source_clip["name"]),
        "pathId": str(source_clip["pathId"]),
        "durationSeconds": float(source_clip["durationSeconds"]),
        "sampleRate": float(source_clip["sampleRate"]),
    }
    donor_id = (
        f"official-combat-jump:{action['characterId']}:{action['styleMstId']}:"
        f"{action['skillUniqueId']}:{candidate.get('sequencePhase', 'typed-BLANK')}:"
        f"{source_clip['pathId']}"
    )
    segments = [{
        "phase": segment["phase"],
        "sourceClip": clip,
        "sourceStartSeconds": float(segment["sourceStartSeconds"]),
        "sourceEndSeconds": float(segment["sourceEndSeconds"]),
        "bodyMask": "full-body",
        "rootPolicy": "controller-all",
    } for segment in candidate.get("segments") or []]
    reason = candidate.get("reason")
    entry = {
        "id": donor_id,
        "label": f"{action_label(action)} · Jump {grade}",
        "groupId": JUMP_GROUP_ID,
        "group": "战斗跳跃供体三段",
        "playbackKind": "timeline",
        "characterIdentity": stable_identity(action),
        "availability": {
            "status": "source-available" if usable else "unavailable",
            "reason": None if usable else (reason or "grade C donor is rejected"),
            "regionBundlePresence": action["regionBundlePresence"],
        },
        "playback": {
            "kind": "timeline",
            "jumpDonor": {
                "grade": grade,
                "sourceActionId": str(action["id"]),
                "sourceCharacterId": str(action["characterId"]),
                "sourceRigFingerprint": str(action["rigFingerprint"]),
                "compatibleCharacterIds": [str(action["characterId"])],
                "compatibility": "exact-rig" if usable else "incompatible",
                "attachmentPolicy": "body-only-exclude-external-weapons",
                "segments": segments,
                "rejectionReason": None if usable else (reason or "grade C donor is rejected"),
            },
        },
        "sourceFamily": {
            "id": str(action["rigFingerprint"]),
            "compatibility": "exact-rig" if usable else "incompatible",
        },
        "resource": {
            "runtimeUrl": runtime_url,
            "runtimeSchema": RUNTIME_SCHEMA,
            "modelKey": action["modelKey"],
            "modelRootName": action["modelRootName"],
            "rigFingerprint": action["rigFingerprint"],
        },
        "skill": {
            "semantic": action["semantic"],
            "skillUniqueId": str(action["skillUniqueId"]),
            "skillMstId": str(action["skillMstId"]),
            "directionName": action["directionName"],
            "bundleLogicalKey": action["bundleLogicalKey"],
        },
        "sourceSequencePhase": candidate.get("sequencePhase", "typed BLANK"),
        "evidence": candidate.get("evidence") or {},
    }
    return entry


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    authority_path = repo / "artifacts/research/20260824-all-character-combat-jump/all-character-combat-jump-authority.v1.json"
    record_path = repo / "artifacts/verification/20260824-all-character-combat-jump-product/runtime-build-record.json"
    output_path = repo / "public/character-actions/combat-jump/manifest.v1.json"
    verification_path = repo / "artifacts/verification/20260824-all-character-combat-jump-product/manifest-verification.json"

    authority = load_json(authority_path)
    build_record = load_json(record_path)
    if authority["schema"] != "magius.all-character-combat-jump-authority.v1":
        raise RuntimeError("authority schema mismatch")
    if build_record["schema"] != "magius.all-character-combat-jump-runtime-build.v1":
        raise RuntimeError("runtime build schema mismatch")

    actions_by_id = {str(action["id"]): action for action in authority["actions"]}
    if len(actions_by_id) != len(authority["actions"]):
        raise RuntimeError("duplicate authority action IDs")

    runtime_by_character: dict[str, dict[str, Any]] = {}
    runtime_url_by_character: dict[str, str] = {}
    components_by_action: dict[str, list[dict[str, Any]]] = {}
    donor_candidates: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    for record in build_record["characters"]:
        character_id = str(record["characterId"])
        runtime = load_json(Path(record["rawRuntimePath"]))
        if runtime["schema"] != RUNTIME_SCHEMA or str(runtime["characterId"]) != character_id:
            raise RuntimeError(f"runtime identity mismatch for {character_id}")
        runtime_by_character[character_id] = runtime
        runtime_url = f"/character-actions/combat-jump/runtime/{character_id}/runtime.v1.json.gz"
        runtime_url_by_character[character_id] = runtime_url
        for action_id, components in runtime_components_by_action(runtime).items():
            if action_id in components_by_action:
                raise RuntimeError(f"runtime action is duplicated across characters: {action_id}")
            components_by_action[action_id] = components
        for candidate in runtime["jumpCandidates"]:
            action = actions_by_id.get(str(candidate["actionId"]))
            if action is None:
                raise RuntimeError(f"jump candidate references unknown action {candidate['actionId']}")
            donor_candidates.append((action, candidate, runtime_url))

    combat_entries = [
        build_combat_entry(
            action,
            components_by_action.get(str(action["id"]), []),
            runtime_url_by_character.get(str(action["characterId"])),
        )
        for action in authority["actions"]
    ]
    jump_entries = [build_jump_entry(action, candidate, runtime_url)
                    for action, candidate, runtime_url in donor_candidates]
    entries = combat_entries + jump_entries
    entry_ids = [entry["id"] for entry in entries]
    if len(entry_ids) != len(set(entry_ids)):
        duplicate_ids = [entry_id for entry_id, count in Counter(entry_ids).items() if count > 1]
        raise RuntimeError(f"duplicate manifest entry IDs: {duplicate_ids[:5]}")

    donor_grades = Counter(entry["playback"]["jumpDonor"]["grade"] for entry in jump_entries)
    available_donors = sum(entry["availability"]["status"] == "source-available" for entry in jump_entries)
    playback_ready_combat = sum(entry["availability"]["status"] == "source-available" for entry in combat_entries)
    consumer_unavailable_combat = sum(
        entry["sourceStatus"] == "source-available" and entry["availability"]["status"] == "unavailable"
        for entry in combat_entries
    )
    runtime_component_count = sum(int(record["componentCount"]) for record in build_record["characters"])
    runtime_clip_count = sum(int(record["clipCount"]) for record in build_record["characters"])
    characters = []
    entries_by_character: dict[str, list[str]] = defaultdict(list)
    for entry in entries:
        entries_by_character[entry["characterIdentity"]["characterId"]].append(entry["id"])
    unavailable_slots_by_character: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for slot in authority["unavailableSlots"]:
        unavailable_slots_by_character[str(slot["characterId"])].append(slot)
    for character in authority["characters"]:
        character_id = str(character["characterId"])
        characters.append({
            "characterId": character_id,
            "characterMstId": str(character["characterMstId"]),
            "modelKey": character["modelKey"],
            "modelRootName": character["rig"]["modelRootName"],
            "rigFingerprint": character["rig"]["rigFingerprint"],
            "battleAvailability": character["battleAvailability"],
            "runtime": ({
                "url": runtime_url_by_character[character_id],
                "schema": RUNTIME_SCHEMA,
            } if character_id in runtime_url_by_character else None),
            "entryIds": entries_by_character.get(character_id, []),
            "unavailableSlots": unavailable_slots_by_character.get(character_id, []),
        })

    manifest = {
        "schema": MANIFEST_SCHEMA,
        "catalogSchema": CATALOG_SCHEMA,
        "groups": [
            {"id": COMBAT_GROUP_ID, "label": "完整官方战斗动作", "playback": "timeline"},
            {"id": JUMP_GROUP_ID, "label": "战斗跳跃供体三段", "playback": "timeline"},
        ],
        "identityRule": authority["identityRule"],
        "fallbackPolicy": (
            "fail-closed: no display-name identity, no clip-name-only identity, no cross-character fallback, "
            "no body/weapon merge, no unverified retarget, and no required-extension omission"
        ),
        "rootPolicy": (
            "full combat suppresses body Root.position while preserving weapon/attachment curves; "
            "jump donors use controller-all and body-only-exclude-external-weapons"
        ),
        "counts": {
            **authority["counts"],
            "characterRuntimes": len(runtime_by_character),
            "runtimeComponents": runtime_component_count,
            "runtimeClips": runtime_clip_count,
            "combatEntries": len(combat_entries),
            "playbackReadyCombatActions": playback_ready_combat,
            "consumerUnavailableCombatActions": consumer_unavailable_combat,
            "jumpCandidateEntries": len(jump_entries),
            "sourceAvailableJumpDonors": available_donors,
            "jumpDonorGrades": {grade: donor_grades.get(grade, 0) for grade in ["A", "B", "C"]},
            "catalogEntries": len(entries),
        },
        "characters": characters,
        "entries": entries,
        "unavailableSlots": authority["unavailableSlots"],
        "sources": {
            "authority": str(authority_path),
            "runtimeBuildRecord": str(record_path),
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    verification_checks = {
        "schema": manifest["schema"] == MANIFEST_SCHEMA,
        "viewerCharacters91": manifest["counts"]["viewerModels"] == 91,
        "mappedBattleModels89": manifest["counts"]["mappedBattleModels"] == 89,
        "canonicalStyleVariants106": manifest["counts"]["canonicalStyleVariants"] == 106,
        "combatActions296": len(combat_entries) == 296,
        "sourceAvailableCombatAuthority238": sum(entry["sourceStatus"] == "source-available" for entry in combat_entries) == 238,
        "playbackReadyCombat234": playback_ready_combat == 234,
        "consumerUnavailableCombat4": consumer_unavailable_combat == 4,
        "authorityUnavailableCombat58": sum(entry["sourceStatus"] == "unavailable" for entry in combat_entries) == 58,
        "runtimeCharacters89": len(runtime_by_character) == 89,
        "runtimeComponents1190": manifest["counts"]["runtimeComponents"] == 1190,
        "runtimeClips1190": manifest["counts"]["runtimeClips"] == 1190,
        "jumpCandidates527": len(jump_entries) == 527,
        "sourceAvailableJumpDonors177": available_donors == 177,
        "uniqueEntryIds": len(entry_ids) == len(set(entry_ids)),
        "allAvailableCombatHasTargets": all(
            bool(entry["playback"]["synchronizedAction"]["targets"])
            for entry in combat_entries if entry["availability"]["status"] == "source-available"
        ),
        "allUnavailableCombatHasNoExecutableTargets": all(
            not entry["playback"]["synchronizedAction"]["targets"]
            for entry in combat_entries if entry["availability"]["status"] == "unavailable"
        ),
        "allUsableDonorsExactRig": all(
            entry["playback"]["jumpDonor"]["compatibility"] == "exact-rig"
            and entry["playback"]["jumpDonor"]["compatibleCharacterIds"]
                == [entry["characterIdentity"]["characterId"]]
            and len(entry["playback"]["jumpDonor"]["segments"]) == 3
            and all(segment["rootPolicy"] == "controller-all" for segment in entry["playback"]["jumpDonor"]["segments"])
            for entry in jump_entries if entry["availability"]["status"] == "source-available"
        ),
        "missingBattleModelsRemainUnavailable": all(
            next(character for character in characters if character["characterId"] == character_id)["battleAvailability"]["status"] == "unavailable"
            for character_id in ["100205", "113501"]
        ),
    }
    verification = {
        "schema": "magius.all-character-combat-jump-manifest-verification.v1",
        "status": "PASS" if all(verification_checks.values()) else "FAIL",
        "checks": verification_checks,
        "counts": manifest["counts"],
        "output": str(output_path),
        "outputBytes": output_path.stat().st_size,
    }
    verification_path.write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(verification, ensure_ascii=False, indent=2))
    return 0 if verification["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
