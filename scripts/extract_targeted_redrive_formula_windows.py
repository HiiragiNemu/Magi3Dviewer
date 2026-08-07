#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import decompress_modern_redrive_shader_programs as modern
import extract_official_100101_material_properties as base

WINDOW_RADIUS = 6144
MAX_WINDOWS = 3
MAX_LINES = 140
MAX_LINE_CHARS = 520

GROUPS: dict[str, tuple[bytes, ...]] = {
    'gem': (
        b'_UseGemDepthDiff', b'_GemDepthDiffThreshold', b'_GemHeightCorrection',
        b'_ISGEM', b'_IsGem', b'_GemRimFresnel',
    ),
    'self-shadow': (
        b'_RDTOON_ENABLE_SELF_SHADOW', b'RdToonSelfShadow',
        b'_RdToonSelfShadowMapRT', b'useNdotLFix', b'NdotLFix',
    ),
    'depth-rim': (
        b'_USE_DEPTHTEX_RIM_SHADOW', b'_CameraDepthTexture',
        b'DepthRim', b'DepthShadow', b'DepthTex',
    ),
    'aniso': (
        b'_IsAniso', b'_AnisoColor', b'_AnisoThreshold', b'_AnisoFeather',
        b'_AnisoMaskByMetallic', b'_Aniso',
    ),
    'fresnel': (
        b'_UseFresnel', b'_FresnelColor', b'_FresnelThreshold',
        b'_FresnelFeather', b'_FresnelMaskByMetallic', b'_Fresnel',
    ),
}

OUTPUTS = {
    name: Path(f'research/official-redrive-formula-{name}.json')
    for name in GROUPS
}

CODE_HINTS = (
    'void main', 'if(', 'if (', 'texture(', 'texelFetch(', 'dot(', 'cross(',
    'normalize(', 'inversesqrt(', 'reflect(', 'refract(', 'clamp(', 'mix(',
    'smoothstep(', 'step(', 'pow(', 'sqrt(', 'float(1.0) /', '>=', '<=', '&&',
)


def reconstruct_chunks(shader: Any) -> list[dict[str, Any]]:
    platforms = [int(value) for value in (getattr(shader, 'platforms', None) or getattr(shader, 'm_Platforms', None) or [])]
    offsets = modern.nested_lists(getattr(shader, 'offsets', None) or getattr(shader, 'm_Offsets', None))
    compressed_lengths = modern.nested_lists(getattr(shader, 'compressedLengths', None) or getattr(shader, 'm_CompressedLengths', None))
    decompressed_lengths = modern.nested_lists(getattr(shader, 'decompressedLengths', None) or getattr(shader, 'm_DecompressedLengths', None))
    blob = modern.blob_bytes(getattr(shader, 'compressedBlob', None) or getattr(shader, 'm_CompressedBlob', None))
    if not offsets:
        offsets = []
        for lengths in compressed_lengths:
            running = 0
            row = []
            for length in lengths:
                row.append(running)
                running += length
            offsets.append(row)
    chunks: list[dict[str, Any]] = []
    for platform_index, comp_row in enumerate(compressed_lengths):
        for chunk_index, (offset, comp_len, decomp_len) in enumerate(zip(
            offsets[platform_index], comp_row, decompressed_lengths[platform_index]
        )):
            decoded, algorithm, error = modern.decompress_chunk(blob[offset:offset + comp_len], decomp_len)
            if decoded is None:
                continue
            chunks.append({
                'platformIndex': platform_index,
                'platform': platforms[platform_index] if platform_index < len(platforms) else None,
                'chunkIndex': chunk_index,
                'decoded': decoded,
                'decodedSha256': hashlib.sha256(decoded).hexdigest(),
                'algorithm': algorithm,
                'error': error,
            })
    return chunks


def all_hits(data: bytes, tokens: tuple[bytes, ...]) -> list[tuple[int, str]]:
    lower = data.lower()
    result: list[tuple[int, str]] = []
    for token in tokens:
        start = 0
        needle = token.lower()
        while True:
            index = lower.find(needle, start)
            if index < 0:
                break
            result.append((index, token.decode('ascii', errors='replace')))
            start = index + max(1, len(token))
    return sorted(result)


def render_window(data: bytes, center: int) -> dict[str, Any]:
    start = max(0, center - WINDOW_RADIUS)
    stop = min(len(data), center + WINDOW_RADIUS)
    rows = modern.ascii_strings(data[start:stop], minimum=4)
    rendered = []
    for offset, text in rows[:MAX_LINES]:
        absolute = start + offset
        clean = text.replace('\x00', '')
        if len(clean) > MAX_LINE_CHARS:
            clean = clean[:MAX_LINE_CHARS] + ' …'
        rendered.append({'offset': absolute, 'text': clean})
    joined = '\n'.join(item['text'] for item in rendered)
    return {
        'start': start,
        'end': stop,
        'byteCount': stop - start,
        'asciiLineCount': len(rows),
        'storedLineCount': len(rendered),
        'rows': rendered,
        'windowSha256': hashlib.sha256(data[start:stop]).hexdigest(),
        'renderedSha256': hashlib.sha256(joined.encode('utf-8')).hexdigest(),
    }


def score_window(window: dict[str, Any], tokens: tuple[bytes, ...]) -> tuple[int, list[str]]:
    text = '\n'.join(str(item['text']) for item in window['rows'])
    lower = text.lower()
    token_hits = sorted({token.decode('ascii').lower() for token in tokens if token.decode('ascii').lower() in lower})
    score = len(token_hits) * 10
    score += sum(3 for hint in CODE_HINTS if hint.lower() in lower)
    if '#version' in lower:
        score += 2
    if 'uniform ' in lower and len(token_hits) == 1 and not any(hint.lower() in lower for hint in CODE_HINTS[:10]):
        score -= 8
    return score, token_hits


def choose_windows(chunks: list[dict[str, Any]], tokens: tuple[bytes, ...]) -> tuple[list[dict[str, Any]], int, list[int]]:
    candidates: list[dict[str, Any]] = []
    occurrence_count = 0
    hit_chunks: set[int] = set()
    seen: set[str] = set()
    for chunk in chunks:
        hits = all_hits(chunk['decoded'], tokens)
        occurrence_count += len(hits)
        if hits:
            hit_chunks.add(int(chunk['chunkIndex']))
        for center, token in hits:
            window = render_window(chunk['decoded'], center)
            score, token_hits = score_window(window, tokens)
            fingerprint = window['renderedSha256']
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            candidates.append({
                'chunkIndex': chunk['chunkIndex'],
                'platform': chunk['platform'],
                'decodedSha256': chunk['decodedSha256'],
                'centerOffset': center,
                'centerToken': token,
                'score': score,
                'targetTokensPresent': token_hits,
                **window,
            })
    candidates.sort(key=lambda item: (
        -int(item['score']),
        -len(item['targetTokensPresent']),
        int(item['chunkIndex']),
        int(item['centerOffset']),
    ))
    selected: list[dict[str, Any]] = []
    selected_regions: list[tuple[int, int, int]] = []
    for item in candidates:
        region = (int(item['chunkIndex']), int(item['start']), int(item['end']))
        overlaps = any(
            region[0] == existing[0] and region[1] < existing[2] and existing[1] < region[2]
            for existing in selected_regions
        )
        if overlaps:
            continue
        selected.append(item)
        selected_regions.append(region)
        if len(selected) >= MAX_WINDOWS:
            break
    return selected, occurrence_count, sorted(hit_chunks)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-targeted-rd-formula-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        character_entries = [entry for entry in entries if entry.full_path.lower() == modern.TARGET_BUNDLE]
        shader_entries = [entry for entry in entries if entry.full_path.lower().startswith(('shader/', 'shaders/'))]
        selected_entries = sorted(
            {entry.full_path: entry for entry in [*character_entries, *shader_entries]}.values(),
            key=lambda item: item.full_path,
        )
        downloaded = [base.download(entry, request_headers, token, temp) for entry in selected_entries]
        env = UnityPy.load(*(str(path) for path in downloaded))
        material, pointer, reader, shader = modern.material_shader(env)
        chunks = reconstruct_chunks(shader)
        if len(chunks) != 28:
            raise RuntimeError(f'Expected 28 successfully decompressed current-JP chunks, got {len(chunks)}')

        summary: dict[str, Any] = {}
        for group, tokens in GROUPS.items():
            windows, occurrence_count, hit_chunks = choose_windows(chunks, tokens)
            report = {
                'schemaVersion': 1,
                'source': 'official-jp-current-modern-ReDrive-Shader-targeted-window',
                'metadata': metadata,
                'material': str(getattr(material, 'm_Name', '')),
                'shaderPathId': int(getattr(pointer, 'm_PathID', 0) or 0),
                'shaderSerializedFile': str(getattr(getattr(reader, 'assets_file', None), 'name', '')),
                'group': group,
                'tokens': [token.decode('ascii') for token in tokens],
                'decompressedChunkCount': len(chunks),
                'occurrenceCount': occurrence_count,
                'hitChunks': hit_chunks,
                'windowRadiusBytes': WINDOW_RADIUS,
                'selectedWindowCount': len(windows),
                'windows': windows,
                'interpretation': (
                    'These are bounded current-JP compiled GLSL neighborhoods selected for dataflow reconstruction. '
                    'They are exact extracted code evidence, but a Web implementation remains deferred until the relevant '
                    'inputs, branch predicates and output contribution can be traced through a complete chain.'
                ),
            }
            OUTPUTS[group].write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            summary[group] = {
                'occurrenceCount': occurrence_count,
                'hitChunks': hit_chunks,
                'selectedWindowCount': len(windows),
                'scores': [item['score'] for item in windows],
                'tokensPerWindow': [item['targetTokensPresent'] for item in windows],
            }

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
