#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import decompress_modern_redrive_shader_programs as modern
import extract_official_100101_material_properties as base
import extract_targeted_redrive_formula_windows as targeted

OUT = Path('research/official-redrive-self-shadow-receiver-trace.json')
RADIUS = 7000
SAMPLER = b'_RdToonSelfShadowMapRT'


def occurrences(data: bytes, needle: bytes):
    lower = data.lower(); target = needle.lower(); pos = 0
    while True:
        pos = lower.find(target, pos)
        if pos < 0: break
        yield pos
        pos += max(1, len(target))


def render(data: bytes, center: int):
    lo = max(0, center - RADIUS); hi = min(len(data), center + RADIUS)
    rows = []
    for off, text in modern.ascii_strings(data[lo:hi], minimum=3):
        clean = text.replace('\x00', '')
        if len(clean) > 900: clean = clean[:900] + ' …'
        rows.append({'offset': lo + int(off), 'text': clean})
    return {
        'start': lo, 'end': hi, 'byteCount': hi-lo,
        'sha256': hashlib.sha256(data[lo:hi]).hexdigest(),
        'rows': rows,
    }


def main():
    with tempfile.TemporaryDirectory(prefix='magius-rd-self-shadow-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, headers, token, metadata = base.catalog(session)
        selected = [e for e in entries if e.full_path.lower() == modern.TARGET_BUNDLE]
        selected += [e for e in entries if e.full_path.lower().startswith(('shader/','shaders/'))]
        selected = sorted({e.full_path:e for e in selected}.values(), key=lambda e:e.full_path)
        downloaded = [base.download(e, headers, token, temp) for e in selected]
        env = UnityPy.load(*(str(p) for p in downloaded))
        material, pointer, reader, shader = modern.material_shader(env)
        chunks = targeted.reconstruct_chunks(shader)

        hits = []
        for chunk in chunks:
            data = chunk['decoded']
            for pos in occurrences(data, SAMPLER):
                near = data[max(0,pos-2200):min(len(data),pos+2200)]
                lower = near.lower()
                # Uniform declarations contain the name but no executable texture call.
                # Combined-sampler GLSL can spell the call as texture(sampler2D(texture,sampler),uv),
                # so score proximity instead of assuming one literal syntax.
                texture_calls = lower.count(b'texture(') + lower.count(b'texturelod(') + lower.count(b'texelfetch(')
                executable_score = (
                    texture_calls * 100 +
                    lower.count(b'clamp(') * 5 +
                    lower.count(b'dot(') * 4 +
                    lower.count(b'if(') * 3 +
                    lower.count(b'_rdtoonselfshadowworldtoclip') * 8 +
                    lower.count(b'_rdtoonglobalselfshadowdepthbias') * 8 +
                    lower.count(b'_rdtoonselfshadowusendotlfix') * 8 +
                    lower.count(b'_receiveselfshadow') * 8
                )
                hits.append({
                    'chunkIndex': chunk['chunkIndex'],
                    'platform': chunk['platform'],
                    'decodedSha256': chunk['decodedSha256'],
                    'offset': pos,
                    'textureCallsNear': texture_calls,
                    'score': executable_score,
                })
        hits.sort(key=lambda x:(-x['textureCallsNear'], -x['score'], x['chunkIndex'], x['offset']))

        selected_hits=[]; seen=set()
        for hit in hits:
            # collapse duplicate variants by the local executable bytes
            chunk = next(x for x in chunks if x['chunkIndex'] == hit['chunkIndex'])
            data = chunk['decoded']
            lo=max(0,hit['offset']-1600); hi=min(len(data),hit['offset']+1600)
            local_sha=hashlib.sha256(data[lo:hi]).hexdigest()
            if local_sha in seen: continue
            seen.add(local_sha)
            selected_hits.append({**hit, 'localSha256': local_sha, **render(data, hit['offset'])})
            if len(selected_hits)>=12: break
        if not selected_hits: raise RuntimeError('no self-shadow sampler occurrences found')
        report={
            'schemaVersion':2,
            'source':'official-jp-current-ReDriveToon-compiled-GLSL-all-variants',
            'metadata':metadata,
            'material':str(getattr(material,'m_Name','')),
            'shaderPathId':int(getattr(pointer,'m_PathID',0) or 0),
            'shaderSerializedFile':str(getattr(getattr(reader,'assets_file',None),'name','')),
            'chunkCount':len(chunks),
            'allSamplerHitSummary':hits,
            'selectedExecutableWindows':selected_hits,
        }
        OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({
            'chunkCount':len(chunks), 'hitCount':len(hits),
            'samplerHitsWithTextureCalls':sum(h['textureCallsNear']>0 for h in hits),
            'selected':[
                {k:h[k] for k in ('chunkIndex','decodedSha256','offset','textureCallsNear','score')}
                for h in selected_hits
            ]
        },indent=2))

if __name__=='__main__': main()
