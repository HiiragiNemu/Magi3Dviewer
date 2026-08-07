#!/usr/bin/env python3
from __future__ import annotations
import gzip
import json
import re
from pathlib import Path

FBX = Path('public/stages/official/battle-600-00-01-002/bg_3d_600_00_01_002-animated.fbxdata')
OUT = Path('research/stage-600-01-02-fbx-material-name-audit.json')


def main():
    raw = FBX.read_bytes()
    compressed = raw[:2] == b'\x1f\x8b'
    if compressed:
        raw = gzip.decompress(raw)
    # Binary FBX keeps object/property names as readable UTF-8/ASCII byte runs.
    ascii_runs = {
        x.decode('utf-8', 'ignore')
        for x in re.findall(rb'[ -~]{5,160}', raw)
    }
    candidates = sorted({
        text for text in ascii_runs
        if 'bg3d600' in text.lower() and (
            'mt_' in text.lower() or 'material' in text.lower() or
            any(token in text.lower() for token in (
                'adelbert','anthony','ground','propa','propb','propc','rock','sky','stone','tree'
            ))
        )
    })
    report = {
        'file': str(FBX),
        'gzipCompressed': compressed,
        'decodedBytes': len(raw),
        'candidateCount': len(candidates),
        'candidates': candidates,
        'containsCurrentJpNames': {
            name: any(name.lower() in text.lower() for text in ascii_runs)
            for name in (
                'mt_bg3d600A_01_02_adelbertAAlpha',
                'mt_bg3d600A_01_02_adelbertBAlpha',
                'mt_bg3d600A_01_02_anthonyAAlpha',
                'mt_bg3d600A_01_02_anthonyBAlpha',
                'mt_bg3d600A_01_02_ground',
                'mt_bg3d600A_01_02_propA',
                'mt_bg3d600A_01_02_propBAlpha',
                'mt_bg3d600A_01_02_propC',
                'mt_bg3d600A_01_02_rockAlpha',
                'mt_bg3d600A_01_02_sky',
                'SkyBox_bg3d600A_01_02',
            )
        },
        'containsLegacyCatalogNames': {
            name: any(name.lower() in text.lower() for text in ascii_runs)
            for name in (
                'mt_bg3d600a_01_02_9_4_1',
                'mt_bg3d600a_01_02_Ground',
                'mt_bg3d600a_01_02_object',
                'mt_bg3d600a_01_02_sky',
                'mt_bg3d600a_01_02_Stone',
                'mt_bg3d600a_01_02_tree_01',
                'mt_bg3d600a_01_02_tree_02',
            )
        },
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
