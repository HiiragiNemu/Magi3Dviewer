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
TARGET_CHUNK_SHA256 = '65536f9156cf560226d40a4094f1a27c448f6b2bfca1a8d6a77a8de89ee4f62a'
RADIUS = 9000

NEEDLES = (
    b'texture(_RdToonSelfShadowMapRT',
    b'textureLod(_RdToonSelfShadowMapRT',
    b'texelFetch(_RdToonSelfShadowMapRT',
    b'_RdToonSelfShadowWorldToClip *',
    b'_RdToonGlobalSelfShadowDepthBias',
    b'_RdToonSelfShadowUseNdotLFix',
    b'_ReceiveSelfShadow',
)


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
        chunk = next((x for x in chunks if x['decodedSha256'] == TARGET_CHUNK_SHA256), None)
        if chunk is None: raise RuntimeError('target current-JP shader chunk missing')
        data = chunk['decoded']
        hits = []
        for needle in NEEDLES:
            positions = list(occurrences(data, needle))
            for pos in positions:
                window = data[max(0,pos-5000):min(len(data),pos+5000)].lower()
                executable_score = (
                    window.count(b'texture(') * 20 +
                    window.count(b'void main') * 4 +
                    window.count(b'clamp(') * 2 +
                    window.count(b'dot(') * 2 +
                    window.count(b'if(')
                )
                hits.append({
                    'needle': needle.decode('ascii'),
                    'offset': pos,
                    'score': executable_score,
                })
        hits.sort(key=lambda x:(-x['score'], x['offset'], x['needle']))
        # keep unique centers; prefer actual sampler calls first
        selected_hits=[]; seen=[]
        for hit in hits:
            if any(abs(hit['offset']-p)<1200 for p in seen): continue
            selected_hits.append({**hit, **render(data, hit['offset'])})
            seen.append(hit['offset'])
            if len(selected_hits)>=8: break
        if not selected_hits: raise RuntimeError('no self-shadow executable candidates found')
        report={
            'schemaVersion':1,
            'source':'official-jp-current-ReDriveToon-compiled-GLSL',
            'metadata':metadata,
            'material':str(getattr(material,'m_Name','')),
            'shaderPathId':int(getattr(pointer,'m_PathID',0) or 0),
            'shaderSerializedFile':str(getattr(getattr(reader,'assets_file',None),'name','')),
            'chunkIndex':chunk['chunkIndex'],
            'decodedSha256':chunk['decodedSha256'],
            'allHitSummary':hits,
            'selectedExecutableWindows':selected_hits,
        }
        OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({
            'hitCount':len(hits),
            'selected':[{k:h[k] for k in ('needle','offset','score')} for h in selected_hits]
        },indent=2))

if __name__=='__main__': main()
