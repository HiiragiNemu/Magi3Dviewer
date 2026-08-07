#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_600_00_01_002'
OUT = Path(os.environ.get(
    'STAGE600_MESHFILTER_HIERARCHY_OUT',
    '/tmp/stage600-meshfilter-hierarchy.json',
))


def ptr_path_id(ptr):
    if ptr is None:
        return None
    for name in ('path_id', 'm_PathID', 'pathID'):
        value = getattr(ptr, name, None)
        if value is not None:
            return int(value)
    obj = getattr(ptr, 'object_reader', None)
    value = getattr(obj, 'path_id', None)
    return int(value) if value is not None else None


def ptr_read(ptr):
    if ptr is None:
        return None
    try:
        return ptr.read()
    except Exception:
        return None


def object_path_id(obj):
    reader = getattr(obj, 'object_reader', None)
    value = getattr(reader, 'path_id', None)
    return int(value) if value is not None else None


def main():
    with tempfile.TemporaryDirectory(prefix='magius-600-meshfilter-hierarchy-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, headers, token, metadata = base.catalog(session)
        selected = [e for e in entries if e.full_path.lower() == TARGET_BUNDLE.lower()]
        if len(selected) != 1:
            raise RuntimeError(f'Expected one target bundle, got {len(selected)}')
        bundle = base.download(selected[0], headers, token, temp)
        env = UnityPy.load(str(bundle))

        game_objects = {}
        transforms = {}
        mesh_filters = []
        renderers = []

        for reader in env.objects:
            type_name = str(getattr(getattr(reader, 'type', None), 'name', ''))
            if type_name not in {'GameObject', 'Transform', 'MeshFilter', 'MeshRenderer'}:
                continue
            obj = reader.read()
            path_id = int(getattr(reader, 'path_id', 0) or 0)
            if type_name == 'GameObject':
                game_objects[path_id] = {
                    'name': str(getattr(obj, 'm_Name', '')),
                    'pathId': path_id,
                }
            elif type_name == 'Transform':
                go_id = ptr_path_id(getattr(obj, 'm_GameObject', None))
                father = ptr_path_id(getattr(obj, 'm_Father', None))
                transforms[path_id] = {
                    'pathId': path_id,
                    'gameObjectPathId': go_id,
                    'fatherTransformPathId': father,
                }
            elif type_name == 'MeshFilter':
                go_id = ptr_path_id(getattr(obj, 'm_GameObject', None))
                mesh_ptr = getattr(obj, 'm_Mesh', None)
                mesh = ptr_read(mesh_ptr)
                mesh_filters.append({
                    'pathId': path_id,
                    'gameObjectPathId': go_id,
                    'meshPathId': ptr_path_id(mesh_ptr),
                    'meshName': str(getattr(mesh, 'm_Name', '')) if mesh else '',
                })
            elif type_name == 'MeshRenderer':
                go_id = ptr_path_id(getattr(obj, 'm_GameObject', None))
                renderers.append({
                    'pathId': path_id,
                    'gameObjectPathId': go_id,
                    'lightmapIndex': getattr(obj, 'm_LightmapIndex', None),
                    'lightmapIndexDynamic': getattr(obj, 'm_LightmapIndexDynamic', None),
                    'lightmapST': repr(getattr(obj, 'm_LightmapTilingOffset', None)),
                    'lightmapSTDynamic': repr(getattr(obj, 'm_LightmapTilingOffsetDynamic', None)),
                })

        transform_by_go = {
            item['gameObjectPathId']: item
            for item in transforms.values()
            if item['gameObjectPathId'] is not None
        }
        go_by_transform = {
            item['pathId']: item['gameObjectPathId']
            for item in transforms.values()
        }

        def hierarchy(go_id):
            names = []
            seen = set()
            current_go = go_id
            while current_go is not None and current_go not in seen:
                seen.add(current_go)
                go = game_objects.get(current_go)
                if go and go['name']:
                    names.append(go['name'])
                tr = transform_by_go.get(current_go)
                if not tr:
                    break
                father_transform = tr['fatherTransformPathId']
                current_go = go_by_transform.get(father_transform)
            return '/'.join(reversed(names))

        renderer_by_go = {x['gameObjectPathId']: x for x in renderers}
        records = []
        for item in mesh_filters:
            go_id = item['gameObjectPathId']
            renderer = renderer_by_go.get(go_id)
            records.append({
                'hierarchyPath': hierarchy(go_id),
                'gameObjectPathId': str(go_id) if go_id is not None else None,
                'meshFilterPathId': str(item['pathId']),
                'meshPathId': str(item['meshPathId']) if item['meshPathId'] is not None else None,
                'meshName': item['meshName'],
                'rendererPathId': str(renderer['pathId']) if renderer else None,
                'lightmapIndex': renderer['lightmapIndex'] if renderer else None,
                'lightmapIndexDynamic': renderer['lightmapIndexDynamic'] if renderer else None,
                'lightmapST': renderer['lightmapST'] if renderer else None,
                'lightmapSTDynamic': renderer['lightmapSTDynamic'] if renderer else None,
            })

        report = {
            'schemaVersion': 1,
            'sourceRevision': metadata.get('assetBundleRevision'),
            'sourceBundle': TARGET_BUNDLE,
            'gameObjectCount': len(game_objects),
            'transformCount': len(transforms),
            'meshFilterCount': len(mesh_filters),
            'meshRendererCount': len(renderers),
            'records': records,
        }
        OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'output': str(OUT),
            'meshFilterCount': len(records),
            'recordsWithRenderer': sum(1 for x in records if x['rendererPathId']),
            'sample': records[:24],
        }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
