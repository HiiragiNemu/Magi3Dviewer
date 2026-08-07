#!/usr/bin/env python3
from __future__ import annotations

import inspect
import json
import tempfile
from pathlib import Path

import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_600_00_01_002'
OUT = Path('research/stage-600-01-02-unitypy-mesh-decoder-inspect.json')


def safe_source(obj):
    try:
        return inspect.getsource(obj)
    except Exception as exc:
        return f'<source unavailable: {exc!r}>'


def summarize(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        return {'type': type(value).__name__, 'length': len(raw), 'headHex': raw[:128].hex()}
    if isinstance(value, list):
        return {'type': 'list', 'length': len(value), 'sample': [repr(x)[:500] for x in value[:8]]}
    return {'type': type(value).__name__, 'repr': repr(value)[:1500]}


def main():
    with tempfile.TemporaryDirectory(prefix='magius-unitypy-mesh-api-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, headers, token, metadata = base.catalog(session)
        entry = next(e for e in entries if e.full_path.lower() == TARGET_BUNDLE.lower())
        bundle = base.download(entry, headers, token, temp)
        env = UnityPy.load(str(bundle))
        obj = next(
            o for o in env.objects
            if str(getattr(getattr(o, 'type', None), 'name', '')) == 'Mesh'
            and str(getattr(o.read(), 'm_Name', '')) == 'treeAABack_geo'
        )
        mesh = obj.read()
        vertex_data = getattr(mesh, 'm_VertexData', None)
        methods = []
        for name in dir(mesh):
            try:
                value = getattr(mesh, name)
            except Exception:
                continue
            if callable(value) and not name.startswith('__'):
                methods.append(name)
        vertex_methods = []
        if vertex_data is not None:
            for name in dir(vertex_data):
                try:
                    value = getattr(vertex_data, name)
                except Exception:
                    continue
                if callable(value) and not name.startswith('__'):
                    vertex_methods.append(name)
        fields = {}
        if vertex_data is not None:
            for name in dir(vertex_data):
                if name.startswith('__') or callable(getattr(vertex_data, name, None)):
                    continue
                if any(token in name.lower() for token in ('channel','stream','data','vert','current')):
                    try: fields[name] = summarize(getattr(vertex_data, name))
                    except Exception as exc: fields[name] = {'error': repr(exc)}
        report = {
            'sourceRevision': metadata.get('assetBundleRevision'),
            'unityPyVersion': getattr(UnityPy, '__version__', None),
            'meshClass': f'{mesh.__class__.__module__}.{mesh.__class__.__name__}',
            'meshMethods': methods,
            'meshClassSource': safe_source(mesh.__class__)[:30000],
            'vertexDataClass': None if vertex_data is None else f'{vertex_data.__class__.__module__}.{vertex_data.__class__.__name__}',
            'vertexDataMethods': vertex_methods,
            'vertexDataClassSource': '' if vertex_data is None else safe_source(vertex_data.__class__)[:30000],
            'vertexDataFields': fields,
            'meshObjectDirMatches': [
                name for name in dir(mesh)
                if any(token in name.lower() for token in ('process','read','unpack','vertex','index','triangle','uv'))
            ],
        }
        OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'meshClass': report['meshClass'],
            'meshMethods': methods,
            'vertexDataClass': report['vertexDataClass'],
            'vertexDataMethods': vertex_methods,
            'vertexDataFields': fields,
            'meshObjectDirMatches': report['meshObjectDirMatches'],
        }, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
