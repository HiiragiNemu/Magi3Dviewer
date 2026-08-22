#!/usr/bin/env python3
"""Audit every shipped character Home animation/expression runtime.

This is a corpus gate rather than a character-specific visual workaround.  It
checks source identity, action-family closure, expression registry integrity
and the full signed official blend-shape value range across every model
directory.  FBX morph-channel existence is validated by the companion Node
runtime test, which parses the actual exported FBX with Three's FBXLoader.
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path
from typing import Any


CHARACTER_RE = re.compile(r"^chara_(\d+)(?:_battle_unit)?$")


def load_json(path: Path) -> dict[str, Any]:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            return json.load(stream)
    return json.loads(path.read_text(encoding="utf-8"))


def family_name(name: str) -> str:
    name = re.sub(r"_weapon_[a-z0-9]+(?=_|$)", "", name, flags=re.I)
    return re.sub(r"_\d+$", "", name)


def unresolved_count(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def audit_character(directory: Path) -> dict[str, Any]:
    match = CHARACTER_RE.match(directory.name)
    if not match:
        raise ValueError(f"unexpected character directory: {directory.name}")
    character_id = int(match.group(1))
    animation_path = directory / "home-animations.json.gz"
    expression_path = directory / "home-expressions.json"
    record: dict[str, Any] = {
        "characterId": character_id,
        "directory": directory.as_posix(),
        "fbxFiles": [path.name for path in sorted(directory.glob("*.fbx*"))],
        "animationRuntime": None,
        "expressionRuntime": None,
        "errors": [],
    }

    if animation_path.is_file():
        runtime = load_json(animation_path)
        clips = runtime.get("clips", [])
        node_paths = runtime.get("nodePaths", {})
        clip_families = {family_name(str(clip.get("name", ""))) for clip in clips}
        missing_target_ids: set[str] = set()
        duplicate_tracks: list[dict[str, Any]] = []
        track_count = 0
        for clip in clips:
            names = [str(track.get("name", "")) for track in clip.get("tracks", [])]
            track_count += len(names)
            duplicates = sorted({name for name in names if names.count(name) > 1})
            if duplicates:
                duplicate_tracks.append({"clip": clip.get("name"), "tracks": duplicates})
            for name in names:
                target_id = name.split(".", 1)[0]
                if target_id not in node_paths:
                    missing_target_ids.add(target_id)

        required_families: set[str] = set()
        actions = runtime.get("actions") or {}
        for action in ("wait01", "wait02"):
            if actions.get(action, {}).get("loopFamily"):
                required_families.add(family_name(actions[action]["loopFamily"]))
        unique = actions.get("unique01") or {}
        for field in ("startFamily", "loopFamily"):
            if unique.get(field):
                required_families.add(family_name(unique[field]))
        missing_action_families = sorted(required_families - clip_families)

        identity_errors: list[dict[str, Any]] = []
        if runtime.get("schema") == 2:
            identities = {
                str(identity.get("sourceClipPathId")): identity
                for identity in runtime.get("clipIdentities", [])
            }
            clip_names = {str(clip.get("name", "")) for clip in clips}
            action_identities = [
                ("wait01", actions.get("wait01", {}).get("loopFamily"), actions.get("wait01", {}).get("sourceClipPathId")),
                ("wait02", actions.get("wait02", {}).get("loopFamily"), actions.get("wait02", {}).get("sourceClipPathId")),
                ("unique01.start", unique.get("startFamily"), unique.get("startSourceClipPathId")),
                ("unique01.loop", unique.get("loopFamily"), unique.get("loopSourceClipPathId")),
            ]
            for action_name, imported_name, source_path_id in action_identities:
                identity = identities.get(str(source_path_id))
                if (
                    not imported_name
                    or source_path_id is None
                    or identity is None
                    or identity.get("importedName") != imported_name
                    or imported_name not in clip_names
                    or int(identity.get("transformTrackCount", 0)) <= 0
                ):
                    identity_errors.append({
                        "action": action_name,
                        "importedName": imported_name,
                        "sourceClipPathId": source_path_id,
                        "identity": identity,
                    })

        if runtime.get("schema") not in (1, 2):
            record["errors"].append("animation-schema")
        if runtime.get("characterId") != character_id:
            record["errors"].append("animation-character-id")
        if missing_target_ids:
            record["errors"].append("animation-target-id")
        if duplicate_tracks:
            record["errors"].append("duplicate-track-in-clip")
        if missing_action_families:
            record["errors"].append("missing-action-family")
        if identity_errors:
            record["errors"].append("invalid-action-clip-identity")

        record["animationRuntime"] = {
            "source": runtime.get("source"),
            "styleRetarget": runtime.get("styleRetarget"),
            "schema": runtime.get("schema"),
            "unityVersion": runtime.get("unityVersion"),
            "clipCount": len(clips),
            "trackCount": track_count,
            "nodePathCount": len(node_paths),
            "families": sorted(clip_families),
            "missingActionFamilies": missing_action_families,
            "missingTargetIds": sorted(missing_target_ids),
            "duplicateTracks": duplicate_tracks,
            "helperCount": len(runtime.get("helpers") or []),
            "externalHelperCount": len(runtime.get("externalHelpers") or []),
            "clipIdentityCount": len(runtime.get("clipIdentities") or []),
            "identityErrors": identity_errors,
        }

    if expression_path.is_file():
        runtime = load_json(expression_path)
        ordered_names = [str(name) for name in (runtime.get("expressionOrder") or [])]
        order = set(ordered_names)
        expression_names = set((runtime.get("expressions") or {}).keys())
        aliases = runtime.get("aliases") or {}
        broken_aliases = {
            str(alias): str(target)
            for alias, target in aliases.items()
            if target not in expression_names
        }
        referenced_weights: set[str] = set()
        sampled_weights: list[float] = []
        outside_unit_interval: list[dict[str, Any]] = []
        unresolved = 0
        for name, expression in (runtime.get("expressions") or {}).items():
            unresolved += unresolved_count(expression.get("unresolvedAttributes"))
            for channel, value in (expression.get("weights") or {}).items():
                referenced_weights.add(str(channel))
                numeric_value = float(value)
                sampled_weights.append(numeric_value)
                if not 0 <= numeric_value <= 1:
                    outside_unit_interval.append(
                        {"layer": "expression", "state": name, "channel": channel, "value": value}
                    )
        blink = runtime.get("blink") or {}
        unresolved += unresolved_count(blink.get("unresolvedAttributes"))
        for channel, value in (blink.get("weights") or {}).items():
            referenced_weights.add(str(channel))
            numeric_value = float(value)
            sampled_weights.append(numeric_value)
            if not 0 <= numeric_value <= 1:
                outside_unit_interval.append(
                    {"layer": "blink", "state": "HomeEyeBlink", "channel": channel, "value": value}
                )
        mouth = runtime.get("mouth") or {}
        unresolved += unresolved_count(mouth.get("unresolvedAttributes"))
        for channel, value in (mouth.get("constantWeights") or {}).items():
            referenced_weights.add(str(channel))
            numeric_value = float(value)
            sampled_weights.append(numeric_value)
            if not 0 <= numeric_value <= 1:
                outside_unit_interval.append(
                    {"layer": "mouth", "state": "HomeMouthOpen", "channel": channel, "value": value}
                )
        if mouth.get("curveTarget"):
            referenced_weights.add(str(mouth["curveTarget"]))

        missing_ordered_expressions = sorted(order - expression_names)
        unordered_expressions = sorted(expression_names - order)
        duplicate_ordered_expressions = sorted({
            name for name in ordered_names if ordered_names.count(name) > 1
        })

        if runtime.get("schema") != 1:
            record["errors"].append("expression-schema")
        if runtime.get("characterId") != character_id:
            record["errors"].append("expression-character-id")
        if broken_aliases:
            record["errors"].append("broken-expression-alias")
        if runtime.get("defaultExpression") not in expression_names:
            record["errors"].append("missing-default-expression")
        if missing_ordered_expressions:
            record["errors"].append("missing-ordered-expression")
        if unordered_expressions:
            record["errors"].append("unordered-expression")
        if duplicate_ordered_expressions:
            record["errors"].append("duplicate-expression-order")

        record["expressionRuntime"] = {
            "source": runtime.get("source"),
            "styleRetarget": runtime.get("styleRetarget"),
            "unityVersion": runtime.get("unityVersion"),
            "morphTargetCount": runtime.get("morphTargetCount"),
            "expressionCount": len(expression_names),
            "expressionOrderCount": len(ordered_names),
            "aliasCount": len(aliases),
            "defaultExpression": runtime.get("defaultExpression"),
            "blinkControllerPresent": blink.get("controller") is not None,
            "mouthCurveSegmentCount": len(mouth.get("curveSegments") or []),
            "unresolvedAttributeCount": unresolved,
            "brokenAliases": broken_aliases,
            "missingOrderedExpressions": missing_ordered_expressions,
            "unorderedExpressions": unordered_expressions,
            "duplicateOrderedExpressions": duplicate_ordered_expressions,
            "referencedMorphChannelCount": len(referenced_weights),
            "referencedMorphChannels": sorted(referenced_weights),
            "minimumStoredWeight": min(sampled_weights, default=0),
            "maximumStoredWeight": max(sampled_weights, default=0),
            # These are official Unity blend-shape values after division by
            # 100.  Negative and >1 values are evidence, never validation
            # failures: Unity/Three both permit them and several shipped
            # characters rely on them.
            "outsideUnitIntervalWeights": outside_unit_interval,
            "morphChannelValidation": "homeCharacterRuntime.test.mjs",
        }
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--official-home-root",
        type=Path,
        help=(
            "Optional decrypted AssetBundles/home/doll_house directory.  When "
            "present, strict coverage is measured against Home bundles that "
            "actually exist in the official release rather than every battle "
            "model directory."
        ),
    )
    parser.add_argument("--strict-coverage", action="store_true")
    args = parser.parse_args()

    directories = sorted(
        path for path in args.root.iterdir()
        if path.is_dir() and CHARACTER_RE.match(path.name)
    )
    records: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for directory in directories:
        try:
            records.append(audit_character(directory))
        except Exception as error:  # keep the full corpus visible in one run
            failures.append({"directory": directory.as_posix(), "error": repr(error)})

    missing_animation = [item["characterId"] for item in records if item["animationRuntime"] is None]
    missing_expression = [item["characterId"] for item in records if item["expressionRuntime"] is None]
    official_home_character_ids: list[int] | None = None
    if args.official_home_root is not None:
        if not args.official_home_root.is_dir():
            parser.error(f"official Home root does not exist: {args.official_home_root}")
        official_home_character_ids = sorted({
            int(match.group(1))
            for path in args.official_home_root.iterdir()
            if path.is_file()
            and (match := re.fullmatch(r"chara_(\d+?)\d{2}_home", path.name))
        })

    official_home_set = (
        set(official_home_character_ids)
        if official_home_character_ids is not None
        else None
    )
    modeled_character_ids = {item["characterId"] for item in records}
    official_home_without_character_directory = (
        sorted(official_home_set - modeled_character_ids)
        if official_home_set is not None
        else []
    )
    missing_animation_with_source = (
        [item for item in missing_animation if item in official_home_set]
        if official_home_set is not None
        else missing_animation
    )
    missing_expression_with_source = (
        [item for item in missing_expression if item in official_home_set]
        if official_home_set is not None
        else missing_expression
    )
    invalid = [item["characterId"] for item in records if item["errors"]]
    style_retarget_ids = sorted({
        item["characterId"]
        for item in records
        if (item["animationRuntime"] or {}).get("styleRetarget")
        or (item["expressionRuntime"] or {}).get("styleRetarget")
    })
    summary = {
        "characterDirectoryCount": len(directories),
        "parsedCharacterCount": len(records),
        "parseFailureCount": len(failures),
        "animationRuntimeCount": sum(item["animationRuntime"] is not None for item in records),
        "expressionRuntimeCount": sum(item["expressionRuntime"] is not None for item in records),
        "missingAnimationCharacterIds": missing_animation,
        "missingExpressionCharacterIds": missing_expression,
        "officialHomeSourceCharacterCount": (
            len(official_home_character_ids)
            if official_home_character_ids is not None
            else None
        ),
        "missingAnimationWithOfficialSourceCharacterIds": missing_animation_with_source,
        "missingExpressionWithOfficialSourceCharacterIds": missing_expression_with_source,
        "missingRuntimeWithoutOfficialHomeSourceCharacterIds": sorted(
            set(missing_animation + missing_expression)
            - (official_home_set or set())
        ) if official_home_set is not None else [],
        "styleRetargetCharacterIds": style_retarget_ids,
        "styleRetargetWithoutOfficialHomeSourceCharacterIds": (
            sorted(set(style_retarget_ids) - official_home_set)
            if official_home_set is not None
            else []
        ),
        "officialHomeSourceWithoutCharacterDirectoryIds": (
            official_home_without_character_directory
        ),
        "invalidCharacterIds": invalid,
        "unresolvedExpressionAttributeTotal": sum(
            (item["expressionRuntime"] or {}).get("unresolvedAttributeCount", 0)
            for item in records
        ),
        "characterIdsWithSignedOrOverOneWeights": [
            item["characterId"]
            for item in records
            if (item["expressionRuntime"] or {}).get("outsideUnitIntervalWeights")
        ],
        "signedOrOverOneWeightCount": sum(
            len((item["expressionRuntime"] or {}).get("outsideUnitIntervalWeights", []))
            for item in records
        ),
    }
    report = {"schemaVersion": 1, "summary": summary, "failures": failures, "characters": records}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if failures or invalid:
        raise SystemExit(1)
    if args.strict_coverage and (
        missing_animation_with_source
        or missing_expression_with_source
        or official_home_without_character_directory
    ):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
