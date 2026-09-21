#!/usr/bin/env python3
"""Audit or repair Viewer stage environment assets from serialized Cubemap bytes.

The scene profiles are the routing authority. This tool follows every recorded
ReDriveVolume reflection Cubemap and ReflectionProbe Cubemap back to its Steam
bundle/pathID, then rebuilds exact DDS containers for formats that WebGL can
consume without transcoding. No stage IDs, colors, or exposure thresholds are
encoded here.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import zlib
from pathlib import Path
from typing import Any, Iterable

import UnityPy


DEFAULT_BUNDLE_ROOT = Path(
    r"D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles"
)
EXACT_ENCODINGS = {"unity-bc6h-uf16", "unity-rgba16f"}
FORMAT_BY_ENCODING = {
    "unity-bc6h-uf16": 24,
    "unity-rgba16f": 17,
}


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description=(
            "Verify or byte-exactly repair generated Viewer environment DDS "
            "assets from official serialized Cubemap payloads"
        )
    )
    parser.add_argument("--repo-root", type=Path, default=repo_root)
    parser.add_argument("--bundle-root", type=Path, default=DEFAULT_BUNDLE_ROOT)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=repo_root
        / "public"
        / "stages"
        / "official"
        / "stage-environment-payloads.generated.json",
    )
    parser.add_argument("--report", type=Path, default=None)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--write",
        action="store_true",
        help="Replace only mismatched exact DDS containers and write the manifest",
    )
    mode.add_argument(
        "--check",
        action="store_true",
        help="Make no changes and require assets plus manifest to match authority",
    )
    return parser.parse_args()


def crc32_hex(payload: bytes) -> str:
    return f"{zlib.crc32(payload) & 0xFFFFFFFF:08x}"


def load_scene_extractor(repo_root: Path) -> Any:
    path = repo_root / "tools" / "magius" / "extract_magius_scene_profile.py"
    spec = importlib.util.spec_from_file_location("magius_scene_profile", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load scene extractor: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pointer_path_id(pointer: Any) -> int:
    if not isinstance(pointer, dict):
        return 0
    try:
        return int(pointer.get("pathID", 0))
    except (TypeError, ValueError):
        return 0


def iter_profile_bindings(profile: dict[str, Any]) -> Iterable[dict[str, Any]]:
    source = profile.get("sourceRecords") or {}
    redrive = source.get("reDriveReflectionProbe") or {}
    redrive_path_id = pointer_path_id(redrive.get("pointer"))
    redrive_url = redrive.get("environmentTextureUrl")
    redrive_encoding = redrive.get("environmentEncoding")
    if redrive_path_id and redrive_url and redrive_encoding:
        yield {
            "role": "redrive-custom-reflection",
            "pathID": redrive_path_id,
            "targetUrl": str(redrive_url),
            "encoding": str(redrive_encoding),
        }

    for probe in source.get("reflectionProbes") or []:
        path_id = pointer_path_id(probe.get("effectiveTexture"))
        target_url = probe.get("textureUrl")
        encoding = probe.get("textureEncoding")
        if path_id and target_url and encoding:
            yield {
                "role": "reflection-probe-component",
                "pathID": path_id,
                "targetUrl": str(target_url),
                "encoding": str(encoding),
                "componentPathID": str(probe.get("pathID", "")),
            }


def resolve_public_target(repo_root: Path, target_url: str) -> tuple[Path, str]:
    clean = target_url.split("?", 1)[0].split("#", 1)[0].replace("\\", "/")
    while clean.startswith("./"):
        clean = clean[2:]
    if not clean.startswith("stages/official/"):
        raise ValueError(f"Environment target is outside official stages: {target_url}")
    relative = Path("public") / Path(*clean.split("/"))
    target = (repo_root / relative).resolve()
    official_root = (repo_root / "public" / "stages" / "official").resolve()
    if target != official_root and official_root not in target.parents:
        raise ValueError(f"Resolved environment target escaped official root: {target}")
    return target, relative.as_posix()


def build_exact_container(extractor: Any, data: Any, encoding: str) -> bytes:
    payload = bytes(data.get_image_data())
    if encoding == "unity-bc6h-uf16":
        container, _ = extractor.build_bc6h_cubemap_dds(
            payload,
            int(data.m_Width),
            int(data.m_Height),
            int(data.m_MipCount),
            int(data.m_CompleteImageSize),
        )
        return container
    if encoding == "unity-rgba16f":
        container, _ = extractor.build_rgba16f_cubemap_dds(
            payload,
            int(data.m_Width),
            int(data.m_Height),
            int(data.m_MipCount),
            int(data.m_CompleteImageSize),
        )
        return container
    raise ValueError(f"No exact container builder for {encoding}")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    bundle_root = args.bundle_root.resolve()
    manifest_path = args.manifest.resolve()
    UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
    extractor = load_scene_extractor(repo_root)

    profiles = sorted(
        (repo_root / "public" / "stages" / "official").glob(
            "*/scene-profile.json"
        )
    )
    bundle_cache: dict[str, dict[int, Any]] = {}
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    repaired: list[str] = []

    for profile_path in profiles:
        try:
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            stage_id = str(profile["stageId"])
            bundle_key = str(profile["bundle"]).replace("\\", "/")
            bindings = list(iter_profile_bindings(profile))
            if not bindings:
                continue
            if bundle_key not in bundle_cache:
                bundle_path = bundle_root.joinpath(*bundle_key.split("/"))
                if not bundle_path.is_file():
                    raise FileNotFoundError(f"Official bundle missing: {bundle_path}")
                environment = UnityPy.load(str(bundle_path))
                bundle_cache[bundle_key] = {
                    int(obj.path_id): obj for obj in environment.objects
                }
            objects = bundle_cache[bundle_key]

            for binding in bindings:
                path_id = int(binding["pathID"])
                reader = objects.get(path_id)
                if reader is None:
                    raise KeyError(
                        f"{stage_id} {binding['role']} pathID {path_id} not found"
                    )
                data = reader.read()
                payload = bytes(data.get_image_data())
                encoding = str(binding["encoding"])
                target_path, target_relative = resolve_public_target(
                    repo_root, str(binding["targetUrl"])
                )
                target_before = target_path.read_bytes() if target_path.is_file() else None
                exact_container: bytes | None = None
                data_offset: int | None = None
                before_exact: bool | None = None
                if encoding in EXACT_ENCODINGS:
                    expected_format = FORMAT_BY_ENCODING[encoding]
                    actual_format = int(data.m_TextureFormat)
                    if actual_format != expected_format:
                        raise ValueError(
                            f"{stage_id} {path_id}: encoding {encoding} expects "
                            f"format {expected_format}, serialized format is {actual_format}"
                        )
                    exact_container = build_exact_container(extractor, data, encoding)
                    data_offset = len(exact_container) - len(payload)
                    before_exact = target_before == exact_container
                    if not before_exact and args.write:
                        target_path.parent.mkdir(parents=True, exist_ok=True)
                        target_path.write_bytes(exact_container)
                        repaired.append(target_relative)

                target_after = target_path.read_bytes() if target_path.is_file() else None
                after_exact = (
                    target_after == exact_container
                    if exact_container is not None
                    else None
                )
                target_payload = (
                    target_after[data_offset:]
                    if target_after is not None and data_offset is not None
                    else None
                )
                record = {
                    "stageId": stage_id,
                    "bundle": bundle_key,
                    "role": binding["role"],
                    "componentPathID": binding.get("componentPathID"),
                    "sourcePathID": str(path_id),
                    "sourceName": str(data.m_Name),
                    "sourceType": str(reader.type.name),
                    "sourceTextureFormat": int(data.m_TextureFormat),
                    "sourceColorSpace": int(getattr(data, "m_ColorSpace", 0)),
                    "width": int(data.m_Width),
                    "height": int(data.m_Height),
                    "mipCount": int(data.m_MipCount),
                    "encoding": encoding,
                    "verificationMode": (
                        "serialized-payload-byte-exact"
                        if encoding in EXACT_ENCODINGS
                        else "serialized-source-and-export-container"
                    ),
                    "sourcePayloadByteCount": len(payload),
                    "sourcePayloadCrc32": crc32_hex(payload),
                    "sourcePayloadFirst16": payload[:16].hex(),
                    "sourcePayloadLast16": payload[-16:].hex(),
                    "targetUrl": binding["targetUrl"],
                    "targetPath": target_relative,
                    "targetExists": target_after is not None,
                    "targetByteCount": (
                        len(target_after) if target_after is not None else None
                    ),
                    "targetCrc32": (
                        crc32_hex(target_after) if target_after is not None else None
                    ),
                    "dataOffset": data_offset,
                    "targetPayloadByteCount": (
                        len(target_payload) if target_payload is not None else None
                    ),
                    "targetPayloadCrc32": (
                        crc32_hex(target_payload) if target_payload is not None else None
                    ),
                    "targetPayloadFirst16": (
                        target_payload[:16].hex() if target_payload is not None else None
                    ),
                    "targetPayloadLast16": (
                        target_payload[-16:].hex() if target_payload is not None else None
                    ),
                    "payloadByteExact": after_exact,
                }
                records.append(
                    {key: value for key, value in record.items() if value is not None}
                )
        except Exception as error:  # keep a complete bounded audit report
            errors.append(f"{profile_path}: {error!r}")

    records.sort(
        key=lambda record: (
            str(record["stageId"]),
            str(record["role"]),
            int(record["sourcePathID"]),
        )
    )
    exact_records = [r for r in records if r["encoding"] in EXACT_ENCODINGS]
    mismatches = [r for r in exact_records if not r.get("payloadByteExact", False)]
    missing = [r for r in records if not r.get("targetExists", False)]
    manifest = {
        "schema": "magius-stage-environment-payloads-v1",
        "authority": (
            "Steam JP serialized Cubemap bytes routed by generated scene profiles"
        ),
        "generator": "scripts/repair-official-stage-environment-payloads.py",
        "profileCount": len(profiles),
        "recordCount": len(records),
        "exactRecordCount": len(exact_records),
        "transcodedRecordCount": len(records) - len(exact_records),
        "records": records,
    }
    manifest_text = canonical_json(manifest)
    existing_manifest_text = (
        manifest_path.read_text(encoding="utf-8") if manifest_path.is_file() else None
    )

    if args.write and not errors and not mismatches and not missing:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(manifest_text, encoding="utf-8")

    manifest_exact = existing_manifest_text == manifest_text
    if args.write and manifest_path.is_file():
        manifest_exact = manifest_path.read_text(encoding="utf-8") == manifest_text

    report = {
        "schema": "magius-stage-environment-payload-repair-report-v1",
        "mode": "write" if args.write else "check",
        "repoRoot": str(repo_root),
        "bundleRoot": str(bundle_root),
        "profileCount": len(profiles),
        "recordCount": len(records),
        "exactRecordCount": len(exact_records),
        "transcodedRecordCount": len(records) - len(exact_records),
        "repairedCount": len(repaired),
        "repaired": repaired,
        "mismatchCount": len(mismatches),
        "mismatches": [r["targetPath"] for r in mismatches],
        "missingCount": len(missing),
        "missing": [r["targetPath"] for r in missing],
        "manifestPath": str(manifest_path),
        "manifestExact": manifest_exact,
        "errors": errors,
        "records": records,
    }
    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(canonical_json(report), encoding="utf-8")
    print(
        json.dumps(
            {
                key: report[key]
                for key in (
                    "mode",
                    "profileCount",
                    "recordCount",
                    "exactRecordCount",
                    "transcodedRecordCount",
                    "repairedCount",
                    "repaired",
                    "mismatchCount",
                    "missingCount",
                    "manifestExact",
                    "errors",
                )
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0 if not errors and not mismatches and not missing and manifest_exact else 1


if __name__ == "__main__":
    sys.exit(main())
