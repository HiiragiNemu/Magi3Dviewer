#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import Any, Iterable

import UnityPy
import lz4.block

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/character/chara_100101_battle_unit'
TARGET_MATERIAL = 'mt_chara_100101_body_sj'
OUTPUT = Path('research/official-redrive-modern-shader-programs.json')

TOKENS = (
    b'_ISGEM', b'_IsGem', b'Gem', b'MatCap',
    b'_RDTOON_ENABLE_SELF_SHADOW', b'RdToonSelfShadow', b'SelfShadow',
    b'_USE_DEPTHTEX_RIM_SHADOW', b'DepthTex', b'DepthRim', b'DepthShadow',
    b'Aniso', b'_IsAniso', b'_Aniso', b'Fresnel', b'_Fresnel',
    b'SpecularGradient', b'ControlMap', b'AngelRing',
    b'#version', b'void main', b'precision highp', b'layout(',
)


def material_shader(env: Any):
    for obj in env.objects:
        if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Material':
            continue
        try:
            material = obj.read()
        except Exception:
            continue
        if str(getattr(material, 'm_Name', '')).strip().lower() != TARGET_MATERIAL:
            continue
        pointer = getattr(material, 'm_Shader', None)
        if pointer is None:
            continue
        shader = pointer.read()
        path_id = int(getattr(pointer, 'm_PathID', 0) or 0)
        reader = next(
            (
                candidate for candidate in env.objects
                if int(getattr(candidate, 'path_id', 0) or 0) == path_id
                and str(getattr(getattr(candidate, 'type', None), 'name', '')) == 'Shader'
            ),
            None,
        )
        if reader is None:
            raise RuntimeError(f'Shader ObjectReader {path_id} not found')
        return material, pointer, reader, shader
    raise RuntimeError(f'{TARGET_MATERIAL} not found')


def nested_lists(value: Any) -> list[list[int]]:
    if value is None:
        return []
    if isinstance(value, dict) and 'items' in value:
        value = value['items']
    if not isinstance(value, (list, tuple)):
        return []
    if value and all(isinstance(item, int) for item in value):
        return [[int(item) for item in value]]
    result = []
    for item in value:
        if isinstance(item, dict) and 'items' in item:
            item = item['items']
        if isinstance(item, (list, tuple)):
            result.append([int(child) for child in item])
    return result


def blob_bytes(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, memoryview):
        return value.tobytes()
    if isinstance(value, (list, tuple)):
        return bytes(int(item) & 0xff for item in value)
    raise TypeError(f'Unsupported compressedBlob type: {type(value).__name__}')


def ascii_strings(data: bytes, minimum: int = 6) -> list[tuple[int, str]]:
    pattern = re.compile(rb'[\x20-\x7e]{%d,}' % minimum)
    return [
        (match.start(), match.group().decode('ascii', errors='replace'))
        for match in pattern.finditer(data)
    ]


def contexts(data: bytes, radius: int = 480) -> list[dict[str, Any]]:
    regions: list[tuple[int, int, str]] = []
    lower = data.lower()
    for token in TOKENS:
        start = 0
        token_lower = token.lower()
        while True:
            index = lower.find(token_lower, start)
            if index < 0:
                break
            regions.append((
                max(0, index - radius),
                min(len(data), index + len(token) + radius),
                token.decode('ascii', errors='replace'),
            ))
            start = index + max(1, len(token))
    if not regions:
        return []
    regions.sort()
    merged: list[dict[str, Any]] = []
    for start, stop, token in regions:
        if merged and start <= merged[-1]['end']:
            merged[-1]['end'] = max(merged[-1]['end'], stop)
            merged[-1]['tokens'].append(token)
        else:
            merged.append({'start': start, 'end': stop, 'tokens': [token]})
    result = []
    for item in merged[:100]:
        segment = data[item['start']:item['end']]
        strings = ascii_strings(segment, 4)
        result.append({
            'start': item['start'],
            'end': item['end'],
            'tokens': sorted(set(item['tokens'])),
            'ascii': [
                {'offset': item['start'] + offset, 'text': text[:4000]}
                for offset, text in strings[:80]
            ],
            'hexHead': segment[:256].hex(),
        })
    return result


def decompress_chunk(block: bytes, expected: int) -> tuple[bytes | None, str | None, str | None]:
    attempts = [
        ('lz4.block', lambda: lz4.block.decompress(block, uncompressed_size=expected)),
        ('lz4.block-auto', lambda: lz4.block.decompress(block)),
    ]
    for name, fn in attempts:
        try:
            result = fn()
        except Exception as exc:
            last = repr(exc)
            continue
        if expected and len(result) != expected:
            return result, name, f'length mismatch {len(result)} != {expected}'
        return result, name, None
    return None, None, last if 'last' in locals() else 'no decompression attempt'


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-rd-programs-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        character_entries = [entry for entry in entries if entry.full_path.lower() == TARGET_BUNDLE]
        shader_entries = [entry for entry in entries if entry.full_path.lower().startswith(('shader/', 'shaders/'))]
        selected = sorted({entry.full_path: entry for entry in [*character_entries, *shader_entries]}.values(), key=lambda item: item.full_path)
        downloaded = [base.download(entry, request_headers, token, temp) for entry in selected]
        env = UnityPy.load(*(str(path) for path in downloaded))
        material, pointer, reader, shader = material_shader(env)

        platforms = [int(value) for value in (getattr(shader, 'platforms', None) or getattr(shader, 'm_Platforms', None) or [])]
        offsets = nested_lists(getattr(shader, 'offsets', None) or getattr(shader, 'm_Offsets', None))
        compressed_lengths = nested_lists(getattr(shader, 'compressedLengths', None) or getattr(shader, 'm_CompressedLengths', None))
        decompressed_lengths = nested_lists(getattr(shader, 'decompressedLengths', None) or getattr(shader, 'm_DecompressedLengths', None))
        blob = blob_bytes(getattr(shader, 'compressedBlob', None) or getattr(shader, 'm_CompressedBlob', None))

        if not platforms:
            raise RuntimeError('modern Shader exposes no platform table')
        if not compressed_lengths or not decompressed_lengths:
            raise RuntimeError('modern Shader exposes no compressed/decompressed length tables')
        if len(compressed_lengths) != len(decompressed_lengths):
            raise RuntimeError('compressed/decompressed platform table count mismatch')

        # Unity stores one offset/length array per platform. Some UnityPy
        # versions omit the public offsets property; in that case the chunks are
        # still contiguous and can be reconstructed by cumulative compressed size.
        if not offsets:
            offsets = []
            for lengths in compressed_lengths:
                running = 0
                row = []
                for length in lengths:
                    row.append(running)
                    running += length
                offsets.append(row)

        chunks = []
        for platform_index, comp_row in enumerate(compressed_lengths):
            decomp_row = decompressed_lengths[platform_index]
            offset_row = offsets[platform_index]
            if not (len(comp_row) == len(decomp_row) == len(offset_row)):
                raise RuntimeError(
                    f'platform {platform_index} table mismatch: '
                    f'{len(offset_row)}/{len(comp_row)}/{len(decomp_row)}'
                )
            for chunk_index, (offset, comp_len, decomp_len) in enumerate(zip(offset_row, comp_row, decomp_row)):
                compressed = blob[offset:offset + comp_len]
                decoded, algorithm, error = decompress_chunk(compressed, decomp_len)
                record = {
                    'platformIndex': platform_index,
                    'platform': platforms[platform_index] if platform_index < len(platforms) else None,
                    'chunkIndex': chunk_index,
                    'offset': offset,
                    'compressedLength': comp_len,
                    'decompressedLength': decomp_len,
                    'compressedSha256': hashlib.sha256(compressed).hexdigest(),
                    'algorithm': algorithm,
                    'error': error,
                }
                if decoded is not None:
                    printable = sum(1 for byte in decoded if byte in b'\t\n\r' or 32 <= byte <= 126)
                    record.update({
                        'decodedLength': len(decoded),
                        'decodedSha256': hashlib.sha256(decoded).hexdigest(),
                        'printableRatio': printable / max(1, len(decoded)),
                        'magicHex': decoded[:32].hex(),
                        'contexts': contexts(decoded),
                        'leadingStrings': [
                            {'offset': offset_s, 'text': text[:1000]}
                            for offset_s, text in ascii_strings(decoded)[:30]
                        ],
                    })
                chunks.append(record)

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-modern-ReDrive-Shader',
            'metadata': metadata,
            'material': str(getattr(material, 'm_Name', '')),
            'shaderPathId': int(getattr(pointer, 'm_PathID', 0) or 0),
            'shaderSerializedFile': str(getattr(getattr(reader, 'assets_file', None), 'name', '')),
            'platforms': platforms,
            'blobLength': len(blob),
            'blobSha256': hashlib.sha256(blob).hexdigest(),
            'usedSyntheticOffsets': getattr(shader, 'offsets', None) is None and getattr(shader, 'm_Offsets', None) is None,
            'chunkCount': len(chunks),
            'successfulChunkCount': sum(1 for item in chunks if item.get('decodedLength') is not None),
            'tokenHitChunkCount': sum(1 for item in chunks if item.get('contexts')),
            'chunks': chunks,
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'platforms': platforms,
            'blobLength': len(blob),
            'chunkCount': report['chunkCount'],
            'successfulChunkCount': report['successfulChunkCount'],
            'tokenHitChunkCount': report['tokenHitChunkCount'],
            'interestingChunks': [
                {
                    'chunkIndex': item['chunkIndex'],
                    'printableRatio': item.get('printableRatio'),
                    'tokens': sorted({token for context in item.get('contexts', []) for token in context['tokens']}),
                    'magicHex': item.get('magicHex'),
                }
                for item in chunks if item.get('contexts')
            ],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
