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
COLOR_KEYS = {'_BaseColor','_BlendColor','_Blend2ndColor','_MatCapColor','_EmissionColor'}


def pairs_to_dict(value):
    out = {}
    for pair in value or []:
        if isinstance(pair, list) and len(pair) == 2:
            out[str(pair[0])] = pair[1]
    return out


def main():
    report = json.loads(REPORT.read_text(encoding='utf-8'))
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    stage = next((x for x in catalog if x.get('id') == 'battle-600-00-01-002'), None)
    if stage is None:
        raise SystemExit('catalog stage battle-600-00-01-002 not found')
    bindings = {x.get('materialName'): x for x in stage.get('materialBindings', [])}
    materials = []
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
        materials.append({
            'name': material['name'],
            'renderQueue': material.get('renderQueue'),
            'validKeywords': material.get('validKeywords'),
            'floats': {k: floats[k] for k in sorted(FLOAT_KEYS) if k in floats},
            'colors': {k: colors[k] for k in sorted(COLOR_KEYS) if k in colors},
            'textures': tex,
            'currentWebBinding': bindings.get(material['name']),
        })
    out = {
        'schemaVersion': 1,
        'sourceRevision': report['metadata']['assetBundleRevision'],
        'unityVersion': report['metadata']['unityVersion'],
        'stageCurrentStatus': stage.get('dynamic'),
        'materialCount': len(materials),
        'materials': materials,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'output': str(OUT), 'materialCount': len(materials),
        'names': [x['name'] for x in materials],
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
