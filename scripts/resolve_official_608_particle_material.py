#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
TARGET_MATERIAL_PATH_ID = -439672645568008899
OUTPUT = Path('research/official-608-particle-material.json')


def ptr_dict(value: Any):
    if value is None:
        return None
    if isinstance(value, dict):
        return {
            'fileId': int(value.get('m_FileID', 0)),
            'pathId': int(value.get('m_PathID', 0)),
        }
    return {
        'fileId': int(getattr(value, 'm_FileID', 0) or 0),
        'pathId': int(getattr(value, 'm_PathID', 0) or 0),
    }


def pairs(value: Any):
    if isinstance(value, dict):
        return list(value.items())
    result = []
    if value is None:
        return result
    for item in value:
        if isinstance(item, (tuple, list)) and len(item) == 2:
            result.append((item[0], item[1]))
        elif hasattr(item, 'first') and hasattr(item, 'second'):
            result.append((item.first, item.second))
    return result


def texture_record(texture: Any, reader: Any):
    image = None
    image_error = None
    try:
        image = texture.image.convert('RGBA')
    except Exception as exc:
        image_error = repr(exc)
    result = {
        'name': str(getattr(texture, 'm_Name', '')),
        'type': type(texture).__name__,
        'width': getattr(texture, 'm_Width', None),
        'height': getattr(texture, 'm_Height', None),
        'textureFormat': int(getattr(texture, 'm_TextureFormat', 0) or 0),
        'sourceSerializedFile': str(getattr(getattr(reader, 'assets_file', None), 'name', '')),
        'imageDecodeError': image_error,
    }
    if image is not None:
        result['pixelSha256'] = hashlib.sha256(image.tobytes()).hexdigest()
        result['averageRgba8'] = [
            sum(pixel[channel] for pixel in image.getdata()) / (image.width * image.height)
            for channel in range(4)
        ]
    return result


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-608-particle-material-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        selected = [entry for entry in entries if entry.full_path.lower() == TARGET_BUNDLE]
        if len(selected) != 1:
            raise RuntimeError(f'expected one stage bundle, got {len(selected)}')
        bundle_path = base.download(selected[0], request_headers, token, temp)
        env = UnityPy.load(str(bundle_path))

        reader = next(
            (
                obj for obj in env.objects
                if int(getattr(obj, 'path_id', 0) or 0) == TARGET_MATERIAL_PATH_ID
                and str(getattr(getattr(obj, 'type', None), 'name', '')) == 'Material'
            ),
            None,
        )
        if reader is None:
            raise RuntimeError(f'particle Material PathID {TARGET_MATERIAL_PATH_ID} was not found')
        material = reader.read()
        tree = reader.read_typetree()
        saved = getattr(material, 'm_SavedProperties', None)
        tex_envs = []
        resolved_textures = []
        for key, env_value in pairs(getattr(saved, 'm_TexEnvs', None)):
            pointer = getattr(env_value, 'm_Texture', None)
            p = ptr_dict(pointer)
            item = {'property': str(key), 'pointer': p}
            if pointer is not None and p and p['pathId']:
                try:
                    texture = pointer.read()
                except Exception as exc:
                    item['resolveError'] = repr(exc)
                else:
                    texture_reader = next(
                        (
                            obj for obj in env.objects
                            if int(getattr(obj, 'path_id', 0) or 0) == p['pathId']
                            and str(getattr(getattr(obj, 'type', None), 'name', '')) in {'Texture2D', 'Cubemap'}
                        ),
                        None,
                    )
                    record = texture_record(texture, texture_reader) if texture_reader is not None else {
                        'name': str(getattr(texture, 'm_Name', '')),
                        'type': type(texture).__name__,
                    }
                    item['resolvedTexture'] = record
                    resolved_textures.append(record)
            tex_envs.append(item)

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-root-stage-bundle',
            'metadata': metadata,
            'bundle': TARGET_BUNDLE,
            'material': {
                'name': str(getattr(material, 'm_Name', '')),
                'pathId': TARGET_MATERIAL_PATH_ID,
                'shader': ptr_dict(getattr(material, 'm_Shader', None)),
                'validKeywords': list(getattr(material, 'm_ValidKeywords', []) or []),
                'invalidKeywords': list(getattr(material, 'm_InvalidKeywords', []) or []),
                'renderQueue': getattr(material, 'm_CustomRenderQueue', None),
                'texEnvs': tex_envs,
                'floats': base.jsonable(getattr(saved, 'm_Floats', None)),
                'ints': base.jsonable(getattr(saved, 'm_Ints', None)),
                'colors': base.jsonable(getattr(saved, 'm_Colors', None)),
                'typetree': base.jsonable(tree),
            },
            'resolvedTextureCount': len(resolved_textures),
            'resolvedTextures': resolved_textures,
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'material': report['material']['name'],
            'validKeywords': report['material']['validKeywords'],
            'renderQueue': report['material']['renderQueue'],
            'texEnvs': tex_envs,
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
