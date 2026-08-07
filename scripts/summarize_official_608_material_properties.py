#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SOURCE = Path('research/official-608-material-properties.json')
OUTPUT = Path('research/official-608-material-summary.json')

FLOAT_KEYS = {
    '_USE_MULTI_UV_SCROLL',
    '_DropFrame_MultiScroll',
    '_1stOpacity',
    '_2ndOpacity',
    '_Additive_to_Multiply',
    '_AlphaClip',
    '_Alpha_Clip',
    '_Unlitness',
    '_UseFlipbook',
    '_FlipbookFrameRate',
    '_FlipbookOffset',
    '_UseMatCap',
    '_MatCapIntensity',
    '_Smoothness',
    '_Metallic',
}
COLOR_KEYS = {
    '_1stColor',
    '_2ndColor',
    '_1stTilling',
    '_2ndTilling',
    '_1stOffset',
    '_2ndOffset',
    '_1stScrollSpeed',
    '_2ndScrollSpeed',
    '_UV_Scroll',
    '_BaseColor',
    '_Color',
}
TEX_KEYS = {
    '_BaseMap',
    '_MainTex',
    '_ScrollTexture',
    '_ScrollTexutre',
    '_MatCapTex',
    '_BlendTex',
    '_Blend2ndTex',
}


def pairs(value: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    if not isinstance(value, list):
        return result
    for item in value:
        if not isinstance(item, list) or len(item) != 2:
            continue
        result[str(item[0])] = item[1]
    return result


def tex_map(value: Any) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if not isinstance(value, list):
        return result
    for item in value:
        if not isinstance(item, dict):
            continue
        key = str(item.get('property', ''))
        if key:
            result[key] = item
    return result


def nonzero_pointer(item: dict[str, Any] | None) -> bool:
    if not item:
        return False
    return int(item.get('fileId') or 0) != 0 or int(item.get('pathId') or 0) != 0


def main() -> int:
    data = json.loads(SOURCE.read_text(encoding='utf-8'))
    selected: list[dict[str, Any]] = []
    for material in data.get('materials', []):
        floats = pairs(material.get('floats'))
        colors = pairs(material.get('colors'))
        textures = tex_map(material.get('texEnvs'))
        multi = float(floats.get('_USE_MULTI_UV_SCROLL') or 0.0)
        scroll = textures.get('_ScrollTexture') or textures.get('_ScrollTexutre')
        dynamic = multi > 0.5 or nonzero_pointer(scroll)
        if not dynamic:
            continue
        selected.append({
            'name': material.get('name'),
            'pathId': material.get('pathId'),
            'validKeywords': material.get('validKeywords'),
            'renderQueue': material.get('renderQueue'),
            'floats': {key: floats[key] for key in FLOAT_KEYS if key in floats},
            'vectorsAndColors': {key: colors[key] for key in COLOR_KEYS if key in colors},
            'textures': {key: textures[key] for key in TEX_KEYS if key in textures},
        })

    report = {
        'schemaVersion': 1,
        'source': data.get('source'),
        'metadata': data.get('metadata'),
        'bundle': data.get('bundle'),
        'dynamicMaterialCount': len(selected),
        'dynamicMaterials': selected,
        'localTextures': data.get('textures', []),
    }
    if not selected:
        raise RuntimeError('no stage 608 dynamic/multi-UV-scroll Material was found')
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
