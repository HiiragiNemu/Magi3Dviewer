#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

REPORT = Path('research/official-600-01-02-material-properties.json')
CATALOG = Path('public/stages/catalog.json')
OUT = Path('research/official-600-01-02-material-summary.json')

FLOAT_KEYS = {
    '_Surface','_ZWrite','_Cull','_AlphaToMask','_AlphaClip','_Alpha_Clip',
    '_SrcBlend','_DstBlend','_Smoothness','_Unlitness','_Metallic',
    '_UseFlipbook','_FlipbookFrameRate','_FlipbookOffset','_USE_BILLBOARD',
    '_USE_VERTEX_COLOR_BLEND','_VertexColorBlendMode','_BlendTexScale',
    '_Blend2ndTexScale','_UseLightMap','_USE_LIGHTMAP','_UseMatcap',
    '_UseMatCap','_MatCapIntensity','_UseUV2','_UseUV3','_NormalStrength',
    '_ReceiveShadows','_CastShadows','_ReflectionValue','_FogInfluence',
}
TEX_KEYS = {'_BaseMap','_MainTex','_BlendTex','_Blend2ndTex','_MatCapTex','_NormalMap'}
COLOR_KEYS = {
    '_BaseColor','_BlendColor','_Blend2ndColor','_MatCapColor','_EmissionColor',
    '_FlipbookTileGrid',
}


def pairs_to_dict(value):
    out = {}
    for pair in value or []:
        if isinstance(pair, list) and len(pair) == 2:
            out[str(pair[0])] = pair[1]
    return out


def side_from_cull(value):
    if value == 0: return 'double'
    if value == 1: return 'back'
    return 'front'


def expected_runtime(floats):
    expected = {
        'transparent': floats.get('_Surface', 0) > 0.5,
        'depthWrite': floats.get('_ZWrite', 1) > 0.5,
        'side': side_from_cull(floats.get('_Cull', 2)),
        'alphaToCoverage': floats.get('_AlphaToMask', 0) > 0.5,
        'castShadow': floats.get('_CastShadows', 1) > 0.5,
        'receiveShadow': floats.get('_ReceiveShadows', 1) > 0.5,
        'unlitness': floats.get('_Unlitness', 0),
        'smoothness': floats.get('_Smoothness', 0.5),
    }
    if floats.get('_AlphaClip', 0) > 0.5:
        expected['alphaTest'] = floats.get('_Alpha_Clip', 0.5)
    if floats.get('_UseFlipbook', 0) > 0.5:
        expected['framesPerSecond'] = floats.get('_FlipbookFrameRate', 0)
        expected['offset'] = int(floats.get('_FlipbookOffset', 0))
    return expected


def runtime_value(binding, key):
    defaults = {
        'transparent': False,
        'depthWrite': True,
        'side': 'front',
        'alphaToCoverage': False,
        'castShadow': True,
        'receiveShadow': True,
        'unlitness': 0,
        'smoothness': 0.5,
    }
    if key in ('framesPerSecond','offset'):
        return (binding.get('atlas') or {}).get(key)
    return binding[key] if key in binding else defaults.get(key)


def main():
    report = json.loads(REPORT.read_text(encoding='utf-8'))
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    stages = catalog.get('stages', []) if isinstance(catalog, dict) else catalog
    stage = next((x for x in stages if x.get('id') == 'battle-600-00-01-002'), None)
    if stage is None:
        raise SystemExit('catalog stage battle-600-00-01-002 not found')
    bindings = {x.get('materialName'): x for x in stage.get('materialBindings', [])}
    materials = []
    deltas = []
    for material in report['materials']:
        floats = pairs_to_dict(material.get('floats'))
        colors = pairs_to_dict(material.get('colors'))
        tex = {
            x['property']: {
                'fileId': x.get('fileId'), 'pathId': x.get('pathId'),
                'resolvedLocalTextureName': x.get('resolvedLocalTextureName'),
                'scale': x.get('scale'), 'offset': x.get('offset'),
            }
            for x in material.get('texEnvs', [])
            if x.get('property') in TEX_KEYS
        }
        binding = bindings.get(material['name'])
        expected = expected_runtime(floats)
        mismatch = {}
        if binding is None:
            mismatch['binding'] = {'expected': 'present', 'actual': None}
        else:
            for key, expected_value in expected.items():
                actual = runtime_value(binding, key)
                if isinstance(expected_value, float) and isinstance(actual, (int,float)):
                    if abs(expected_value - actual) <= 1e-6: continue
                elif actual == expected_value:
                    continue
                mismatch[key] = {'expected': expected_value, 'actual': actual}
        if mismatch:
            deltas.append({'name': material['name'], 'mismatch': mismatch})
        materials.append({
            'name': material['name'],
            'renderQueue': material.get('renderQueue'),
            'validKeywords': material.get('validKeywords'),
            'floats': {k: floats[k] for k in sorted(FLOAT_KEYS) if k in floats},
            'colors': {k: colors[k] for k in sorted(COLOR_KEYS) if k in colors},
            'textures': tex,
            'currentWebBinding': binding,
            'runtimeDelta': mismatch,
        })
    out = {
        'schemaVersion': 1,
        'sourceRevision': report['metadata']['assetBundleRevision'],
        'unityVersion': report['metadata']['unityVersion'],
        'stageCurrentStatus': stage.get('dynamic'),
        'materialCount': len(materials),
        'deltaCount': len(deltas),
        'deltas': deltas,
        'materials': materials,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'output': str(OUT), 'materialCount': len(materials),
        'deltaCount': len(deltas), 'deltas': deltas,
        'names': [x['name'] for x in materials],
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
