#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SOURCE = Path('research/official-608-particle-systems.json')
TEXTURE = Path('research/official-608-particle-texture.json')
OUTPUT = Path('research/official-608-particle-runtime-profile.json')


def get_path(obj: Any, *keys: str) -> Any:
    value = obj
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def first_value(obj: dict[str, Any], candidates: list[tuple[str, ...]]) -> Any:
    for path in candidates:
        value = get_path(obj, *path)
        if value is not None:
            return value
    return None


def compact_component(component: dict[str, Any]) -> dict[str, Any]:
    tree = component.get('typetree') if isinstance(component.get('typetree'), dict) else component
    return {
        'pathId': component.get('pathId'),
        'gameObjectPath': component.get('gameObjectPath') or component.get('hierarchyPath') or component.get('path'),
        'localPosition': first_value(tree, [('m_LocalPosition',), ('localPosition',)]),
        'localRotation': first_value(tree, [('m_LocalRotation',), ('localRotation',)]),
        'localScale': first_value(tree, [('m_LocalScale',), ('localScale',)]),
        'lengthInSec': first_value(tree, [('lengthInSec',), ('m_LengthInSec',)]),
        'simulationSpeed': first_value(tree, [('simulationSpeed',), ('m_SimulationSpeed',)]),
        'looping': first_value(tree, [('looping',), ('m_Looping',)]),
        'prewarm': first_value(tree, [('prewarm',), ('m_Prewarm',)]),
        'playOnAwake': first_value(tree, [('playOnAwake',), ('m_PlayOnAwake',)]),
        'maxParticles': first_value(tree, [('maxParticles',), ('m_MaxParticles',)]),
        'startLifetime': first_value(tree, [('InitialModule', 'startLifetime'), ('initialModule', 'startLifetime'), ('startLifetime',)]),
        'startSpeed': first_value(tree, [('InitialModule', 'startSpeed'), ('initialModule', 'startSpeed'), ('startSpeed',)]),
        'startColor': first_value(tree, [('InitialModule', 'startColor'), ('initialModule', 'startColor'), ('startColor',)]),
        'startSize': first_value(tree, [('InitialModule', 'startSize'), ('initialModule', 'startSize'), ('startSize',)]),
        'startRotation': first_value(tree, [('InitialModule', 'startRotation'), ('initialModule', 'startRotation'), ('startRotation',)]),
        'gravityModifier': first_value(tree, [('InitialModule', 'gravityModifier'), ('initialModule', 'gravityModifier'), ('gravityModifier',)]),
        'shape': first_value(tree, [('ShapeModule',), ('shapeModule',), ('shape',)]),
        'emission': first_value(tree, [('EmissionModule',), ('emissionModule',), ('emission',)]),
    }


def find_component_list(report: dict[str, Any], type_name: str) -> list[dict[str, Any]]:
    candidates = [
        report.get(type_name),
        report.get(type_name.lower()),
        report.get(f'{type_name}s'),
        report.get(f'{type_name.lower()}s'),
        report.get('particleSystems') if type_name == 'ParticleSystem' else report.get('particleSystemRenderers'),
    ]
    for value in candidates:
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    components = report.get('components')
    if isinstance(components, list):
        return [
            item for item in components
            if isinstance(item, dict) and str(item.get('type')) == type_name
        ]
    return []


def main() -> int:
    source = json.loads(SOURCE.read_text(encoding='utf-8'))
    texture = json.loads(TEXTURE.read_text(encoding='utf-8'))
    systems = find_component_list(source, 'ParticleSystem')
    renderers = find_component_list(source, 'ParticleSystemRenderer')
    if len(systems) != 6 or len(renderers) != 6:
        raise RuntimeError(f'Expected 6 ParticleSystem + 6 renderer components, got {len(systems)} + {len(renderers)}')

    compact_systems = [compact_component(item) for item in systems]
    renderer_rows = []
    for renderer in renderers:
        tree = renderer.get('typetree') if isinstance(renderer.get('typetree'), dict) else renderer
        renderer_rows.append({
            'pathId': renderer.get('pathId'),
            'gameObjectPath': renderer.get('gameObjectPath') or renderer.get('hierarchyPath') or renderer.get('path'),
            'materialPointers': first_value(tree, [('m_Materials',), ('materials',)]),
            'renderMode': first_value(tree, [('m_RenderMode',), ('renderMode',)]),
            'sortMode': first_value(tree, [('m_SortMode',), ('sortMode',)]),
            'sortingFudge': first_value(tree, [('m_SortingFudge',), ('sortingFudge',)]),
            'minParticleSize': first_value(tree, [('m_MinParticleSize',), ('minParticleSize',)]),
            'maxParticleSize': first_value(tree, [('m_MaxParticleSize',), ('maxParticleSize',)]),
        })

    report = {
        'schemaVersion': 1,
        'source': 'official-jp-current-608-particle-components',
        'assetBundleRevision': (source.get('metadata') or {}).get('assetBundleRevision'),
        'systemCount': len(compact_systems),
        'rendererCount': len(renderer_rows),
        'systems': compact_systems,
        'renderers': renderer_rows,
        'sharedMaterial': {
            'name': 'bg3d608_00_blue_bubble',
            'renderQueue': 3000,
            'shader': 'Unlit',
            'srcBlend': 5,
            'dstBlend': 10,
            'zWrite': 0,
        },
        'baseMap': texture['resolvedTexture'],
        'implementationBoundary': (
            'Serialized component values and decoded BaseMap identity are exact current-JP evidence. '
            'Any Three.js particle integration must separately mark unsupported Unity ParticleSystem modules, '
            'simulation ordering, random-seed semantics, billboard orientation, shader blend/order differences or timing approximations.'
        ),
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'systemCount': report['systemCount'],
        'rendererCount': report['rendererCount'],
        'paths': [item['gameObjectPath'] for item in compact_systems],
        'texture': {
            'name': report['baseMap']['name'],
            'size': report['baseMap']['decodedSize'],
            'pixelSha256': report['baseMap']['pixelSha256'],
        },
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
