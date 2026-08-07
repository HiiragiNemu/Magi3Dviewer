#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import decompress_modern_redrive_shader_programs as modern
import extract_official_100101_material_properties as base
import extract_targeted_redrive_formula_windows as targeted

OUT = Path('research/official-redrive-self-shadow-exact-block.json')
TARGET_CHUNK = 6
ANCHOR = 'textureLod(hlslcc_zcmp_RdToonSelfShadowMapRT'


def normalize_text(data: bytes) -> str:
    # Unity's decoded GLSL program payload includes a small binary header and
    # occasional NUL separators. Keep printable/newline bytes and replace NULs.
    return data.decode('utf-8', 'ignore').replace('\x00', '')


def main():
    with tempfile.TemporaryDirectory(prefix='magius-rd-shadow-block-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, headers, token, metadata = base.catalog(session)
        selected = [e for e in entries if e.full_path.lower() == modern.TARGET_BUNDLE]
        selected += [e for e in entries if e.full_path.lower().startswith(('shader/','shaders/'))]
        selected = sorted({e.full_path:e for e in selected}.values(), key=lambda e:e.full_path)
        downloaded = [base.download(e, headers, token, temp) for e in selected]
        env = UnityPy.load(*(str(p) for p in downloaded))
        _, _, _, shader = modern.material_shader(env)
        chunks = targeted.reconstruct_chunks(shader)
        chunk = next(x for x in chunks if x['chunkIndex'] == TARGET_CHUNK)
        text = normalize_text(chunk['decoded'])
        lines = text.splitlines()
        anchors = [i for i, line in enumerate(lines) if ANCHOR in line]
        if not anchors:
            raise RuntimeError(f'no {ANCHOR} in chunk {TARGET_CHUNK}')
        blocks=[]
        for ordinal, i in enumerate(anchors):
            lo=max(0,i-55); hi=min(len(lines),i+70)
            block=lines[lo:hi]
            joined='\n'.join(block)
            blocks.append({
                'ordinal': ordinal,
                'anchorLineIndex': i,
                'startLineIndex': lo,
                'endLineIndex': hi,
                'containsWorldToClip': '_RdToonSelfShadowWorldToClip' in joined,
                'containsDepthBias': '_RdToonGlobalSelfShadowDepthBias' in joined,
                'containsNdotLFix': '_RdToonSelfShadowUseNdotLFix' in joined,
                'containsTxVec0': 'txVec0' in joined,
                'lines': block,
            })
        report={
            'schemaVersion':1,
            'sourceRevision':metadata.get('assetBundleRevision'),
            'unityVersion':metadata.get('unityVersion'),
            'chunkIndex':TARGET_CHUNK,
            'decodedSha256':chunk['decodedSha256'],
            'anchorCount':len(anchors),
            'blocks':blocks,
        }
        OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({
            'chunkIndex': TARGET_CHUNK,
            'anchorCount': len(anchors),
            'blocks': [
                {
                    'ordinal': b['ordinal'],
                    'anchorLineIndex': b['anchorLineIndex'],
                    'containsWorldToClip': b['containsWorldToClip'],
                    'containsDepthBias': b['containsDepthBias'],
                    'containsNdotLFix': b['containsNdotLFix'],
                    'lines': b['lines'],
                }
                for b in blocks[:4]
            ],
        },ensure_ascii=False,indent=2))

if __name__=='__main__': main()
