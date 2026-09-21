from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import UnityPy


UNITY_VERSION = "2022.3.62f2"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def source_relative_path(resource_name: str) -> Path:
    if resource_name.endswith("_battle_unit"):
        return Path("battle") / "character" / resource_name
    return Path("home") / resource_name


def exact_cloth_record(source_path: Path, component_path_id: int) -> dict[str, Any]:
    environment = UnityPy.load(str(source_path))
    objects = {int(obj.path_id): obj for obj in environment.objects}
    component = objects.get(component_path_id)
    if component is None or component.type.name != "MonoBehaviour":
        raise ValueError(f"component-unresolved:{component_path_id}")
    data = component.read(check_read=False)
    script_name = str(getattr(data.m_Script.read(), "m_Name", ""))
    if script_name != "MagicaCloth":
        raise ValueError(f"component-script:{component_path_id}:{script_name}")
    tree = component.read_typetree()
    serialize_data = tree.get("serializeData", {})
    root_ids = [
        int(value.get("m_PathID", 0))
        for value in serialize_data.get("rootBones", [])
    ]
    return {
        "componentPathID": str(component_path_id),
        "script": script_name,
        "componentEnabled": bool(tree.get("m_Enabled", 1)),
        "serializedRootBonePathIDs": [str(value) for value in root_ids],
        "nullRootBoneSlots": sum(value == 0 for value in root_ids),
        "rootBoneSlots": len(root_ids),
    }


def build(args: argparse.Namespace) -> None:
    UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    catalog = load_json(args.physics_catalog)
    target_records = []
    for entry in catalog["entries"]:
        profile_path = (args.physics_catalog.parent / entry["productUrl"]).resolve()
        profile = load_json(profile_path)
        for cloth in profile["components"]["cloth"]:
            if cloth["runtimeBinding"]["status"] != "fail-closed":
                continue
            target_records.append(
                {
                    "identity": profile["identity"],
                    "componentPathID": cloth["componentPathID"],
                    "componentStableKey": cloth["stableKey"],
                    "hierarchyPath": cloth["binding"]["hierarchyPath"],
                    "runtimeBinding": cloth["runtimeBinding"],
                }
            )

    roots = {
        "ma-ex-data": args.primary_root,
        "mumu-tw": args.tw_root,
        "steam-jp": args.steam_root,
    }
    for target in target_records:
        relative_path = source_relative_path(target["identity"]["resourceName"])
        target["regionalEvidence"] = {
            name: {
                "sourceAbsolutePath": str(root / relative_path),
                **exact_cloth_record(
                    root / relative_path,
                    int(target["componentPathID"]),
                ),
            }
            for name, root in roots.items()
        }
        signatures = {
            tuple(value["serializedRootBonePathIDs"])
            for value in target["regionalEvidence"].values()
        }
        target["regionalRootBindingsExact"] = len(signatures) == 1
        target["typedDecision"] = (
            "fail-closed-official-null-root-bindings;no-name-or-action-inference"
        )

    output = {
        "schema": "magius.character-physics-regional-root-binding-evidence.v1",
        "inventoryRescan": False,
        "selection": "generated profiles with runtimeBinding.status=fail-closed only",
        "counts": {
            "targetComponents": len(target_records),
            "regions": len(roots),
            "regionRecords": len(target_records) * len(roots),
            "regionalExact": sum(
                record["regionalRootBindingsExact"] for record in target_records
            ),
        },
        "records": target_records,
    }
    write_json(args.output, output)
    print(json.dumps(output["counts"], sort_keys=True))


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--physics-catalog",
        type=Path,
        default=repo_root / "public" / "character-physics" / "manifest.v1.json",
    )
    parser.add_argument(
        "--primary-root",
        type=Path,
        default=Path(r"D:\magia\ma-ex-data\gamedata\AssetBundles"),
    )
    parser.add_argument(
        "--tw-root",
        type=Path,
        default=Path(r"D:\magia\Madoka Magica Magia Exedra TW\AssetBundles"),
    )
    parser.add_argument(
        "--steam-root",
        type=Path,
        default=Path(r"D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root
        / "artifacts"
        / "research"
        / "20260829-character-physics-native-authority"
        / "regional-root-binding-evidence.v1.json",
    )
    build(parser.parse_args())


if __name__ == "__main__":
    main()
