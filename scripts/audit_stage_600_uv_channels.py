#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
import re
import tempfile
from pathlib import Path

import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_600_00_01_002'
FBX = Path('public/stages/official/battle-600-00-01-002/bg_3d_600_00_01_002-animated.fbxdata')
OUT = Path('research/stage-600-01-02-uv-channel-audit.json')


def channel_dimension(channel):
    if not isinstance(channel, dict): return 0
    try: return int(channel.get('dimension', 0) or 0)
    except Exception: return 0


def main():
    with tempfile.TemporaryDirectory(prefix='magius-600-uv-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, headers, token, metadata = base.catalog(session)
        selected = [e for e in entries if e.full_path.lower() == TARGET_BUNDLE.lower()]
        if len(selected) != 1:
            raise RuntimeError(f'expected one {TARGET_BUNDLE}, got {len(selected)}')
        bundle = base.download(selected[0], headers, token, temp)
        env = UnityPy.load(str(bundle))
        meshes = []
        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Mesh':
                continue
            try: tree = obj.read_typetree()
            except Exception as exc:
                meshes.append({'pathId': int(obj.path_id), 'error': repr(exc)})
                continue
            name = str(tree.get('m_Name', '')) if isinstance(tree, dict) else ''
            vertex_data = tree.get('m_VertexData', {}) if isinstance(tree, dict) else {}
            channels = vertex_data.get('m_Channels', []) if isinstance(vertex_data, dict) else []
            dims = [channel_dimension(x) for x in channels]
            meshes.append({
                'name': name,
                'pathId': int(getattr(obj, 'path_id', 0) or 0),
                'vertexCount': vertex_data.get('m_VertexCount') if isinstance(vertex_data, dict) else None,
                'channelDimensions': dims,
                'hasUv0': len(dims) > 4 and dims[4] > 0,
                'hasUv1': len(dims) > 5 and dims[5] > 0,
                'hasUv2': len(dims) > 6 and dims[6] > 0,
                'hasUv3': len(dims) > 7 and dims[7] > 0,
            })

    raw = FBX.read_bytes()
    if raw[:2] == b'\x1f\x8b': raw = gzip.decompress(raw)
    ascii_runs = [x.decode('utf-8', 'ignore') for x in re.findall(rb'[ -~]{3,180}', raw)]
    uv_strings = sorted({
        x for x in ascii_runs
        if any(token in x.lower() for token in ('layerelementuv','uvchannel','uvset','map1','lightmap'))
    })
    report = {
        'sourceRevision': metadata.get('assetBundleRevision'),
        'unityVersion': metadata.get('unityVersion'),
        'bundle': TARGET_BUNDLE,
        'meshCount': len(meshes),
        'meshUvSummary': {
            'uv0': sum(bool(x.get('hasUv0')) for x in meshes),
            'uv1': sum(bool(x.get('hasUv1')) for x in meshes),
            'uv2': sum(bool(x.get('hasUv2')) for x in meshes),
            'uv3': sum(bool(x.get('hasUv3')) for x in meshes),
        },
        'meshes': meshes,
        'fbxDecodedBytes': len(raw),
        'fbxRawTokenCounts': {
            'LayerElementUV': raw.count(b'LayerElementUV'),
            'UVChannel_1': raw.count(b'UVChannel_1'),
            'UVChannel_2': raw.count(b'UVChannel_2'),
            'UVSet': raw.count(b'UVSet'),
            'Lightmap': raw.lower().count(b'lightmap'),
        },
        'fbxUvStrings': uv_strings[:300],
        'interpretation': (
            'Unity Mesh channel index 4 is UV0 and index 5 is UV1/lightmap UV. '
            'The FBX token scan is structural evidence only; if original meshes expose UV1 while '
            'the exported FBX contains no second UV-set token, the existing Web lightmap controller '
            'cannot reproduce the baked mapping without repairing the export.'
        ),
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({
        'meshCount': report['meshCount'],
        'meshUvSummary': report['meshUvSummary'],
        'fbxRawTokenCounts': report['fbxRawTokenCounts'],
        'fbxUvStrings': report['fbxUvStrings'][:80],
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
