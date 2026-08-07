#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import decompress_modern_redrive_shader_programs as modern
import extract_official_100101_material_properties as base
import extract_targeted_redrive_formula_windows as targeted

OUTPUT = Path('research/official-redrive-exact-formula-slices.json')
TARGET_CHUNK_SHA256 = '65536f9156cf560226d40a4094f1a27c448f6b2bfca1a8d6a77a8de89ee4f62a'
SEARCH_RADIUS = 5000
SLICE_RADIUS = 2600
MAX_LINE_CHARS = 700

FAMILIES: dict[str, dict[str, Any]] = {
    'aniso': {
        'anchor': b'_IsAniso',
        'tokens': (
            b'_IsAniso', b'_AnisoColor', b'_AnisoThreshold', b'_AnisoFeather',
            b'_AnisoMaskByMetallic', b'unity_MatrixV', b'inversesqrt(', b'dot(',
        ),
    },
    'fresnel': {
        'anchor': b'_UseFresnel',
        'tokens': (
            b'_UseFresnel', b'_FresnelColor', b'_FresnelThreshold', b'_FresnelFeather',
            b'_FresnelMaskByMetallic', b'clamp(', b' * -2.0 + 3.0', b'dot(',
        ),
    },
    'selfShadow': {
        'anchor': b'_RdToonSelfShadowMapRT',
        'tokens': (
            b'_RDTOON_ENABLE_SELF_SHADOW', b'_RdToonSelfShadowMapRT', b'RdToonSelfShadow',
            b'useNdotLFix', b'NdotLFix', b'texture(', b'texelFetch(', b'clamp(',
        ),
    },
    'depthRim': {
        'anchor': b'_USE_DEPTHTEX_RIM_SHADOW',
        'tokens': (
            b'_USE_DEPTHTEX_RIM_SHADOW', b'_CameraDepthTexture', b'DepthRim',
            b'DepthShadow', b'texture(', b'clamp(',
        ),
    },
}


def occurrences(data: bytes, needle: bytes) -> list[int]:
    result: list[int] = []
    lower = data.lower()
    target = needle.lower()
    start = 0
    while True:
        index = lower.find(target, start)
        if index < 0:
            break
        result.append(index)
        start = index + max(1, len(target))
    return result


def score_region(data: bytes, center: int, tokens: tuple[bytes, ...]) -> tuple[int, list[str]]:
    lo = max(0, center - SEARCH_RADIUS)
    hi = min(len(data), center + SEARCH_RADIUS)
    region = data[lo:hi].lower()
    present = [token.decode('ascii', errors='replace') for token in tokens if token.lower() in region]
    score = len(present) * 100
    score += region.count(b'void main') * 10
    score += region.count(b'texture(') * 3
    score += region.count(b'clamp(') * 2
    score += region.count(b'dot(') * 2
    score += region.count(b'inversesqrt(') * 2
    return score, present


def render_slice(data: bytes, center: int) -> dict[str, Any]:
    lo = max(0, center - SLICE_RADIUS)
    hi = min(len(data), center + SLICE_RADIUS)
    rows = []
    for offset, text in modern.ascii_strings(data[lo:hi], minimum=4):
        clean = text.replace('\x00', '')
        if len(clean) > MAX_LINE_CHARS:
            clean = clean[:MAX_LINE_CHARS] + ' …'
        rows.append({'offset': lo + int(offset), 'text': clean})
    return {
        'start': lo,
        'end': hi,
        'byteCount': hi - lo,
        'lineCount': len(rows),
        'rows': rows,
        'sliceSha256': hashlib.sha256(data[lo:hi]).hexdigest(),
    }


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='magius-exact-rd-slices-') as temporary:
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
        chunks = targeted.reconstruct_chunks(shader)
        chunk = next((item for item in chunks if item['decodedSha256'] == TARGET_CHUNK_SHA256), None)
        if chunk is None:
            raise RuntimeError(f'expected current-JP compiled chunk {TARGET_CHUNK_SHA256} not found')
        data: bytes = chunk['decoded']

        slices: dict[str, Any] = {}
        for family, spec in FAMILIES.items():
            anchor = spec['anchor']
            tokens = spec['tokens']
            candidates = []
            for center in occurrences(data, anchor):
                score, present = score_region(data, center, tokens)
                candidates.append((score, len(present), center, present))
            if not candidates:
                raise RuntimeError(f'{family}: anchor {anchor!r} absent from target chunk')
            candidates.sort(key=lambda item: (-item[0], -item[1], item[2]))
            score, _, center, present = candidates[0]
            slices[family] = {
                'anchor': anchor.decode('ascii'),
                'anchorOffset': center,
                'score': score,
                'tokensPresent': present,
                **render_slice(data, center),
            }

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-modern-ReDrive-Shader-executable-formula-slices',
            'metadata': metadata,
            'material': str(getattr(material, 'm_Name', '')),
            'shaderPathId': int(getattr(pointer, 'm_PathID', 0) or 0),
            'shaderSerializedFile': str(getattr(getattr(reader, 'assets_file', None), 'name', '')),
            'chunkIndex': chunk['chunkIndex'],
            'platform': chunk['platform'],
            'decodedSha256': chunk['decodedSha256'],
            'decodedLength': len(data),
            'slices': slices,
            'interpretation': (
                'Each slice is a bounded exact current-JP compiled GLSL neighborhood selected from the fixed '
                'current program chunk. It is executable-code evidence, not a semantic approximation. Web parity '
                'is claimed only for formulas whose complete input/predicate/output dataflow is reconstructed from it.'
            ),
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            name: {
                'anchorOffset': row['anchorOffset'],
                'score': row['score'],
                'lineCount': row['lineCount'],
                'tokensPresent': row['tokensPresent'],
            }
            for name, row in slices.items()
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
