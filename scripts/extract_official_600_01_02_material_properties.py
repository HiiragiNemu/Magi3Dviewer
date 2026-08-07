#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_600_00_01_002'
TARGET_TOKENS = ('bg3d600a_01_02', '600a_01_02')


def jsonable(value: Any) -> Any:
    return base.jsonable(value)


def pointer_dict(value: Any) -> tuple[int, int] | None:
    if not isinstance(value, dict): return None
    try: return int(value.get('m_FileID', 0)), int(value.get('m_PathID', 0))
    except Exception: return None


def tex_env_summary(saved: dict[str, Any] | None, textures_by_path: dict[int, str]):
    if not isinstance(saved, dict): return []
    result = []
    for item in saved.get('m_TexEnvs') or []:
        if not isinstance(item, (list, tuple)) or len(item) != 2: continue
        key, env = item
        env = env if isinstance(env, dict) else {}
        file_id, path_id = pointer_dict(env.get('m_Texture')) or (0, 0)
        result.append({
            'property': str(key), 'fileId': file_id, 'pathId': path_id,
            'resolvedLocalTextureName': textures_by_path.get(path_id) if file_id == 0 else None,
            'scale': jsonable(env.get('m_Scale')), 'offset': jsonable(env.get('m_Offset')),
        })
    return result


def main() -> int:
    output = Path('research/official-600-01-02-material-properties.json')
    with tempfile.TemporaryDirectory(prefix='magius-600-material-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        selected = [e for e in entries if e.full_path.lower() == TARGET_BUNDLE.lower()]
        if len(selected) != 1:
            raise RuntimeError(f'expected exactly one {TARGET_BUNDLE!r}, got {len(selected)}')
        bundle_path = base.download(selected[0], request_headers, token, temp)
        env = UnityPy.load(str(bundle_path))

        textures_by_path = {}
        textures = []
        for obj in env.objects:
            type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
            if type_name not in {'Texture2D', 'Cubemap'}: continue
            try: tree = obj.read_typetree()
            except Exception as exc: tree = {'typetreeError': repr(exc)}
            name = str(tree.get('m_Name', '')) if isinstance(tree, dict) else ''
            path_id = int(getattr(obj, 'path_id', 0) or 0)
            textures_by_path[path_id] = name
            textures.append({
                'type': type_name, 'name': name, 'pathId': path_id,
                'width': tree.get('m_Width') if isinstance(tree, dict) else None,
                'height': tree.get('m_Height') if isinstance(tree, dict) else None,
                'textureFormat': tree.get('m_TextureFormat') if isinstance(tree, dict) else None,
            })

        materials = []
        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Material': continue
            try: tree = obj.read_typetree()
            except Exception as exc:
                materials.append({'pathId': int(obj.path_id), 'typetreeError': repr(exc)})
                continue
            if not isinstance(tree, dict): continue
            name = str(tree.get('m_Name', ''))
            if not any(token in name.lower() for token in TARGET_TOKENS): continue
            saved = tree.get('m_SavedProperties')
            materials.append({
                'name': name, 'pathId': int(getattr(obj, 'path_id', 0) or 0),
                'shader': jsonable(tree.get('m_Shader')),
                'validKeywords': jsonable(tree.get('m_ValidKeywords')),
                'invalidKeywords': jsonable(tree.get('m_InvalidKeywords')),
                'renderQueue': tree.get('m_CustomRenderQueue'),
                'doubleSidedGI': tree.get('m_DoubleSidedGI'),
                'texEnvs': tex_env_summary(saved if isinstance(saved, dict) else None, textures_by_path),
                'floats': jsonable(saved.get('m_Floats') if isinstance(saved, dict) else None),
                'ints': jsonable(saved.get('m_Ints') if isinstance(saved, dict) else None),
                'colors': jsonable(saved.get('m_Colors') if isinstance(saved, dict) else None),
            })
        if not materials: raise RuntimeError('600-01-02 bundle parsed but no target materials found')
        report = {
            'schemaVersion': 1, 'source': 'official-jp-current-assetbundle',
            'metadata': metadata, 'bundle': TARGET_BUNDLE,
            'textureCount': len(textures), 'textures': sorted(textures, key=lambda x: (x['type'], x['name'].lower())),
            'materialCount': len(materials), 'materials': sorted(materials, key=lambda x: str(x.get('name','')).lower()),
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'revision': report['metadata'].get('assetBundleRevision'),
        'materialCount': report['materialCount'],
        'materials': [m.get('name') for m in report['materials']],
    }, ensure_ascii=False, indent=2))
    return 0

if __name__ == '__main__': raise SystemExit(main())
