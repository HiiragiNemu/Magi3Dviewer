#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
OUTPUT = Path('research/official-608-gameobject-states.json')
RENDERER_TYPES = {
    'MeshRenderer',
    'SkinnedMeshRenderer',
    'ParticleSystemRenderer',
    'TrailRenderer',
    'LineRenderer',
}
FOCUS_RE = re.compile(
    r'(red|blue|violin|chair|music|note|fish|roof|bubble|object)',
    re.IGNORECASE,
)


def local_ptr(value: Any) -> int:
    if not isinstance(value, dict):
        return 0
    try:
        return int(value.get('m_PathID', 0)) if int(value.get('m_FileID', 0)) == 0 else 0
    except Exception:
        return 0


def ptr_list(value: Any) -> list[dict[str, int]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, int]] = []
    for item in value:
        pointer = item
        if isinstance(item, dict) and 'component' in item:
            pointer = item.get('component')
        if not isinstance(pointer, dict):
            continue
        try:
            result.append({
                'fileId': int(pointer.get('m_FileID', 0) or 0),
                'pathId': int(pointer.get('m_PathID', 0) or 0),
            })
        except Exception:
            continue
    return result


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-608-gameobject-state-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        selected = [entry for entry in entries if entry.full_path.lower() == TARGET_BUNDLE]
        if len(selected) != 1:
            raise RuntimeError(f'expected one stage bundle, got {len(selected)}')
        bundle_path = base.download(selected[0], request_headers, token, temp)
        env = UnityPy.load(str(bundle_path))

        parsed: dict[int, tuple[str, dict[str, Any]]] = {}
        game_objects: dict[int, dict[str, Any]] = {}
        transforms: dict[int, dict[str, Any]] = {}
        transform_by_go: dict[int, int] = {}
        components_by_go: dict[int, list[dict[str, Any]]] = {}

        for obj in env.objects:
            type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
            try:
                tree = obj.read_typetree()
            except Exception:
                continue
            if not isinstance(tree, dict):
                continue
            path_id = int(getattr(obj, 'path_id', 0) or 0)
            parsed[path_id] = (type_name, tree)
            if type_name == 'GameObject':
                game_objects[path_id] = {
                    'pathId': path_id,
                    'name': str(tree.get('m_Name', '')),
                    'isActive': bool(tree.get('m_IsActive', True)),
                    'layer': int(tree.get('m_Layer', 0) or 0),
                    'componentPointers': ptr_list(tree.get('m_Component')),
                }
            elif type_name == 'Transform':
                go_id = local_ptr(tree.get('m_GameObject'))
                transforms[path_id] = {
                    'pathId': path_id,
                    'gameObjectPathId': go_id,
                    'fatherTransformPathId': local_ptr(tree.get('m_Father')),
                }
                if go_id:
                    transform_by_go[go_id] = path_id

        for path_id, (type_name, tree) in parsed.items():
            go_id = local_ptr(tree.get('m_GameObject'))
            if not go_id or type_name in {'GameObject', 'Transform'}:
                continue
            component: dict[str, Any] = {
                'type': type_name,
                'pathId': path_id,
            }
            if type_name in RENDERER_TYPES:
                component['enabled'] = bool(tree.get('m_Enabled', True))
                materials = tree.get('m_Materials')
                if isinstance(materials, list):
                    component['materials'] = [
                        {
                            'fileId': int(item.get('m_FileID', 0) or 0),
                            'pathId': int(item.get('m_PathID', 0) or 0),
                        }
                        for item in materials
                        if isinstance(item, dict)
                    ]
            components_by_go.setdefault(go_id, []).append(component)

        def hierarchy_for_go(go_id: int) -> str:
            names: list[str] = []
            transform_id = transform_by_go.get(go_id, 0)
            seen: set[int] = set()
            while transform_id and transform_id not in seen:
                seen.add(transform_id)
                tr = transforms.get(transform_id)
                if tr is None:
                    break
                current_go = int(tr.get('gameObjectPathId') or 0)
                names.append(str(game_objects.get(current_go, {}).get('name') or f'GameObject:{current_go}'))
                transform_id = int(tr.get('fatherTransformPathId') or 0)
            return '/'.join(reversed(names))

        renderables: list[dict[str, Any]] = []
        all_game_objects: list[dict[str, Any]] = []
        for go_id, go in game_objects.items():
            components = sorted(
                components_by_go.get(go_id, []),
                key=lambda item: (str(item['type']), int(item['pathId'])),
            )
            hierarchy = hierarchy_for_go(go_id)
            record = {
                **go,
                'hierarchyPath': hierarchy,
                'components': components,
            }
            all_game_objects.append(record)
            if any(str(item['type']) in RENDERER_TYPES for item in components):
                renderables.append(record)

        focus = [
            item for item in renderables
            if FOCUS_RE.search(str(item['name'])) or FOCUS_RE.search(str(item['hierarchyPath']))
        ]
        inactive_renderables = [item for item in renderables if not item['isActive']]
        disabled_renderers = [
            {
                'hierarchyPath': item['hierarchyPath'],
                'name': item['name'],
                'gameObjectPathId': item['pathId'],
                'renderer': component,
            }
            for item in renderables
            for component in item['components']
            if component['type'] in RENDERER_TYPES and component.get('enabled') is False
        ]

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-root-stage-bundle',
            'metadata': metadata,
            'bundle': TARGET_BUNDLE,
            'gameObjectCount': len(all_game_objects),
            'renderableGameObjectCount': len(renderables),
            'inactiveRenderableCount': len(inactive_renderables),
            'disabledRendererCount': len(disabled_renderers),
            'inactiveRenderableHierarchyPaths': sorted(item['hierarchyPath'] for item in inactive_renderables),
            'disabledRenderers': disabled_renderers,
            'focusRenderables': sorted(
                focus,
                key=lambda item: (item['hierarchyPath'], int(item['pathId'])),
            ),
            'renderables': sorted(
                renderables,
                key=lambda item: (item['hierarchyPath'], int(item['pathId'])),
            ),
            'interpretation': (
                'GameObject m_IsActive and Renderer m_Enabled are exact current-JP serialized initial state. '
                'This report does not infer later animation/script-driven red/blue state transitions.'
            ),
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'gameObjectCount': report['gameObjectCount'],
            'renderableGameObjectCount': report['renderableGameObjectCount'],
            'inactiveRenderableCount': report['inactiveRenderableCount'],
            'disabledRendererCount': report['disabledRendererCount'],
            'inactiveRenderableHierarchyPaths': report['inactiveRenderableHierarchyPaths'],
            'disabledRenderers': report['disabledRenderers'],
            'focusRenderables': [
                {
                    'hierarchyPath': item['hierarchyPath'],
                    'isActive': item['isActive'],
                    'components': [
                        {
                            'type': component['type'],
                            'enabled': component.get('enabled'),
                        }
                        for component in item['components']
                        if component['type'] in RENDERER_TYPES
                    ],
                }
                for item in report['focusRenderables']
            ],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
