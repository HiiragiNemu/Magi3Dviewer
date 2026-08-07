#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import Any

import UnityPy
import lz4.block

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'shader/bg_uber'
OUTPUT = Path('research/official-608-bg-uber-formula-windows.json')
WINDOW_RADIUS = 8192
MAX_WINDOWS_PER_GROUP = 4
MAX_LINES = 180
MAX_LINE_CHARS = 560

GROUPS: dict[str, tuple[bytes, ...]] = {
    'mesh-uv-source': (
        b'_UseMeshUV', b'UseMeshUV', b'_BaseMap', b'_MainTex',
        b'_BaseMap_ST', b'_MainTex_ST', b'TEXCOORD0',
    ),
    'billboard': (
        b'_USE_BILLBOARD', b'_UseBillboard', b'Billboard',
        b'unity_MatrixV', b'unity_MatrixInvV',
    ),
    'alpha-clip': (
        b'_ALPHATEST_ON', b'_AlphaClip', b'_Alpha_Clip',
        b'_AlphaToMask', b'_Surface', b'discard',
    ),
    'vertex-color-blend': (
        b'_USE_VERTEX_COLOR_BLEND', b'_UseVertexColor',
        b'COLOR0', b'vs_COLOR0',
    ),
}

CODE_HINTS = (
    'void main', 'if(', 'if (', 'texture(', 'texelFetch(', 'dot(', 'cross(',
    'normalize(', 'inversesqrt(', 'clamp(', 'mix(', 'smoothstep(', 'step(',
    'discard', '>=', '<=', '&&', '?:',
)


def nested_lists(value: Any) -> list[list[int]]:
    if value is None:
        return []
    if isinstance(value, dict) and 'items' in value:
        value = value['items']
    if not isinstance(value, (list, tuple)):
        return []
    if value and all(isinstance(item, int) for item in value):
        return [[int(item) for item in value]]
    result: list[list[int]] = []
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
    raise TypeError(f'unsupported compressedBlob type: {type(value).__name__}')


def decompress_chunk(block: bytes, expected: int) -> tuple[bytes | None, str | None]:
    attempts = (
        lambda: lz4.block.decompress(block, uncompressed_size=expected),
        lambda: lz4.block.decompress(block),
    )
    errors: list[str] = []
    for fn in attempts:
        try:
            decoded = fn()
        except Exception as exc:
            errors.append(repr(exc))
            continue
        if expected and len(decoded) != expected:
            errors.append(f'length mismatch {len(decoded)} != {expected}')
            continue
        return decoded, None
    return None, '; '.join(errors)


def ascii_strings(data: bytes, minimum: int = 4) -> list[tuple[int, str]]:
    pattern = re.compile(rb'[\x20-\x7e]{%d,}' % minimum)
    return [
        (match.start(), match.group().decode('ascii', errors='replace'))
        for match in pattern.finditer(data)
    ]


def shader_name(shader: Any) -> str:
    return str(
        getattr(shader, 'm_Name', None)
        or getattr(shader, 'name', None)
        or ''
    )


def reconstruct_chunks(shader: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    platforms = [
        int(value)
        for value in (
            getattr(shader, 'platforms', None)
            or getattr(shader, 'm_Platforms', None)
            or []
        )
    ]
    offsets = nested_lists(
        getattr(shader, 'offsets', None)
        or getattr(shader, 'm_Offsets', None)
    )
    compressed_lengths = nested_lists(
        getattr(shader, 'compressedLengths', None)
        or getattr(shader, 'm_CompressedLengths', None)
    )
    decompressed_lengths = nested_lists(
        getattr(shader, 'decompressedLengths', None)
        or getattr(shader, 'm_DecompressedLengths', None)
    )
    blob = blob_bytes(
        getattr(shader, 'compressedBlob', None)
        or getattr(shader, 'm_CompressedBlob', None)
    )
    if not compressed_lengths or not decompressed_lengths:
        raise RuntimeError('Shader exposes no compressed/decompressed program tables')
    if len(compressed_lengths) != len(decompressed_lengths):
        raise RuntimeError('Shader platform table count mismatch')

    used_synthetic_offsets = not offsets
    if not offsets:
        offsets = []
        for lengths in compressed_lengths:
            running = 0
            row: list[int] = []
            for length in lengths:
                row.append(running)
                running += length
            offsets.append(row)

    chunks: list[dict[str, Any]] = []
    for platform_index, comp_row in enumerate(compressed_lengths):
        if platform_index >= len(offsets):
            raise RuntimeError(f'missing offsets row for platform {platform_index}')
        decomp_row = decompressed_lengths[platform_index]
        offset_row = offsets[platform_index]
        if not (len(comp_row) == len(decomp_row) == len(offset_row)):
            raise RuntimeError(
                f'platform {platform_index} table mismatch: '
                f'{len(offset_row)}/{len(comp_row)}/{len(decomp_row)}'
            )
        for chunk_index, (offset, comp_len, decomp_len) in enumerate(
            zip(offset_row, comp_row, decomp_row)
        ):
            compressed = blob[offset:offset + comp_len]
            decoded, error = decompress_chunk(compressed, decomp_len)
            record: dict[str, Any] = {
                'platformIndex': platform_index,
                'platform': platforms[platform_index] if platform_index < len(platforms) else None,
                'chunkIndex': chunk_index,
                'compressedLength': comp_len,
                'decompressedLength': decomp_len,
                'compressedSha256': hashlib.sha256(compressed).hexdigest(),
                'error': error,
            }
            if decoded is not None:
                record['decoded'] = decoded
                record['decodedSha256'] = hashlib.sha256(decoded).hexdigest()
            chunks.append(record)
    return chunks, {
        'platforms': platforms,
        'blobLength': len(blob),
        'blobSha256': hashlib.sha256(blob).hexdigest(),
        'usedSyntheticOffsets': used_synthetic_offsets,
        'chunkCount': len(chunks),
        'successfulChunkCount': sum(1 for row in chunks if 'decoded' in row),
    }


def all_hits(data: bytes, tokens: tuple[bytes, ...]) -> list[tuple[int, str]]:
    lower = data.lower()
    hits: list[tuple[int, str]] = []
    for token in tokens:
        needle = token.lower()
        start = 0
        while True:
            index = lower.find(needle, start)
            if index < 0:
                break
            hits.append((index, token.decode('ascii', errors='replace')))
            start = index + max(1, len(token))
    return sorted(hits)


def render_window(data: bytes, center: int) -> dict[str, Any]:
    start = max(0, center - WINDOW_RADIUS)
    end = min(len(data), center + WINDOW_RADIUS)
    rows = ascii_strings(data[start:end])
    rendered = []
    for offset, text in rows[:MAX_LINES]:
        cleaned = text.replace('\x00', '')
        if len(cleaned) > MAX_LINE_CHARS:
            cleaned = cleaned[:MAX_LINE_CHARS] + ' …'
        rendered.append({
            'offset': start + offset,
            'text': cleaned,
        })
    joined = '\n'.join(row['text'] for row in rendered)
    return {
        'start': start,
        'end': end,
        'byteCount': end - start,
        'asciiLineCount': len(rows),
        'storedLineCount': len(rendered),
        'rows': rendered,
        'windowSha256': hashlib.sha256(data[start:end]).hexdigest(),
        'renderedSha256': hashlib.sha256(joined.encode('utf-8')).hexdigest(),
    }


def choose_windows(
    shaders: list[dict[str, Any]],
    tokens: tuple[bytes, ...],
) -> tuple[list[dict[str, Any]], int]:
    candidates: list[dict[str, Any]] = []
    occurrence_count = 0
    seen: set[str] = set()
    for shader in shaders:
        for chunk in shader['chunks']:
            decoded = chunk.get('decoded')
            if not isinstance(decoded, bytes):
                continue
            hits = all_hits(decoded, tokens)
            occurrence_count += len(hits)
            for center, center_token in hits:
                window = render_window(decoded, center)
                text = '\n'.join(row['text'] for row in window['rows'])
                lower = text.lower()
                token_hits = sorted({
                    token.decode('ascii', errors='replace')
                    for token in tokens
                    if token.decode('ascii', errors='replace').lower() in lower
                })
                score = len(token_hits) * 10
                score += sum(3 for hint in CODE_HINTS if hint.lower() in lower)
                if 'uniform ' in lower:
                    score += 1
                fingerprint = window['renderedSha256']
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                candidates.append({
                    'shaderPathId': shader['pathId'],
                    'shaderName': shader['name'],
                    'platform': chunk.get('platform'),
                    'chunkIndex': chunk.get('chunkIndex'),
                    'decodedSha256': chunk.get('decodedSha256'),
                    'centerOffset': center,
                    'centerToken': center_token,
                    'score': score,
                    'targetTokensPresent': token_hits,
                    **window,
                })
    candidates.sort(key=lambda row: (
        -int(row['score']),
        -len(row['targetTokensPresent']),
        str(row['shaderName']),
        int(row['chunkIndex']),
        int(row['centerOffset']),
    ))
    selected: list[dict[str, Any]] = []
    regions: list[tuple[str, int, int, int]] = []
    for row in candidates:
        region = (
            str(row['shaderPathId']),
            int(row['chunkIndex']),
            int(row['start']),
            int(row['end']),
        )
        overlaps = any(
            region[0] == old[0]
            and region[1] == old[1]
            and region[2] < old[3]
            and old[2] < region[3]
            for old in regions
        )
        if overlaps:
            continue
        selected.append(row)
        regions.append(region)
        if len(selected) >= MAX_WINDOWS_PER_GROUP:
            break
    return selected, occurrence_count


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-608-bg-uber-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        matches = [
            entry for entry in entries
            if entry.full_path.lower() == TARGET_BUNDLE
        ]
        if len(matches) != 1:
            raise RuntimeError(
                f'expected exactly one current-JP {TARGET_BUNDLE}, got {len(matches)}'
            )
        bundle_path = base.download(matches[0], request_headers, token, temp)
        env = UnityPy.load(str(bundle_path))

        shaders: list[dict[str, Any]] = []
        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Shader':
                continue
            shader = obj.read()
            chunks, metadata_row = reconstruct_chunks(shader)
            shaders.append({
                'pathId': str(int(getattr(obj, 'path_id', 0) or 0)),
                'name': shader_name(shader),
                'serializedFile': str(
                    getattr(getattr(obj, 'assets_file', None), 'name', '')
                ),
                'program': metadata_row,
                'chunks': chunks,
            })
        if not shaders:
            raise RuntimeError('shader/bg_uber contains no readable Shader objects')

        groups: dict[str, Any] = {}
        for group_name, tokens in GROUPS.items():
            windows, occurrences = choose_windows(shaders, tokens)
            groups[group_name] = {
                'tokens': [token.decode('ascii') for token in tokens],
                'occurrenceCount': occurrences,
                'selectedWindowCount': len(windows),
                'windows': windows,
            }

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-shader-bg_uber-bounded-program-windows',
            'metadata': metadata,
            'bundle': TARGET_BUNDLE,
            'shaderCount': len(shaders),
            'shaders': [
                {
                    'pathId': row['pathId'],
                    'name': row['name'],
                    'serializedFile': row['serializedFile'],
                    'program': row['program'],
                }
                for row in shaders
            ],
            'groups': groups,
            'privacyBoundary': (
                'Only bounded ASCII GLSL neighborhoods and cryptographic hashes are persisted. '
                'The full decoded Shader program blobs and current-JP AssetBundle bytes remain transient.'
            ),
            'interpretation': (
                'Windows are exact extracted current-JP compiled-code evidence. No Web parity is claimed '
                'until the relevant inputs, control-flow predicate and output contribution are traced end-to-end.'
            ),
        }
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'shaderCount': report['shaderCount'],
            'shaders': report['shaders'],
            'groups': {
                name: {
                    'occurrenceCount': group['occurrenceCount'],
                    'selectedWindowCount': group['selectedWindowCount'],
                    'scores': [row['score'] for row in group['windows']],
                    'tokensPerWindow': [row['targetTokensPresent'] for row in group['windows']],
                }
                for name, group in groups.items()
            },
            'output': str(OUTPUT),
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
