#!/usr/bin/env python3
"""Index and selectively extract Unity 2022 compiled shader variants.

The source set is bounded by an existing Magius scene closure manifest. Unity
2022 stores a chunk table in decompressed segment zero; each player subprogram
then addresses one byte range in another decompressed segment.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence


@dataclass(frozen=True)
class ChunkEntry:
    offset: int
    length: int
    segment: int


def parse_chunk_table(segment_zero: bytes) -> list[ChunkEntry]:
    """Parse Unity 2019.3+ ``count + {offset,length,segment}`` entries.

    AssetBundle shaders keep this table in a dedicated first compressed
    segment. Player ``resources.assets`` may instead append every subprogram
    directly after the table in the same segment. The latter layout is accepted
    only when its segment-zero chunks form one exact contiguous payload.
    """
    if len(segment_zero) < 4:
        raise ValueError("Shader chunk table is shorter than its count")
    count = struct.unpack_from("<I", segment_zero, 0)[0]
    expected = 4 + count * 12
    if expected > len(segment_zero):
        raise ValueError(
            f"Shader chunk table length mismatch: count={count}, "
            f"expected-at-least={expected}, actual={len(segment_zero)}"
        )
    entries = [
        ChunkEntry(*struct.unpack_from("<III", segment_zero, 4 + index * 12))
        for index in range(count)
    ]
    if expected == len(segment_zero):
        return entries

    cursor = expected
    for entry in entries:
        if entry.segment != 0 or entry.offset != cursor:
            raise ValueError(
                "Shader chunk table has trailing bytes but not one contiguous "
                "embedded segment-zero payload"
            )
        cursor += entry.length
    if cursor != len(segment_zero):
        raise ValueError(
            "Shader chunk table embedded payload length mismatch: "
            f"expected-end={cursor}, actual={len(segment_zero)}"
        )
    return entries


def keyword_names(indices: Iterable[int], names: Sequence[str]) -> list[str]:
    resolved: list[str] = []
    for index in indices:
        if index < 0 or index >= len(names):
            raise ValueError(
                f"Shader keyword index {index} is outside 0..{len(names) - 1}"
            )
        resolved.append(names[index])
    return resolved


def safe_file_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "shader"


def compiled_program_payload(
    program_code: bytes,
    program_type_name: str,
) -> tuple[bytes, str, str, int]:
    """Return the native payload, extension, format and wrapper offset.

    Unity's DX11 subprogram record prefixes the actual DXBC container with a
    small Unity header. Textual OpenGL/GLES records are already plain source.
    Unknown formats remain byte-exact instead of being decoded with replacement
    characters.
    """
    if "DX11" in program_type_name or "DX12" in program_type_name:
        offset = program_code.find(b"DXBC")
        if offset < 0 or offset + 32 > len(program_code):
            raise ValueError(
                f"{program_type_name} program has no complete DXBC header"
            )
        total_size = struct.unpack_from("<I", program_code, offset + 24)[0]
        end = offset + total_size
        if total_size < 32 or end > len(program_code):
            raise ValueError(
                f"{program_type_name} DXBC size exceeds its program record: "
                f"offset={offset}, size={total_size}, record={len(program_code)}"
            )
        return program_code[offset:end], ".dxbc", "dxbc", offset

    if b"#version" in program_code[:256] or program_code.startswith(b"#if"):
        return program_code, ".glsl", "glsl", 0

    spirv_magic = b"\x03\x02\x23\x07"
    spirv_offset = program_code.find(spirv_magic)
    if spirv_offset >= 0:
        return program_code[spirv_offset:], ".spv", "spirv", spirv_offset

    return program_code, ".bin", "binary", 0


def load_manifest(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    versioned = value.get("schemaVersion") == 1
    legacy_closure = (
        value.get("schemaVersion") is None
        and isinstance(value.get("scene"), str)
        and isinstance(value.get("unityVersion"), str)
    )
    if not (versioned or legacy_closure) or not isinstance(value.get("files"), list):
        raise ValueError(f"Unsupported closure manifest: {path}")
    return value


def source_paths(manifest: dict[str, Any]) -> list[tuple[str, Path]]:
    result: list[tuple[str, Path]] = []
    for record in manifest["files"]:
        source = Path(record["source"])
        if not source.is_file():
            raise FileNotFoundError(source)
        result.append((record.get("name", source.name), source))
    return result


def iter_player_records(shader: Any) -> Iterable[dict[str, Any]]:
    parsed = shader.m_ParsedForm
    names = list(parsed.m_KeywordNames)
    for subshader_index, subshader in enumerate(parsed.m_SubShaders):
        for pass_index, shader_pass in enumerate(subshader.m_Passes):
            pass_name = shader_pass.m_State.m_Name or shader_pass.m_Name or ""
            for container_name in (
                "progVertex",
                "progFragment",
                "progGeometry",
                "progHull",
                "progDomain",
                "progRayTracing",
            ):
                program = getattr(shader_pass, container_name)
                for player_group_index, group in enumerate(
                    program.m_PlayerSubPrograms
                ):
                    for entry_index, entry in enumerate(group):
                        yield {
                            "subshaderIndex": subshader_index,
                            "passIndex": pass_index,
                            "passName": pass_name,
                            "programContainer": container_name,
                            "playerGroupIndex": player_group_index,
                            "entryIndex": entry_index,
                            "blobIndex": int(entry.m_BlobIndex),
                            "gpuProgramType": int(entry.m_GpuProgramType),
                            "shaderRequirements": int(entry.m_ShaderRequirements),
                            "keywords": keyword_names(entry.m_KeywordIndices, names),
                        }


class CompiledShaderSegments:
    def __init__(self, shader: Any):
        from UnityPy.helpers import CompressionHelper

        if len(shader.platforms) != 1:
            raise ValueError(
                f"Expected one platform, found {len(shader.platforms)}"
            )
        offsets = shader.offsets[0]
        compressed_lengths = shader.compressedLengths[0]
        decompressed_lengths = shader.decompressedLengths[0]
        if not (
            len(offsets)
            == len(compressed_lengths)
            == len(decompressed_lengths)
        ):
            raise ValueError("Shader compressed segment arrays have different lengths")
        blob = bytes(shader.compressedBlob)
        self._segments: list[bytes | None] = [None] * len(offsets)
        self._source = (
            blob,
            list(offsets),
            list(compressed_lengths),
            list(decompressed_lengths),
        )
        self.table = parse_chunk_table(self.segment(0))

    def segment(self, index: int) -> bytes:
        from UnityPy.helpers import CompressionHelper

        if index < 0 or index >= len(self._segments):
            raise ValueError(f"Shader segment index out of range: {index}")
        cached = self._segments[index]
        if cached is not None:
            return cached
        blob, offsets, compressed_lengths, decompressed_lengths = self._source
        offset = offsets[index]
        compressed = blob[offset : offset + compressed_lengths[index]]
        value = CompressionHelper.decompress_lz4(
            compressed,
            decompressed_lengths[index],
        )
        self._segments[index] = value
        return value

    def subprogram(self, blob_index: int) -> Any:
        from UnityPy.export.ShaderConverter import ShaderSubProgram
        from UnityPy.streams import EndianBinaryReader

        if blob_index < 0 or blob_index >= len(self.table):
            raise ValueError(f"Shader blob index out of range: {blob_index}")
        entry = self.table[blob_index]
        segment = self.segment(entry.segment)
        end = entry.offset + entry.length
        if end > len(segment):
            raise ValueError(
                f"Shader blob {blob_index} exceeds segment {entry.segment}"
            )
        return ShaderSubProgram(
            EndianBinaryReader(segment[entry.offset:end], endian="<")
        )


def variant_matches(
    record: dict[str, Any],
    include_keywords: set[str],
    exclude_keywords: set[str],
) -> bool:
    keywords = set(record["keywords"])
    return include_keywords <= keywords and not (exclude_keywords & keywords)


def extract_manifest_variants(args: argparse.Namespace) -> dict[str, Any]:
    import UnityPy
    from UnityPy import config
    from UnityPy.enums import ShaderCompilerPlatform, ShaderGpuProgramType

    manifest = load_manifest(args.closure_manifest)
    unity_version = args.unity_version or manifest.get("unityVersion")
    if not unity_version:
        raise ValueError("Unity version is absent; pass --unity-version")
    config.FALLBACK_UNITY_VERSION = unity_version

    requested = set(args.shader_name)
    found: set[str] = set()
    shaders: list[dict[str, Any]] = []
    extracted: list[dict[str, Any]] = []
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.extract_dir:
        args.extract_dir.mkdir(parents=True, exist_ok=True)

    for bundle_name, source in source_paths(manifest):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            environment = UnityPy.load(str(source))
        for object_reader in environment.objects:
            if object_reader.type.name != "Shader":
                continue
            shader = object_reader.read()
            shader_name = shader.m_ParsedForm.m_Name
            if requested and shader_name not in requested:
                continue
            found.add(shader_name)
            records = list(iter_player_records(shader))
            for record in records:
                try:
                    record["gpuProgramTypeName"] = ShaderGpuProgramType(
                        record["gpuProgramType"]
                    ).name
                except ValueError:
                    record["gpuProgramTypeName"] = "unknown"
            platform_value = int(shader.platforms[0]) if shader.platforms else -1
            try:
                platform_name = ShaderCompilerPlatform(platform_value).name
            except ValueError:
                platform_name = "unknown"
            shader_record = {
                "name": shader_name,
                "pathId": str(object_reader.path_id),
                "bundleName": bundle_name,
                "source": str(source),
                "platform": platform_value,
                "platformName": platform_name,
                "keywordNames": list(shader.m_ParsedForm.m_KeywordNames),
                "variantCount": len(records),
                "variants": records,
            }
            shaders.append(shader_record)

            if not args.extract_dir:
                continue
            segments = CompiledShaderSegments(shader)
            seen_blobs: set[int] = set()
            for record in records:
                if len(extracted) >= args.max_extract:
                    break
                if not variant_matches(
                    record,
                    set(args.include_keyword),
                    set(args.exclude_keyword),
                ):
                    continue
                blob_index = record["blobIndex"]
                if blob_index in seen_blobs:
                    continue
                subprogram = segments.subprogram(blob_index)
                program_code = bytes(subprogram.m_ProgramCode)
                program_type_name = subprogram.m_ProgramType.name
                payload, extension, payload_format, payload_offset = (
                    compiled_program_payload(program_code, program_type_name)
                )
                searchable = (
                    payload.decode("utf-8", "replace")
                    if payload_format == "glsl"
                    else ""
                )
                if args.contains and args.contains not in searchable:
                    continue
                seen_blobs.add(blob_index)
                compiled_keywords = list(subprogram.m_Keywords)
                filename = (
                    f"{safe_file_name(shader_name)}-pass{record['passIndex']}-"
                    f"blob{blob_index}{extension}"
                )
                destination = args.extract_dir / filename
                destination.write_bytes(payload)
                extracted.append(
                    {
                        "shader": shader_name,
                        "pathId": str(object_reader.path_id),
                        "passIndex": record["passIndex"],
                        "passName": record["passName"],
                        "blobIndex": blob_index,
                        "gpuProgramType": int(subprogram.m_ProgramType),
                        "gpuProgramTypeName": program_type_name,
                        "serializedKeywords": record["keywords"],
                        "compiledKeywords": compiled_keywords,
                        "codeBytes": len(program_code),
                        "payloadBytes": len(payload),
                        "payloadFormat": payload_format,
                        "payloadOffset": payload_offset,
                        "output": str(destination),
                    }
                )

    missing = sorted(requested - found)
    if missing:
        raise ValueError(f"Requested shaders absent from closure: {missing}")
    document = {
        "schemaVersion": 1,
        "authority": "official-unity-2022-compiled-shader",
        "closureManifest": str(args.closure_manifest),
        "unityVersion": unity_version,
        "shaderCount": len(shaders),
        "shaders": shaders,
        "selection": {
            "includeKeywords": args.include_keyword,
            "excludeKeywords": args.exclude_keyword,
            "contains": args.contains,
            "maxExtract": args.max_extract,
        },
        "extracted": extracted,
    }
    args.output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return document


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--closure-manifest", type=Path, required=True)
    parser.add_argument("--shader-name", action="append", default=[])
    parser.add_argument("--unity-version")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--extract-dir", type=Path)
    parser.add_argument("--include-keyword", action="append", default=[])
    parser.add_argument("--exclude-keyword", action="append", default=[])
    parser.add_argument("--contains")
    parser.add_argument("--max-extract", type=int, default=8)
    args = parser.parse_args()
    if args.max_extract < 0:
        parser.error("--max-extract must be non-negative")
    return args


def main() -> int:
    args = parse_args()
    document = extract_manifest_variants(args)
    print(
        json.dumps(
            {
                "shaderCount": document["shaderCount"],
                "variantCount": sum(
                    item["variantCount"] for item in document["shaders"]
                ),
                "extracted": len(document["extracted"]),
                "output": str(args.output),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
