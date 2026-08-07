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

TARGET_BUNDLE = 'battle/character/chara_100101_battle_unit'
TARGET_MATERIALS = {
    'mt_chara_100101_body_sj',
    'mt_chara_100101_weapon_a_sj',
}
OUTPUT = Path('research/official-100101-matcap-resolution.json')


def normalized_name(name: str) -> str:
    return name.strip().replace('\x00\x01', '::').removesuffix('::Material').lower()


def iter_tex_envs(material: Any):
    saved = getattr(material, 'm_SavedProperties', None)
    values = getattr(saved, 'm_TexEnvs', None) if saved is not None else None
    if values is None:
        return
    if isinstance(values, dict):
        yield from values.items()
        return
    for item in values:
        if isinstance(item, (tuple, list)) and len(item) == 2:
            yield item[0], item[1]
        elif hasattr(item, 'first') and hasattr(item, 'second'):
            yield item.first, item.second


def external_table(obj: Any) -> list[dict[str, Any]]:
    assets_file = getattr(obj, 'assets_file', None)
    externals = list(getattr(assets_file, 'externals', []) or [])
    if not externals:
        externals = list(getattr(assets_file, 'm_Externals', []) or [])
    result = []
    for index, value in enumerate(externals, 1):
        result.append({
            'fileId': index,
            'path': str(
                getattr(value, 'path', None)
                or getattr(value, 'm_PathName', None)
                or getattr(value, 'path_name', None)
                or ''
            ),
            'name': str(
                getattr(value, 'name', None)
                or getattr(value, 'm_AssetPath', None)
                or getattr(value, 'asset_path', None)
                or ''
            ),
            'guid': repr(getattr(value, 'guid', None) or getattr(value, 'm_GUID', None)),
        })
    return result


def internal_serialized_files(env: Any) -> list[dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for obj in env.objects:
        assets_file = getattr(obj, 'assets_file', None)
        if assets_file is None:
            continue
        name = str(getattr(assets_file, 'name', ''))
        if not name or name in records:
            continue
        records[name] = {
            'name': name,
            'objectCount': len(getattr(assets_file, 'objects', {}) or {}),
        }
    return sorted(records.values(), key=lambda item: item['name'].lower())


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-100101-matcap-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        target_entries = [
            entry for entry in entries
            if entry.full_path.replace('\\', '/').strip('/').lower() == TARGET_BUNDLE
        ]
        if len(target_entries) != 1:
            raise RuntimeError(f'expected one {TARGET_BUNDLE}, got {len(target_entries)}')

        # The ReDrive Shader PPtr for these same Materials resolves when the
        # character bundle is loaded with the current JP shader/ subtree. Probe
        # the MatCap PPtr in that exact bounded workspace before broadening the
        # dependency search. This does not assume TW/JP bundle naming parity.
        shader_entries = [
            entry for entry in entries
            if entry.full_path.lower().startswith(('shader/', 'shaders/'))
        ]
        selected = sorted(
            {entry.full_path: entry for entry in [*target_entries, *shader_entries]}.values(),
            key=lambda item: item.full_path,
        )
        if len(selected) > 80:
            raise RuntimeError(f'unexpectedly broad shader probe workspace: {len(selected)}')

        downloaded = [base.download(entry, request_headers, token, temp) for entry in selected]
        env = UnityPy.load(*(str(path) for path in downloaded))
        serialized_files = internal_serialized_files(env)
        results = []
        target_external_tables = []

        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Material':
                continue
            try:
                material = obj.read()
            except Exception:
                continue
            name = normalized_name(str(getattr(material, 'm_Name', '')))
            if name not in TARGET_MATERIALS:
                continue
            table = external_table(obj)
            target_external_tables.append({
                'material': name,
                'sourceSerializedFile': str(getattr(getattr(obj, 'assets_file', None), 'name', '')),
                'externals': table,
            })
            for key, tex_env in iter_tex_envs(material):
                if str(key) != '_MatCapTex':
                    continue
                pointer = getattr(tex_env, 'm_Texture', None)
                file_id = int(getattr(pointer, 'm_FileID', 0) or 0) if pointer is not None else 0
                path_id = int(getattr(pointer, 'm_PathID', 0) or 0) if pointer is not None else 0
                pointer_info = {'fileId': file_id, 'pathId': path_id}
                referenced_external = next(
                    (item for item in table if item['fileId'] == file_id),
                    None,
                )
                texture = None
                error = None
                try:
                    texture = pointer.read() if pointer is not None else None
                except Exception as exc:
                    error = repr(exc)
                resolved = None
                if texture is not None:
                    image_info = None
                    try:
                        image = texture.image.convert('RGBA')
                    except Exception as exc:
                        image_info = {'decodeError': repr(exc)}
                    else:
                        pixels = image.tobytes()
                        image_info = {
                            'width': image.width,
                            'height': image.height,
                            'mode': image.mode,
                            'pixelSha256': hashlib.sha256(pixels).hexdigest(),
                        }
                    reader = getattr(texture, 'object_reader', None)
                    resolved = {
                        'name': str(getattr(texture, 'm_Name', '')),
                        'type': type(texture).__name__,
                        'width': getattr(texture, 'm_Width', None),
                        'height': getattr(texture, 'm_Height', None),
                        'textureFormat': int(getattr(texture, 'm_TextureFormat', 0) or 0),
                        'sourceSerializedFile': str(getattr(getattr(reader, 'assets_file', None), 'name', '')),
                        'image': image_info,
                    }
                results.append({
                    'material': name,
                    'pointer': pointer_info,
                    'referencedExternal': referenced_external,
                    'resolveError': error,
                    'resolvedTexture': resolved,
                })

        if not results:
            raise RuntimeError('no target MatCap texture environments were found')
        report = {
            'schemaVersion': 2,
            'source': 'official-jp-character-plus-shader-probe-workspace',
            'metadata': metadata,
            'targetBundle': TARGET_BUNDLE,
            'shaderBundleCount': len(shader_entries),
            'downloadedBundleCount': len(selected),
            'downloadedBundles': [entry.full_path for entry in selected],
            'loadedSerializedFiles': serialized_files,
            'targetExternalTables': target_external_tables,
            'matCaps': results,
            'allResolved': all(item['resolvedTexture'] is not None for item in results),
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'shaderBundleCount': report['shaderBundleCount'],
            'loadedSerializedFileCount': len(serialized_files),
            'matCaps': results,
            'allResolved': report['allResolved'],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
