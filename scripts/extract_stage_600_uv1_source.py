#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_600_00_01_002'
OUT = Path(os.environ.get(
    'STAGE600_UV1_SOURCE_OUT',
    'research/stage-600-01-02-unity-meshhandler-uv1-source.json',
))


def flatten_vec2(values):
    result = []
    for value in values or []:
        result.extend((float(value[0]), float(value[1])))
    return result


def flatten_triangles(groups):
    result = []
    group_corner_counts = []
    for group in groups:
        before = len(result)
        for triangle in group:
            if len(triangle) != 3:
                raise RuntimeError(f'Unexpected triangle arity: {triangle!r}')
            result.extend(int(index) for index in triangle)
        group_corner_counts.append(len(result) - before)
    return result, group_corner_counts


def main():
    with tempfile.TemporaryDirectory(prefix='magius-600-uv1-source-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, headers, token, metadata = base.catalog(session)
        selected = [e for e in entries if e.full_path.lower() == TARGET_BUNDLE.lower()]
        if len(selected) != 1:
            raise RuntimeError(f'Expected one {TARGET_BUNDLE!r} catalog entry, got {len(selected)}')

        bundle = base.download(selected[0], headers, token, temp)
        env = UnityPy.load(str(bundle))
        meshes = []
        failures = []

        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Mesh':
                continue
            mesh = obj.read()
            name = str(getattr(mesh, 'm_Name', ''))
            path_id = str(int(getattr(obj, 'path_id', 0) or 0))
            try:
                handler = MeshHandler(mesh)
                handler.process()
                uv0 = handler.m_UV0 or []
                uv1 = handler.m_UV1 or []
                if not uv0 or not uv1:
                    raise RuntimeError(
                        f'decoded uv0={len(uv0)} uv1={len(uv1)}'
                    )
                if len(uv0) != len(uv1):
                    raise RuntimeError(
                        f'UV channel length mismatch uv0={len(uv0)} uv1={len(uv1)}'
                    )
                triangles, group_corner_counts = flatten_triangles(handler.get_triangles())
                if not triangles:
                    raise RuntimeError('decoded mesh has no triangle corners')
                if max(triangles) >= len(uv1):
                    raise RuntimeError(
                        f'triangle index exceeds decoded UV1 count: '
                        f'max={max(triangles)} uv1={len(uv1)}'
                    )
                meshes.append({
                    'pathId': path_id,
                    'name': name,
                    'sourceVertexCount': int(handler.m_VertexCount),
                    'uv0': flatten_vec2(uv0),
                    'uv1': flatten_vec2(uv1),
                    'triangleIndices': triangles,
                    'submeshCornerCounts': group_corner_counts,
                })
            except Exception as exc:
                failures.append({
                    'pathId': path_id,
                    'name': name,
                    'error': repr(exc),
                })

        report = {
            'schemaVersion': 1,
            'sourceRevision': metadata.get('assetBundleRevision'),
            'unityVersion': metadata.get('unityVersion') or '2022.3.62f2',
            'sourceBundle': TARGET_BUNDLE,
            'meshCount': len(meshes),
            'failureCount': len(failures),
            'failures': failures,
            'meshes': meshes,
        }
        if report['meshCount'] == 0 or failures:
            raise RuntimeError(
                f'UV1 source decode was not complete: '
                f'meshes={report["meshCount"]} failures={len(failures)} '
                f'sample={failures[:5]}'
            )

        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(
            json.dumps(report, ensure_ascii=False, separators=(',', ':')) + '\n',
            encoding='utf-8',
        )
        print(json.dumps({
            'output': str(OUT),
            'meshCount': report['meshCount'],
            'failureCount': report['failureCount'],
            'totalSourceVertices': sum(x['sourceVertexCount'] for x in meshes),
            'totalTriangleCorners': sum(len(x['triangleIndices']) for x in meshes),
            'sample': [
                {
                    'name': x['name'],
                    'pathId': x['pathId'],
                    'sourceVertexCount': x['sourceVertexCount'],
                    'triangleCornerCount': len(x['triangleIndices']),
                    'uv1Sample': x['uv1'][:8],
                }
                for x in meshes[:12]
            ],
        }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
