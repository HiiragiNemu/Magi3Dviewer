#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

SRC = Path('research/official-redrive-self-shadow-receiver-trace.json')
OUT = Path('research/official-redrive-self-shadow-receiver-compact.json')
TOKENS = (
    '_RdToonSelfShadowMapRT',
    'texture(', 'textureLod(', 'texelFetch(',
    '_RdToonSelfShadowWorldToClip',
    '_RdToonGlobalSelfShadowDepthBias',
    '_RdToonSelfShadowUseNdotLFix',
    '_ReceiveSelfShadow',
    'NdotLFix',
)


def compact_window(window):
    rows = window.get('rows', [])
    interesting = []
    hit_indices = [
        i for i, row in enumerate(rows)
        if any(token.lower() in str(row.get('text', '')).lower() for token in TOKENS)
    ]
    keep = set()
    for i in hit_indices:
        for j in range(max(0, i - 18), min(len(rows), i + 19)):
            keep.add(j)
    for i in sorted(keep):
        interesting.append(rows[i])
    return {
        key: window.get(key)
        for key in ('chunkIndex','decodedSha256','offset','textureCallsNear','score','localSha256')
    } | {
        'interestingRowCount': len(interesting),
        'rows': interesting,
    }


def main():
    data = json.loads(SRC.read_text(encoding='utf-8'))
    windows = [w for w in data.get('selectedExecutableWindows', []) if w.get('textureCallsNear', 0) > 0]
    compact = [compact_window(w) for w in windows[:8]]
    report = {
        'schemaVersion': 1,
        'sourceRevision': data.get('metadata', {}).get('assetBundleRevision'),
        'unityVersion': data.get('metadata', {}).get('unityVersion'),
        'samplerHitCount': len(data.get('allSamplerHitSummary', [])),
        'selectedWindowCount': len(compact),
        'windows': compact,
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'samplerHitCount': report['samplerHitCount'],
        'selectedWindowCount': len(compact),
        'windows': [
            {
                'chunkIndex': w['chunkIndex'],
                'offset': w['offset'],
                'textureCallsNear': w['textureCallsNear'],
                'interestingRowCount': w['interestingRowCount'],
                'rows': [row['text'] for row in w['rows'] if any(
                    token.lower() in row['text'].lower() for token in TOKENS
                )][:40],
            }
            for w in compact
        ],
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
