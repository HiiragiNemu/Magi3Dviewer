#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
OUTPUT = Path('research/official-608-reflection-probes.json')


def ptr(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    try:
        return {
            'fileId': int(value.get('m_FileID', 0)),
            'pathId': int(value.get('m_PathID', 0)),
        }
    except Exception:
        return None


def local_ptr(value: Any) -> int:
    p = ptr(value)
    return int(p['pathId']) if p and p['fileId'] == 0 else 0


def select(tree: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in tree:
            return base.jsonable(tree[key])
    return None


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-608-probes-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        selected = [entry for entry in entries if entry.full_path.lower() == TARGET_BUNDLE]
        if len(selected) != 1:
            raise RuntimeError(f'expected one stage bundle, got {len(selected)}')
        bundle_path = base.download(selected[0], request_headers, token, temp)
        env = UnityPy.load(str(bundle_path))

        game_objects: dict[int, str] = {}
        transforms: dict[int, dict[str, Any]] = {}
        transform_by_go: dict[int, int] = {}
        cubemaps: dict[int, str] = {}
        raw_probes: list[tuple[Any, dict[str, Any]]] = []

        for obj in env.objects:
            type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
            try:
                tree = obj.read_typetree()
            except Exception:
                continue
            if not isinstance(tree, dict):
                continue
            path_id = int(getattr(obj, 'path_id', 0) or 0)
            if type_name == 'GameObject':
                game_objects[path_id] = str(tree.get('m_Name', ''))
            elif type_name == 'Transform':
                go_id = local_ptr(tree.get('m_GameObject'))
                transforms[path_id] = {
                    'pathId': path_id,
                    'gameObjectPathId': go_id,
                    'fatherTransformPathId': local_ptr(tree.get('m_Father')),
                    'localPosition': select(tree, 'm_LocalPosition'),
                    'localRotation': select(tree, 'm_LocalRotation'),
                    'localScale': select(tree, 'm_LocalScale'),
                }
                if go_id:
                    transform_by_go[go_id] = path_id
            elif type_name == 'Cubemap':
                cubemaps[path_id] = str(tree.get('m_Name', ''))
            elif type_name == 'ReflectionProbe':
                raw_probes.append((obj, tree))

        def hierarchy_for_go(go_id: int) -> str:
            names = []
            transform_id = transform_by_go.get(go_id, 0)
            seen = set()
            while transform_id and transform_id not in seen:
                seen.add(transform_id)
                tr = transforms.get(transform_id)
                if not tr:
                    break
                current_go = int(tr.get('gameObjectPathId') or 0)
                names.append(game_objects.get(current_go) or f'GameObject:{current_go}')
                transform_id = int(tr.get('fatherTransformPathId') or 0)
            return '/'.join(reversed(names))

        probes = []
        for obj, tree in raw_probes:
            go_id = local_ptr(tree.get('m_GameObject'))
            transform_id = transform_by_go.get(go_id, 0)
            tr = transforms.get(transform_id)
            baked = ptr(tree.get('m_BakedTexture'))
            custom = ptr(tree.get('m_CustomBakedTexture'))
            probes.append({
                'pathId': int(getattr(obj, 'path_id', 0) or 0),
                'gameObjectPathId': go_id,
                'gameObjectName': game_objects.get(go_id, ''),
                'hierarchyPath': hierarchy_for_go(go_id),
                'transform': tr,
                'boxSize': select(tree, 'm_BoxSize'),
                'boxOffset': select(tree, 'm_BoxOffset'),
                'nearClip': select(tree, 'm_NearClip'),
                'farClip': select(tree, 'm_FarClip'),
                'intensity': select(tree, 'm_Intensity'),
                'blendDistance': select(tree, 'm_BlendDistance'),
                'hdr': select(tree, 'm_HDR'),
                'boxProjection': select(tree, 'm_BoxProjection'),
                'mode': select(tree, 'm_Mode'),
                'refreshMode': select(tree, 'm_RefreshMode'),
                'timeSlicingMode': select(tree, 'm_TimeSlicingMode'),
                'resolution': select(tree, 'm_Resolution'),
                'importance': select(tree, 'm_Importance'),
                'clearFlags': select(tree, 'm_ClearFlags'),
                'backgroundColor': select(tree, 'm_BackGroundColor', 'm_BackgroundColor'),
                'cullingMask': select(tree, 'm_CullingMask'),
                'bakedTexture': {
                    **(baked or {}),
                    'localCubemapName': cubemaps.get(baked['pathId']) if baked and baked['fileId'] == 0 else None,
                } if baked else None,
                'customBakedTexture': {
                    **(custom or {}),
                    'localCubemapName': cubemaps.get(custom['pathId']) if custom and custom['fileId'] == 0 else None,
                } if custom else None,
                'typetreeKeys': sorted(tree.keys()),
            })

        if not probes:
            raise RuntimeError('no ReflectionProbe components found in stage 608 root bundle')
        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-assetbundle',
            'metadata': metadata,
            'bundle': TARGET_BUNDLE,
            'probeCount': len(probes),
            'probes': probes,
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
