#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

OFFICIAL = Path('research/official-608-material-properties.json')
OUTPUT = Path('research/official-608-vs-release-material-bindings.json')


def normalize_name(value: str) -> str:
    value = str(value).strip()
    value = re.sub(r'\.\d+$', '', value)
    return value.lower()


def pairs_to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return {str(key): child for key, child in value.items()}
    result: dict[str, Any] = {}
    if not isinstance(value, list):
        return result
    for item in value:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            result[str(item[0])] = item[1]
        elif isinstance(item, dict) and 'first' in item and 'second' in item:
            result[str(item['first'])] = item['second']
        elif isinstance(item, dict) and 'key' in item and 'value' in item:
            result[str(item['key'])] = item['value']
    return result


def tex_envs(material: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get('property')): item
        for item in material.get('texEnvs') or []
        if isinstance(item, dict) and item.get('property')
    }


def basename_without_extension(value: str | None) -> str | None:
    if not value:
        return None
    name = str(value).replace('\\', '/').rsplit('/', 1)[-1]
    return name.rsplit('.', 1)[0]


def comparable(material: dict[str, Any], binding: dict[str, Any] | None) -> dict[str, Any]:
    floats = pairs_to_dict(material.get('floats'))
    ints = pairs_to_dict(material.get('ints'))
    colors = pairs_to_dict(material.get('colors'))
    textures = tex_envs(material)
    base_map = textures.get('_BaseMap') or textures.get('_MainTex')
    official = {
        'renderQueue': material.get('renderQueue'),
        'validKeywords': material.get('validKeywords') or [],
        'invalidKeywords': material.get('invalidKeywords') or [],
        'smoothness': floats.get('_Smoothness'),
        'unlitness': floats.get('_Unlitness'),
        'alphaClipEnabled': floats.get('_AlphaClip'),
        'alphaClipThreshold': floats.get('_Alpha_Clip'),
        'surface': floats.get('_Surface'),
        'srcBlend': floats.get('_SrcBlend'),
        'dstBlend': floats.get('_DstBlend'),
        'zWrite': floats.get('_ZWrite'),
        'useMatCap': floats.get('_UseMatCap'),
        'matCapIntensity': floats.get('_MatCapIntensity'),
        'baseColor': colors.get('_BaseColor') or colors.get('_Color'),
        'baseMap': base_map,
        'ints': {key: ints[key] for key in sorted(ints) if key in {'_Surface', '_SrcBlend', '_DstBlend', '_ZWrite'}},
    }
    web = None
    exact_mismatches: list[dict[str, Any]] = []
    texture_observation: dict[str, Any] | None = None
    if binding is not None:
        web = {
            'shading': binding.get('shading'),
            'baseMapUrl': binding.get('baseMapUrl'),
            'smoothness': binding.get('smoothness'),
            'unlitness': binding.get('unlitness'),
            'alphaTest': binding.get('alphaTest'),
            'transparent': binding.get('transparent'),
            'matCapMapUrl': binding.get('matCapMapUrl'),
            'matCapIntensity': binding.get('matCapIntensity'),
            'castShadow': binding.get('castShadow'),
            'receiveShadow': binding.get('receiveShadow'),
            'side': binding.get('side'),
            'multiUvScroll': binding.get('multiUvScroll'),
        }
        for label, official_key, web_key in (
            ('smoothness', 'smoothness', 'smoothness'),
            ('unlitness', 'unlitness', 'unlitness'),
            ('alphaClipThreshold', 'alphaClipThreshold', 'alphaTest'),
            ('matCapIntensity', 'matCapIntensity', 'matCapIntensity'),
        ):
            ov = official.get(official_key)
            wv = web.get(web_key)
            if ov is not None and wv is not None and ov != wv:
                exact_mismatches.append({'field': label, 'official': ov, 'web': wv})
        if base_map:
            local_name = base_map.get('resolvedLocalTextureName')
            url_base = basename_without_extension(binding.get('baseMapUrl'))
            texture_observation = {
                'officialFileId': base_map.get('fileId'),
                'officialPathId': base_map.get('pathId'),
                'officialResolvedLocalTextureName': local_name,
                'webBaseMapUrl': binding.get('baseMapUrl'),
                'webBaseName': url_base,
                'localNameMatchesWebBasename': (
                    normalize_name(local_name) == normalize_name(url_base)
                    if local_name and url_base else None
                ),
                'note': (
                    'Exact name comparison is possible only when the official PPtr resolves locally; '
                    'external PPtrs remain unresolved until their current-JP dependency bundle is loaded.'
                ),
            }
    return {
        'official': official,
        'web': web,
        'exactScalarMismatches': exact_mismatches,
        'textureObservation': texture_observation,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--viewer-catalog', type=Path, required=True)
    parser.add_argument('--viewer-ref', required=True)
    args = parser.parse_args()

    official = json.loads(OFFICIAL.read_text(encoding='utf-8'))
    viewer = json.loads(args.viewer_catalog.read_text(encoding='utf-8'))
    official_materials = [item for item in official.get('materials') or [] if isinstance(item, dict) and item.get('name')]
    bindings = [item for item in viewer.get('materialBindings') or [] if isinstance(item, dict) and item.get('materialName')]
    official_by_name = {normalize_name(item['name']): item for item in official_materials}
    web_by_name = {normalize_name(item['materialName']): item for item in bindings}

    official_names = sorted(official_by_name)
    web_names = sorted(web_by_name)
    missing = [official_by_name[name]['name'] for name in official_names if name not in web_by_name]
    extra = [web_by_name[name]['materialName'] for name in web_names if name not in official_by_name]
    matched = []
    for name in sorted(set(official_by_name) & set(web_by_name)):
        material = official_by_name[name]
        binding = web_by_name[name]
        matched.append({
            'material': material['name'],
            'binding': binding['materialName'],
            **comparable(material, binding),
        })

    report = {
        'schemaVersion': 1,
        'source': 'official-jp-current-608-vs-release-magius3dviewer',
        'officialAssetBundleRevision': (official.get('metadata') or {}).get('assetBundleRevision'),
        'officialBundle': official.get('bundle'),
        'viewerRef': args.viewer_ref,
        'viewerCatalogId': viewer.get('id'),
        'officialMaterialCount': len(official_materials),
        'webBindingCount': len(bindings),
        'missingBindingsExactByMaterialName': missing,
        'extraBindingsExactByMaterialName': extra,
        'matchedCount': len(matched),
        'matched': matched,
        'interpretation': {
            'exact': (
                'Material-name presence and serialized scalar values are exact current-JP-vs-Web comparisons.'
            ),
            'deferred': (
                'Shader semantic equivalence, external texture identity, render-state derivation and scene-state '
                'activation are not inferred from names alone; those remain deferred until their dependency/dataflow is resolved.'
            ),
        },
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'viewerRef': args.viewer_ref,
        'officialMaterialCount': report['officialMaterialCount'],
        'webBindingCount': report['webBindingCount'],
        'missingBindings': missing,
        'extraBindings': extra,
        'scalarMismatchCount': sum(len(item['exactScalarMismatches']) for item in matched),
        'scalarMismatches': [
            {'material': item['material'], 'mismatches': item['exactScalarMismatches']}
            for item in matched if item['exactScalarMismatches']
        ],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
