#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

SOURCE = Path('research/official-608-material-properties.json')
OUTPUT = Path('research/official-608-sprite-material-modes.json')

TARGETS = {
    'bg3d608_00_blue_ChairCD',
    'mt_bg3d608_00_red_MusicNoteA',
    'mt_bg3d608_00_red_MusicNoteB',
    'mt_bg3d608_00_red_MusicNoteC',
    'mt_bg3d608_00_red_violinCol',
    'mt_bg3d608_00_red_violinShdLine',
}

RELEVANT_FLOAT = re.compile(
    r'(?:billboard|mesh.?uv|alpha|cull|zwrite|ztest|surface|blend|render|queue|'
    r'unlit|base.?setting|fog|flipbook|frame|uv|sprite|cutoff|receive.?shadow|cast.?shadow)',
    re.IGNORECASE,
)


def vector_dict(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    result: dict[str, float] = {}
    for key in ('x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'):
        item = value.get(key)
        if isinstance(item, (int, float)):
            result[key] = float(item)
    return result or None


def compact_material(material: dict[str, Any]) -> dict[str, Any]:
    tex_envs = []
    for env in material.get('texEnvs', []):
        if not isinstance(env, dict):
            continue
        prop = str(env.get('property', ''))
        file_id = int(env.get('fileId', 0) or 0)
        path_id = int(env.get('pathId', 0) or 0)
        scale = vector_dict(env.get('scale')) or {}
        offset = vector_dict(env.get('offset')) or {}
        non_default_st = (
            scale.get('x', 1.0) != 1.0
            or scale.get('y', 1.0) != 1.0
            or offset.get('x', 0.0) != 0.0
            or offset.get('y', 0.0) != 0.0
        )
        if file_id or path_id or non_default_st or prop in {'_BaseMap', '_MainTex'}:
            tex_envs.append({
                'property': prop,
                'fileId': file_id,
                'pathId': str(path_id),
                'resolvedLocalTextureName': env.get('resolvedLocalTextureName'),
                'scale': scale,
                'offset': offset,
            })

    floats = {
        str(name): float(value)
        for name, value in material.get('floats', [])
        if RELEVANT_FLOAT.search(str(name))
    }
    ints = {
        str(name): int(value)
        for name, value in material.get('ints', [])
        if RELEVANT_FLOAT.search(str(name))
    }
    colors = {
        str(name): vector_dict(value)
        for name, value in material.get('colors', [])
    }
    colors = {name: value for name, value in colors.items() if value is not None}

    return {
        'name': material.get('name'),
        'pathId': str(material.get('pathId')),
        'shader': material.get('shader'),
        'renderQueue': material.get('renderQueue'),
        'validKeywords': material.get('validKeywords', []),
        'invalidKeywords': material.get('invalidKeywords', []),
        'enableInstancingVariants': material.get('enableInstancingVariants'),
        'doubleSidedGI': material.get('doubleSidedGI'),
        'texEnvs': tex_envs,
        'floats': floats,
        'ints': ints,
        'colors': colors,
    }


def main() -> int:
    report = json.loads(SOURCE.read_text(encoding='utf-8'))
    materials = [
        material for material in report.get('materials', [])
        if isinstance(material, dict) and material.get('name') in TARGETS
    ]
    found = {str(material.get('name')) for material in materials}
    missing = sorted(TARGETS - found)
    if missing:
        raise RuntimeError(f'missing current-JP target materials: {missing}')

    compact = [compact_material(material) for material in materials]
    compact.sort(key=lambda item: str(item['name']))
    output = {
        'schemaVersion': 1,
        'source': 'official-jp-current-assetbundle-material-saved-properties',
        'assetBundleRevision': (report.get('metadata') or {}).get('assetBundleRevision'),
        'bundle': report.get('bundle'),
        'materials': compact,
        'interpretation': (
            'Exact serialized Material evidence only. No Web behavior is inferred here; '
            'billboard/mesh-UV/render-state semantics require shader/native parity before '
            'they may be described as exact.'
        ),
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
