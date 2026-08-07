#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

INPUT = Path('research/official-redrive-modern-shader-programs.json')
OUTPUT = Path('research/official-redrive-modern-shader-formula-evidence.json')

GROUPS: dict[str, tuple[str, ...]] = {
    'gem': (
        '_ISGEM', '_IsGem', '_UseGemDepthDiff', 'GemDepthDiff',
        '_GemDepthDiffThreshold', 'GemHeightCorrection', '_GemHeightCorrection',
        '_Gem1stHighlightSize', '_Gem2ndHighlightSize',
        '_Gem1stShadSize', '_Gem2ndShadSize', '_GemRimFresnel',
    ),
    'selfShadow': (
        '_RDTOON_ENABLE_SELF_SHADOW', 'RdToonSelfShadow',
        '_RdToonSelfShadowMapRT', 'NdotLFix', 'useNdotLFix',
    ),
    'depthTexRimShadow': (
        '_USE_DEPTHTEX_RIM_SHADOW', 'DepthRim', 'DepthShadow',
        'DepthTex', '_CameraDepthTexture',
    ),
    'anisotropy': (
        '_IsAniso', '_Aniso', '_AnisoColor', '_AnisoThreshold',
        '_AnisoFeather', '_AnisoMaskByMetallic',
    ),
    'fresnel': (
        '_UseFresnel', '_Fresnel', '_FresnelColor',
        '_FresnelThreshold', '_FresnelFeather', '_FresnelMaskByMetallic',
    ),
    'matcap': (
        '_UseMatCap', '_MatCapTex', '_MatCapIntensity', 'MatCap',
        '_MaskMatcapSpecular', '_MaskMatcapMetallic',
    ),
}

MAX_SNIPPETS_PER_GROUP = 10
MAX_ASCII_ROWS_PER_SNIPPET = 16
MAX_ROW_CHARS = 360
MAX_SNIPPET_CHARS = 2600

OPERATION_HINTS = (
    '=', 'texture(', 'texelFetch(', 'dot(', 'cross(', 'normalize(', 'reflect(',
    'refract(', 'mix(', 'clamp(', 'smoothstep(', 'step(', 'pow(', 'sqrt(',
    'min(', 'max(', 'abs(', 'sign(', 'if(', 'if (', '?', '*', '/', '+', '-',
)
DECLARATION_HINTS = ('uniform ', 'layout(', '#define ', '#ifdef ', '#if ', '#endif')


def normalized(value: str) -> str:
    value = re.sub(r'\s+', ' ', value).strip()
    return value


def target_hits(text: str, tokens: tuple[str, ...]) -> list[str]:
    lower = text.lower()
    return sorted({token for token in tokens if token.lower() in lower})


def operation_score(text: str) -> int:
    lower = text.lower()
    score = sum(2 for hint in OPERATION_HINTS if hint.lower() in lower)
    if any(hint.lower() in lower for hint in DECLARATION_HINTS):
        score -= 2
    if 'void main' in lower:
        score += 4
    if '{' in text or '}' in text:
        score += 2
    if re.search(r'\b(vec[234]|mat[234]|float|half|bool|int)\b', text):
        score += 1
    return score


def compact_rows(rows: list[dict[str, Any]], center: int) -> tuple[str, int, int]:
    half = MAX_ASCII_ROWS_PER_SNIPPET // 2
    start = max(0, center - half)
    stop = min(len(rows), start + MAX_ASCII_ROWS_PER_SNIPPET)
    start = max(0, stop - MAX_ASCII_ROWS_PER_SNIPPET)
    selected = rows[start:stop]
    rendered: list[str] = []
    for row in selected:
        text = str(row.get('text', '')).replace('\x00', '')
        if len(text) > MAX_ROW_CHARS:
            text = text[:MAX_ROW_CHARS] + ' …'
        rendered.append(f"@{int(row.get('offset', 0))}: {text}")
    snippet = '\n'.join(rendered)
    if len(snippet) > MAX_SNIPPET_CHARS:
        snippet = snippet[:MAX_SNIPPET_CHARS] + '\n… [bounded]'
    return snippet, start, stop


def main() -> int:
    report = json.loads(INPUT.read_text(encoding='utf-8'))
    output: dict[str, Any] = {
        'schemaVersion': 1,
        'source': str(INPUT),
        'sourceBlobSha256': report.get('blobSha256'),
        'sourceChunkCount': report.get('chunkCount'),
        'sourceSuccessfulChunkCount': report.get('successfulChunkCount'),
        'method': (
            'Bounded extraction from the already decompressed current-JP ReDrive program report. '
            'Each candidate keeps nearby printable GLSL rows only; repeated variants are deduplicated. '
            'A candidate is evidence, not proof that the whole Web formula is exact until its dataflow is matched.'
        ),
        'groups': {},
    }

    for group_name, tokens in GROUPS.items():
        candidates: list[dict[str, Any]] = []
        occurrence_count = 0
        hit_chunks: set[int] = set()
        seen: set[str] = set()

        for chunk in report.get('chunks', []):
            chunk_index = int(chunk.get('chunkIndex', -1))
            decoded_sha = chunk.get('decodedSha256')
            platform = chunk.get('platform')
            for context_index, context in enumerate(chunk.get('contexts') or []):
                rows = list(context.get('ascii') or [])
                for row_index, row in enumerate(rows):
                    text = str(row.get('text', ''))
                    hits = target_hits(text, tokens)
                    if not hits:
                        continue
                    occurrence_count += len(hits)
                    hit_chunks.add(chunk_index)
                    snippet, row_start, row_stop = compact_rows(rows, row_index)
                    fingerprint_text = normalized(snippet)
                    fingerprint = hashlib.sha256(fingerprint_text.encode('utf-8')).hexdigest()
                    if fingerprint in seen:
                        continue
                    seen.add(fingerprint)
                    score = operation_score(snippet)
                    code_like = score > 0 and not all(
                        normalized(line.split(': ', 1)[-1]).startswith(DECLARATION_HINTS)
                        for line in snippet.splitlines() if ': ' in line
                    )
                    candidates.append({
                        'chunkIndex': chunk_index,
                        'platform': platform,
                        'decodedSha256': decoded_sha,
                        'contextIndex': context_index,
                        'rowIndex': row_index,
                        'rowWindow': [row_start, row_stop],
                        'targetHits': hits,
                        'sourceContextTokens': sorted(set(context.get('tokens') or [])),
                        'score': score,
                        'codeLike': code_like,
                        'snippetSha256': fingerprint,
                        'snippet': snippet,
                    })

        candidates.sort(key=lambda item: (
            0 if item['codeLike'] else 1,
            -int(item['score']),
            -len(item['targetHits']),
            int(item['chunkIndex']),
            int(item['contextIndex']),
        ))
        selected = candidates[:MAX_SNIPPETS_PER_GROUP]
        output['groups'][group_name] = {
            'tokens': list(tokens),
            'occurrenceCount': occurrence_count,
            'hitChunks': sorted(hit_chunks),
            'uniqueCandidateCount': len(candidates),
            'selectedCount': len(selected),
            'selectedCandidates': selected,
        }

    encoded = json.dumps(output, ensure_ascii=False, indent=2) + '\n'
    OUTPUT.write_text(encoded, encoding='utf-8')
    print(json.dumps({
        'output': str(OUTPUT),
        'bytes': len(encoded.encode('utf-8')),
        'sourceBlobSha256': output['sourceBlobSha256'],
        'groups': {
            name: {
                'occurrenceCount': value['occurrenceCount'],
                'hitChunks': value['hitChunks'],
                'uniqueCandidateCount': value['uniqueCandidateCount'],
                'selectedCount': value['selectedCount'],
            }
            for name, value in output['groups'].items()
        },
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
