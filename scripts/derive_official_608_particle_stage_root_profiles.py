#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

SOURCE = Path('research/official-608-particle-systems.json')
OUTPUT = Path('research/official-608-particle-stage-root-profiles.json')

IDENTITY_ROTATION = {'x': 0.0, 'y': 0.0, 'z': 0.0, 'w': 1.0}
IDENTITY_SCALE = {'x': 1.0, 'y': 1.0, 'z': 1.0}
ZERO_POSITION = {'x': 0.0, 'y': 0.0, 'z': 0.0}


def close(a: float, b: float, eps: float = 1e-7) -> bool:
    return math.isfinite(float(a)) and abs(float(a) - b) <= eps


def vec_close(value: dict[str, Any], expected: dict[str, float]) -> bool:
    return all(close(float(value.get(key, math.nan)), target) for key, target in expected.items())


def require_identity(node: dict[str, Any], *, allow_translation: bool) -> None:
    name = str(node.get('gameObjectName'))
    if not vec_close(node.get('localRotation') or {}, IDENTITY_ROTATION):
        raise RuntimeError(f'{name}: non-identity parent rotation invalidates translation-only composition')
    if not vec_close(node.get('localScale') or {}, IDENTITY_SCALE):
        raise RuntimeError(f'{name}: non-identity parent scale invalidates translation-only composition')
    if not allow_translation and not vec_close(node.get('localPosition') or {}, ZERO_POSITION):
        raise RuntimeError(f'{name}: expected identity parent position, got {node.get("localPosition")}')


def xyz(value: dict[str, Any]) -> list[float]:
    return [float(value[key]) for key in ('x', 'y', 'z')]


def main() -> int:
    report = json.loads(SOURCE.read_text(encoding='utf-8'))
    systems = [
        item for item in report.get('components', [])
        if isinstance(item, dict) and item.get('type') == 'ParticleSystem'
    ]
    if len(systems) != 6:
        raise RuntimeError(f'Expected six current-JP ParticleSystem components, got {len(systems)}')

    profiles = []
    common_parent_position: list[float] | None = None
    for system in systems:
        chain = system.get('transformChain') or []
        names = [str(item.get('gameObjectName')) for item in chain]
        if names[:3] != ['Root', 'Stage', 'Eff_Bubbles'] or len(chain) != 4:
            raise RuntimeError(f'{system.get("hierarchyPath")}: unexpected transform chain {names}')
        require_identity(chain[0], allow_translation=False)
        require_identity(chain[1], allow_translation=False)
        require_identity(chain[2], allow_translation=True)
        parent_position = xyz(chain[2]['localPosition'])
        if common_parent_position is None:
            common_parent_position = parent_position
        elif parent_position != common_parent_position:
            raise RuntimeError('Eff_Bubbles parent position changed between systems')

        child = chain[3]
        child_position = xyz(child['localPosition'])
        stage_root_position = [
            parent_position[index] + child_position[index]
            for index in range(3)
        ]
        profiles.append({
            'name': str(child.get('gameObjectName')),
            'hierarchyPath': system.get('hierarchyPath'),
            'particleSystemPathId': system.get('pathId'),
            'transformPathId': child.get('pathId'),
            'localPositionUnderEffBubbles': child_position,
            'stageRootPosition': stage_root_position,
            'stageRootRotationQuaternion': [
                float(child['localRotation'][key]) for key in ('x', 'y', 'z', 'w')
            ],
            'stageRootScale': xyz(child['localScale']),
        })

    output = {
        'schemaVersion': 1,
        'source': 'official-jp-current-608-transform-chains',
        'assetBundleRevision': (report.get('metadata') or {}).get('assetBundleRevision'),
        'stageAssetTransform': {
            'scale': 1,
            'position': [0, 0, 0],
            'rotationEuler': [0, 0, 0],
            'source': 'public/stages/catalog/battle-608-00-00-001.json release contract',
        },
        'parent': {
            'hierarchyPath': 'Root/Stage/Eff_Bubbles',
            'stageRootPosition': common_parent_position,
            'stageRootRotationQuaternion': [0, 0, 0, 1],
            'stageRootScale': [1, 1, 1],
        },
        'systems': profiles,
        'composition': (
            'Exact for current JP: Root and Stage are identity; Eff_Bubbles has identity rotation/scale and only the recorded translation. '
            'Each system stageRootPosition is therefore Eff_Bubbles.localPosition + child.localPosition. The script fails closed if that parent contract changes.'
        ),
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'parent': output['parent'],
        'systems': [
            {'name': item['name'], 'stageRootPosition': item['stageRootPosition']}
            for item in profiles
        ],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
