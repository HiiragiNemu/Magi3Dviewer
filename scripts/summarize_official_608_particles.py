#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SOURCE = Path('research/official-608-particle-systems.json')
OUTPUT = Path('research/official-608-particle-summary.json')


def get(value: Any, *keys: str, default=None):
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    return default if current is None else current


def minmax(value: Any):
    if not isinstance(value, dict):
        return None
    result = {
        'minMaxState': value.get('minMaxState'),
        'scalar': value.get('scalar'),
        'minScalar': value.get('minScalar'),
    }
    curve = get(value, 'maxCurve', 'm_Curve', default=[])
    min_curve = get(value, 'minCurve', 'm_Curve', default=[])
    if curve:
        result['maxCurve'] = curve
    if min_curve:
        result['minCurve'] = min_curve
    return result


def gradient(value: Any):
    if not isinstance(value, dict):
        return None
    return {
        'minMaxState': value.get('minMaxState'),
        'minColor': value.get('minColor'),
        'maxColor': value.get('maxColor'),
        'maxGradient': value.get('maxGradient'),
        'minGradient': value.get('minGradient'),
    }


def ptr(value: Any):
    if not isinstance(value, dict):
        return None
    if 'm_FileID' not in value and 'm_PathID' not in value:
        return None
    return {
        'fileId': int(value.get('m_FileID', 0)),
        'pathId': int(value.get('m_PathID', 0)),
    }


def main() -> int:
    data = json.loads(SOURCE.read_text(encoding='utf-8'))
    systems = {}
    renderers = {}
    for component in data.get('components', []):
        hierarchy = component.get('hierarchyPath') or f"path:{component.get('pathId')}"
        tree = component.get('typetree') or {}
        if component.get('type') == 'ParticleSystem':
            initial = tree.get('InitialModule') or {}
            shape = tree.get('ShapeModule') or {}
            emission = tree.get('EmissionModule') or {}
            velocity = tree.get('VelocityModule') or tree.get('VelocityOverLifetimeModule') or {}
            color = tree.get('ColorModule') or tree.get('ColorOverLifetimeModule') or {}
            size = tree.get('SizeModule') or tree.get('SizeOverLifetimeModule') or {}
            rotation = tree.get('RotationModule') or tree.get('RotationOverLifetimeModule') or {}
            noise = tree.get('NoiseModule') or {}
            systems[hierarchy] = {
                'hierarchyPath': hierarchy,
                'transform': component.get('transform'),
                'lengthInSec': tree.get('lengthInSec'),
                'simulationSpeed': tree.get('simulationSpeed'),
                'looping': tree.get('looping'),
                'prewarm': tree.get('prewarm'),
                'playOnAwake': tree.get('playOnAwake'),
                'scalingMode': tree.get('scalingMode'),
                'moveWithTransform': tree.get('moveWithTransform'),
                'startDelay': minmax(tree.get('startDelay')),
                'initial': {
                    'enabled': initial.get('enabled'),
                    'startLifetime': minmax(initial.get('startLifetime')),
                    'startSpeed': minmax(initial.get('startSpeed')),
                    'startColor': gradient(initial.get('startColor')),
                    'startSize': minmax(initial.get('startSize')),
                    'startSizeY': minmax(initial.get('startSizeY')),
                    'startSizeZ': minmax(initial.get('startSizeZ')),
                    'startRotation': minmax(initial.get('startRotation')),
                    'startRotationX': minmax(initial.get('startRotationX')),
                    'startRotationY': minmax(initial.get('startRotationY')),
                    'gravityModifier': minmax(initial.get('gravityModifier')),
                    'maxNumParticles': initial.get('maxNumParticles'),
                    'size3D': initial.get('size3D'),
                    'rotation3D': initial.get('rotation3D'),
                },
                'shape': {
                    key: shape.get(key)
                    for key in (
                        'enabled', 'type', 'angle', 'length', 'radiusThickness',
                        'donutRadius', 'm_Position', 'm_Rotation', 'm_Scale',
                        'placementMode', 'randomDirectionAmount',
                        'sphericalDirectionAmount', 'randomPositionAmount',
                        'alignToDirection',
                    ) if key in shape
                },
                'emission': {
                    'enabled': emission.get('enabled'),
                    'rateOverTime': minmax(emission.get('rateOverTime')),
                    'rateOverDistance': minmax(emission.get('rateOverDistance')),
                    'bursts': emission.get('m_Bursts') or emission.get('bursts'),
                },
                'velocityOverLifetime': {
                    'enabled': velocity.get('enabled'),
                    'x': minmax(velocity.get('x')),
                    'y': minmax(velocity.get('y')),
                    'z': minmax(velocity.get('z')),
                    'orbitalX': minmax(velocity.get('orbitalX')),
                    'orbitalY': minmax(velocity.get('orbitalY')),
                    'orbitalZ': minmax(velocity.get('orbitalZ')),
                    'radial': minmax(velocity.get('radial')),
                    'speedModifier': minmax(velocity.get('speedModifier')),
                    'inWorldSpace': velocity.get('inWorldSpace'),
                },
                'colorOverLifetime': {
                    'enabled': color.get('enabled'),
                    'gradient': gradient(color.get('gradient') or color.get('color')),
                },
                'sizeOverLifetime': {
                    'enabled': size.get('enabled'),
                    'curve': minmax(size.get('curve') or size.get('size')),
                    'y': minmax(size.get('y')),
                    'z': minmax(size.get('z')),
                    'separateAxes': size.get('separateAxes'),
                },
                'rotationOverLifetime': {
                    'enabled': rotation.get('enabled'),
                    'curve': minmax(rotation.get('curve') or rotation.get('z')),
                    'x': minmax(rotation.get('x')),
                    'y': minmax(rotation.get('y')),
                    'separateAxes': rotation.get('separateAxes'),
                },
                'noise': {
                    key: noise.get(key)
                    for key in (
                        'enabled', 'frequency', 'damping', 'octaves',
                        'octaveMultiplier', 'octaveScale', 'quality',
                        'scrollSpeed', 'remapEnabled', 'positionAmount',
                        'rotationAmount', 'sizeAmount',
                    ) if key in noise
                },
            }
        elif component.get('type') == 'ParticleSystemRenderer':
            renderers[hierarchy] = {
                'hierarchyPath': hierarchy,
                'transform': component.get('transform'),
                'renderMode': tree.get('m_RenderMode'),
                'sortMode': tree.get('m_SortMode'),
                'minParticleSize': tree.get('m_MinParticleSize'),
                'maxParticleSize': tree.get('m_MaxParticleSize'),
                'cameraVelocityScale': tree.get('m_CameraVelocityScale'),
                'velocityScale': tree.get('m_VelocityScale'),
                'lengthScale': tree.get('m_LengthScale'),
                'sortingFudge': tree.get('m_SortingFudge'),
                'normalDirection': tree.get('m_NormalDirection'),
                'sortingLayerID': tree.get('m_SortingLayerID'),
                'sortingOrder': tree.get('m_SortingOrder'),
                'materials': [
                    pointer for pointer in (ptr(item) for item in (tree.get('m_Materials') or []))
                    if pointer is not None
                ],
                'trailMaterial': ptr(tree.get('m_TrailMaterial')),
                'mesh': ptr(tree.get('m_Mesh')),
            }

    profiles = []
    for hierarchy in sorted(set(systems) | set(renderers)):
        profiles.append({
            'hierarchyPath': hierarchy,
            'particleSystem': systems.get(hierarchy),
            'renderer': renderers.get(hierarchy),
        })
    report = {
        'schemaVersion': 1,
        'source': data.get('source'),
        'metadata': data.get('metadata'),
        'bundle': data.get('bundle'),
        'profileCount': len(profiles),
        'profiles': profiles,
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'profileCount': len(profiles),
        'profiles': [
            {
                'hierarchyPath': item['hierarchyPath'],
                'hasSystem': item['particleSystem'] is not None,
                'hasRenderer': item['renderer'] is not None,
                'renderMode': (item['renderer'] or {}).get('renderMode'),
                'materials': (item['renderer'] or {}).get('materials'),
                'maxParticles': get(item, 'particleSystem', 'initial', 'maxNumParticles'),
                'lifetime': get(item, 'particleSystem', 'initial', 'startLifetime'),
                'speed': get(item, 'particleSystem', 'initial', 'startSpeed'),
                'emission': get(item, 'particleSystem', 'emission'),
            }
            for item in profiles
        ],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
