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


def compact_minmax(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    result = {}
    for key in ('minMaxState', 'scalar', 'minScalar', 'minColor', 'maxColor'):
        if key in value:
            result[key] = value[key]
    return result


def compact_shape(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    keys = (
        'enabled', 'type', 'angle', 'length', 'boxThickness', 'radiusThickness',
        'donutRadius', 'm_Position', 'm_Rotation', 'm_Scale', 'placementMode',
        'alignToDirection', 'randomDirectionAmount', 'sphericalDirectionAmount',
        'randomPositionAmount',
    )
    result = {key: value[key] for key in keys if key in value}
    for key in ('radius', 'arc'):
        child = value.get(key)
        if isinstance(child, dict):
            result[key] = {
                name: child[name]
                for name in ('value', 'mode', 'spread')
                if name in child
            }
    return result


def compact_emission(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    return {
        'enabled': value.get('enabled'),
        'rateOverTime': compact_minmax(value.get('rateOverTime')),
        'rateOverDistance': compact_minmax(value.get('rateOverDistance')),
        'burstCount': value.get('m_BurstCount'),
    }


def compact_component(component: dict[str, Any]) -> dict[str, Any]:
    tree = component.get('typetree') if isinstance(component.get('typetree'), dict) else component
    transform = component.get('transform') if isinstance(component.get('transform'), dict) else {}
    initial = tree.get('InitialModule') if isinstance(tree.get('InitialModule'), dict) else {}
    return {
        'pathId': component.get('pathId'),
        'gameObjectPath': component.get('gameObjectPath') or component.get('hierarchyPath') or component.get('path'),
        'transformPathId': transform.get('pathId'),
        'localPosition': transform.get('localPosition'),
        'localRotation': transform.get('localRotation'),
        'localScale': transform.get('localScale'),
        'lengthInSec': first_value(tree, [('lengthInSec',), ('m_LengthInSec',)]),
        'simulationSpeed': first_value(tree, [('simulationSpeed',), ('m_SimulationSpeed',)]),
        'looping': first_value(tree, [('looping',), ('m_Looping',)]),
        'prewarm': first_value(tree, [('prewarm',), ('m_Prewarm',)]),
        'playOnAwake': first_value(tree, [('playOnAwake',), ('m_PlayOnAwake',)]),
        'autoRandomSeed': tree.get('autoRandomSeed'),
        'randomSeed': tree.get('randomSeed'),
        'moveWithTransform': tree.get('moveWithTransform'),
        'scalingMode': tree.get('scalingMode'),
        'maxParticles': initial.get('maxNumParticles'),
        'size3D': initial.get('size3D'),
        'rotation3D': initial.get('rotation3D'),
        'startLifetime': compact_minmax(initial.get('startLifetime')),
        'startSpeed': compact_minmax(initial.get('startSpeed')),
        'startColor': compact_minmax(initial.get('startColor')),
        'startSize': compact_minmax(initial.get('startSize')),
        'startSizeY': compact_minmax(initial.get('startSizeY')),
        'startSizeZ': compact_minmax(initial.get('startSizeZ')),
        'startRotation': compact_minmax(initial.get('startRotation')),
        'startRotationX': compact_minmax(initial.get('startRotationX')),
        'startRotationY': compact_minmax(initial.get('startRotationY')),
        'randomizeRotationDirection': initial.get('randomizeRotationDirection'),
        'gravityModifier': compact_minmax(initial.get('gravityModifier')),
        'shape': compact_shape(tree.get('ShapeModule')),
        'emission': compact_emission(tree.get('EmissionModule')),
        'velocityOverLifetimeEnabled': get_path(tree, 'VelocityModule', 'enabled'),
        'colorOverLifetimeEnabled': get_path(tree, 'ColorModule', 'enabled'),
        'sizeOverLifetimeEnabled': get_path(tree, 'SizeModule', 'enabled'),
        'rotationOverLifetimeEnabled': get_path(tree, 'RotationModule', 'enabled'),
        'textureSheetAnimationEnabled': get_path(tree, 'UVModule', 'enabled'),
    }


def find_component_list(report: dict[str, Any], type_name: str) -> list[dict[str, Any]]:
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
        transform = renderer.get('transform') if isinstance(renderer.get('transform'), dict) else {}
        renderer_rows.append({
            'pathId': renderer.get('pathId'),
            'gameObjectPath': renderer.get('gameObjectPath') or renderer.get('hierarchyPath') or renderer.get('path'),
            'transformPathId': transform.get('pathId'),
            'materialPointers': first_value(tree, [('m_Materials',), ('materials',)]),
            'renderMode': first_value(tree, [('m_RenderMode',), ('renderMode',)]),
            'sortMode': first_value(tree, [('m_SortMode',), ('sortMode',)]),
            'sortingFudge': first_value(tree, [('m_SortingFudge',), ('sortingFudge',)]),
            'sortingLayerId': tree.get('m_SortingLayerID'),
            'sortingOrder': tree.get('m_SortingOrder'),
            'minParticleSize': first_value(tree, [('m_MinParticleSize',), ('minParticleSize',)]),
            'maxParticleSize': first_value(tree, [('m_MaxParticleSize',), ('maxParticleSize',)]),
            'cameraVelocityScale': tree.get('m_CameraVelocityScale'),
            'velocityScale': tree.get('m_VelocityScale'),
            'lengthScale': tree.get('m_LengthScale'),
            'normalDirection': tree.get('m_NormalDirection'),
        })

    report = {
        'schemaVersion': 2,
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
            'Serialized transforms, ParticleSystem/Renderer fields and decoded BaseMap identity are exact current-JP evidence. '
            'Any Three.js implementation must explicitly mark Unity random-seed stream equivalence, native billboard camera-facing rules, '
            'particle integrator/order, depth-sort/renderQueue behaviour and unsupported modules as approximation/deferred unless independently recovered.'
        ),
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'systemCount': report['systemCount'],
        'rendererCount': report['rendererCount'],
        'systems': [
            {
                'path': item['gameObjectPath'],
                'position': item['localPosition'],
                'rotation': item['localRotation'],
                'scale': item['localScale'],
                'lifetime': item['startLifetime'],
                'speed': item['startSpeed'],
                'size': item['startSize'],
                'rate': item['emission']['rateOverTime'],
                'maxParticles': item['maxParticles'],
            }
            for item in compact_systems
        ],
        'texture': {
            'name': report['baseMap']['name'],
            'size': report['baseMap']['decodedSize'],
            'pixelSha256': report['baseMap']['pixelSha256'],
        },
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
