#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_600_00_01_002'
OUT = Path('research/stage-600-01-02-unity-mesh-uv1-inspect.json')


def vec2(value):
    if hasattr(value, 'x') and hasattr(value, 'y'):
        return [float(value.x), float(value.y)]
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return [float(value[0]), float(value[1])]
    if isinstance(value, dict):
        if 'x' in value and 'y' in value:
            return [float(value['x']), float(value['y'])]
    return None


def main():
    with tempfile.TemporaryDirectory(prefix='magius-600-uv1-inspect-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, headers, token, metadata = base.catalog(session)
        selected = [e for e in entries if e.full_path.lower() == TARGET_BUNDLE.lower()]
        bundle = base.download(selected[0], headers, token, temp)
        env = UnityPy.load(str(bundle))
        meshes=[]
        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Mesh':
                continue
            data = obj.read()
            attrs = sorted(a for a in dir(data) if 'uv' in a.lower() or 'vert' in a.lower())
            name = str(getattr(data, 'm_Name', ''))
            uv1 = getattr(data, 'm_UV1', None)
            uv0 = getattr(data, 'm_UV0', None)
            vertices = getattr(data, 'm_Vertices', None)
            # Some UnityPy versions populate vertex arrays lazily.
            if hasattr(data, 'read_vertex_data'):
                try:
                    data.read_vertex_data()
                except Exception:
                    pass
                uv1 = getattr(data, 'm_UV1', uv1)
                uv0 = getattr(data, 'm_UV0', uv0)
                vertices = getattr(data, 'm_Vertices', vertices)
            def length(value):
                try: return len(value)
                except Exception: return None
            sample=[]
            if uv1 is not None:
                try:
                    for value in list(uv1)[:8]:
                        parsed=vec2(value)
                        if parsed is not None: sample.append(parsed)
                except Exception:
                    pass
            meshes.append({
                'name':name,
                'pathId':int(getattr(obj,'path_id',0) or 0),
                'attributes':attrs,
                'vertexCount':length(vertices),
                'uv0Count':length(uv0),
                'uv1Count':length(uv1),
                'uv1Sample':sample,
            })
        report={
            'sourceRevision':metadata.get('assetBundleRevision'),
            'unityVersion':metadata.get('unityVersion'),
            'meshCount':len(meshes),
            'meshesWithReadableUv1':sum((x.get('uv1Count') or 0)>0 for x in meshes),
            'meshes':meshes,
        }
        OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({
            'meshCount':report['meshCount'],
            'meshesWithReadableUv1':report['meshesWithReadableUv1'],
            'sample':meshes[:30],
        },ensure_ascii=False,indent=2))

if __name__=='__main__': main()
