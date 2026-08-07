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
OUTPUT = Path('research/official-608-particle-systems.json')


def local_ptr(value: Any) -> int:
    if not isinstance(value, dict):
        return 0
    try:
        return int(value.get('m_PathID', 0)) if int(value.get('m_FileID', 0)) == 0 else 0
    except Exception:
        return 0


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-608-particles-') as temporary:
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
        components: list[dict[str, Any]] = []

        parsed_objects: list[tuple[Any, str, dict[str, Any]]] = []
        for obj in env.objects:
            type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
            try:
                tree = obj.read_typetree()
            except Exception:
                continue
            if not isinstance(tree, dict):
                continue
            parsed_objects.append((obj, type_name, tree))
            path_id = int(getattr(obj, 'path_id', 0) or 0)
            if type_name == 'GameObject':
                game_objects[path_id] = str(tree.get('m_Name', ''))
            elif type_name == 'Transform':
                go_id = local_ptr(tree.get('m_GameObject'))
                transforms[path_id] = {
                    'pathId': path_id,
                    'gameObjectPathId': go_id,
                    'fatherTransformPathId': local_ptr(tree.get('m_Father')),
                    'localPosition': base.jsonable(tree.get('m_LocalPosition')),
                    'localRotation': base.jsonable(tree.get('m_LocalRotation')),
                    'localScale': base.jsonable(tree.get('m_LocalScale')),
                }
                if go_id:
                    transform_by_go[go_id] = path_id

        def transform_chain_for_go(go_id: int) -> list[dict[str, Any]]:
            chain = []
            transform_id = transform_by_go.get(go_id, 0)
            seen = set()
            while transform_id and transform_id not in seen:
                seen.add(transform_id)
                tr = transforms.get(transform_id)
                if not tr:
                    break
                current_go = int(tr.get('gameObjectPathId') or 0)
                chain.append({
                    **tr,
                    'gameObjectName': game_objects.get(current_go) or f'GameObject:{current_go}',
                })
                transform_id = int(tr.get('fatherTransformPathId') or 0)
            return list(reversed(chain))

        def hierarchy_for_go(go_id: int) -> str:
            return '/'.join(
                str(item.get('gameObjectName') or '')
                for item in transform_chain_for_go(go_id)
            )

        for obj, type_name, tree in parsed_objects:
            if type_name not in {'ParticleSystem', 'ParticleSystemRenderer'}:
                continue
            go_id = local_ptr(tree.get('m_GameObject'))
            transform_id = transform_by_go.get(go_id, 0)
            record = {
                'type': type_name,
                'pathId': int(getattr(obj, 'path_id', 0) or 0),
                'gameObjectPathId': go_id,
                'gameObjectName': game_objects.get(go_id, ''),
                'hierarchyPath': hierarchy_for_go(go_id),
                'transform': transforms.get(transform_id),
                'transformChain': transform_chain_for_go(go_id),
                'typetree': base.jsonable(tree),
            }
            components.append(record)

        type_counts = {
            name: sum(1 for item in components if item['type'] == name)
            for name in ('ParticleSystem', 'ParticleSystemRenderer')
        }
        report = {
            'schemaVersion': 2,
            'source': 'official-jp-current-root-stage-bundle',
            'metadata': metadata,
            'bundle': TARGET_BUNDLE,
            'componentCount': len(components),
            'typeCounts': type_counts,
            'components': sorted(
                components,
                key=lambda item: (item['hierarchyPath'], item['type'], item['pathId']),
            ),
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'componentCount': report['componentCount'],
            'typeCounts': report['typeCounts'],
            'hierarchies': sorted(set(item['hierarchyPath'] for item in components)),
            'parentChains': {
                item['hierarchyPath']: [
                    {
                        'name': tr['gameObjectName'],
                        'pathId': tr['pathId'],
                        'position': tr['localPosition'],
                        'rotation': tr['localRotation'],
                        'scale': tr['localScale'],
                    }
                    for tr in item['transformChain']
                ]
                for item in components
                if item['type'] == 'ParticleSystem'
            },
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
