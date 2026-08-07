#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

import UnityPy
from PIL import Image

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base
import resolve_official_608_particle_texture as closure

ROOT = Path(__file__).resolve().parents[1]
TARGET_STAGE_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
MATERIAL_REPORT = ROOT / 'research' / 'official-608-material-properties.json'
EXTERNAL_REPORT = ROOT / 'research' / 'official-608-external-files.json'
WEB_CATALOG = ROOT / 'public' / 'stages' / 'catalog' / 'battle-608-00-00-001.json'
OUTPUT = ROOT / 'research' / 'official-608-material-texture-resolution.json'
TARGET_PROPERTIES = {'_BaseMap', '_MainTex', '_ScrollTexture', '_ScrollTexutre'}


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def internal_file_name(obj: Any) -> str:
    value = str(getattr(getattr(obj, 'assets_file', None), 'name', ''))
    return value.replace('\\', '/').rsplit('/', 1)[-1].lower()


def web_texture(url: str | None) -> dict[str, Any] | None:
    if not url:
        return None
    relative = url.strip()
    if relative.startswith('./'):
        relative = relative[2:]
    path = ROOT / 'public' / relative
    if not path.is_file():
        return {'url': url, 'exists': False}
    with Image.open(path) as image:
        rgba = image.convert('RGBA')
        return {
            'url': url,
            'exists': True,
            'size': list(rgba.size),
            'pixelSha256': sha256(rgba.tobytes()),
            'pngSha256': sha256(path.read_bytes()),
        }


def main() -> int:
    material_report = json.loads(MATERIAL_REPORT.read_text(encoding='utf-8'))
    external_report = json.loads(EXTERNAL_REPORT.read_text(encoding='utf-8'))
    catalog = json.loads(WEB_CATALOG.read_text(encoding='utf-8'))

    current_revision = material_report['metadata']['assetBundleRevision']
    if external_report['metadata']['assetBundleRevision'] != current_revision:
        raise RuntimeError('external-file report revision does not match Material report')

    external_rows = external_report.get('materials') or []
    if not external_rows:
        raise RuntimeError('external-file report has no material records')
    externals = external_rows[0].get('externals') or []
    external_by_file_id = {
        int(row['fileId']): str(row['name']).lower()
        for row in externals
    }

    material_targets: list[dict[str, Any]] = []
    for material in material_report.get('materials') or []:
        textures = []
        for tex in material.get('texEnvs') or []:
            if tex.get('property') not in TARGET_PROPERTIES:
                continue
            file_id = int(tex.get('fileId') or 0)
            path_id = int(tex.get('pathId') or 0)
            if path_id == 0:
                continue
            textures.append({
                'property': str(tex.get('property')),
                'fileId': file_id,
                'pathId': str(path_id),
                'scale': tex.get('scale'),
                'offset': tex.get('offset'),
            })
        material_targets.append({
            'material': str(material.get('name') or ''),
            'textures': textures,
        })

    with tempfile.TemporaryDirectory(prefix='magius-608-material-textures-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        if metadata.get('assetBundleRevision') != current_revision:
            raise RuntimeError(
                f'current JP AssetBundle revision changed: evidence={current_revision}, catalog={metadata.get("assetBundleRevision")}'
            )
        by_name = {closure.normalize_name(entry.full_path).lower(): entry for entry in entries}
        dependencies, _record = closure.current_dependencies(metadata)
        order = [TARGET_STAGE_BUNDLE, *dependencies]
        selected_entries = []
        for name in order:
            entry = by_name.get(name.lower())
            if entry is None:
                raise RuntimeError(f'current JP closure dependency missing from catalog: {name}')
            selected_entries.append(entry)

        paths = [
            (entry, base.download(entry, request_headers, token, temp))
            for entry in selected_entries
        ]

        root_local: dict[int, tuple[Any, Any]] = {}
        closure_objects: dict[tuple[str, int], tuple[Any, Any]] = {}
        for entry, path in paths:
            env = UnityPy.load(str(path))
            is_root = closure.normalize_name(entry.full_path).lower() == TARGET_STAGE_BUNDLE.lower()
            for obj in env.objects:
                path_id = int(getattr(obj, 'path_id', 0) or 0)
                cab = internal_file_name(obj)
                closure_objects[(cab, path_id)] = (entry, obj)
                if is_root:
                    root_local[path_id] = (entry, obj)

        decoded_cache: dict[tuple[int, int], dict[str, Any]] = {}

        def resolve(file_id: int, path_id: int) -> dict[str, Any]:
            key = (file_id, path_id)
            cached = decoded_cache.get(key)
            if cached is not None:
                return cached
            if file_id == 0:
                match = root_local.get(path_id)
                target_cab = None
            else:
                target_cab = external_by_file_id.get(file_id)
                match = closure_objects.get((target_cab or '', path_id))
            if match is None:
                result = {
                    'fileId': file_id,
                    'pathId': str(path_id),
                    'targetCab': target_cab,
                    'resolved': False,
                }
                decoded_cache[key] = result
                return result
            entry, obj = match
            type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
            tree = obj.read_typetree()
            result: dict[str, Any] = {
                'fileId': file_id,
                'pathId': str(path_id),
                'targetCab': target_cab or internal_file_name(obj),
                'resolved': True,
                'sourceBundle': entry.full_path,
                'type': type_name,
                'name': str(tree.get('m_Name', '')) if isinstance(tree, dict) else '',
            }
            if type_name in {'Texture2D', 'Cubemap'}:
                texture = obj.read()
                image = getattr(texture, 'image', None)
                if image is not None:
                    rgba = image.convert('RGBA')
                    result.update({
                        'size': list(rgba.size),
                        'pixelSha256': sha256(rgba.tobytes()),
                    })
                if isinstance(tree, dict):
                    result.update({
                        'width': tree.get('m_Width'),
                        'height': tree.get('m_Height'),
                        'textureFormat': tree.get('m_TextureFormat'),
                        'colorSpace': tree.get('m_ColorSpace'),
                    })
            decoded_cache[key] = result
            return result

        official_materials = []
        for material in material_targets:
            resolved = []
            for tex in material['textures']:
                pointer = resolve(int(tex['fileId']), int(tex['pathId']))
                resolved.append({**tex, 'resolvedTexture': pointer})
            official_materials.append({
                'material': material['material'],
                'textures': resolved,
            })

    web_bindings = {
        str(binding.get('materialName')): binding
        for binding in catalog.get('materialBindings') or []
        if binding.get('materialName')
    }
    comparisons = []
    for material in official_materials:
        name = material['material']
        binding = web_bindings.get(name)
        official_base = next(
            (row for row in material['textures'] if row['property'] == '_BaseMap'),
            None,
        )
        official_main = next(
            (row for row in material['textures'] if row['property'] == '_MainTex'),
            None,
        )
        web_base = web_texture(binding.get('baseMapUrl')) if binding else None
        official_base_hash = (
            official_base.get('resolvedTexture', {}).get('pixelSha256')
            if official_base else None
        )
        web_hash = web_base.get('pixelSha256') if isinstance(web_base, dict) else None
        comparisons.append({
            'material': name,
            'webBindingPresent': binding is not None,
            'officialBaseMap': official_base,
            'officialMainTex': official_main,
            'baseAndMainSamePointer': (
                official_base is not None and official_main is not None
                and official_base['fileId'] == official_main['fileId']
                and official_base['pathId'] == official_main['pathId']
            ),
            'webBaseMap': web_base,
            'baseMapPixelMatch': (
                official_base_hash == web_hash
                if official_base_hash and web_hash else None
            ),
        })

    mismatches = [row for row in comparisons if row['baseMapPixelMatch'] is False]
    unresolved = [
        {
            'material': material['material'],
            'property': tex['property'],
            'pointer': {'fileId': tex['fileId'], 'pathId': tex['pathId']},
        }
        for material in official_materials
        for tex in material['textures']
        if not tex['resolvedTexture'].get('resolved')
    ]
    report = {
        'schemaVersion': 1,
        'source': 'official-jp-current-assetbundle-catalog-dependencies-vs-public-viewer-pixels',
        'metadata': material_report['metadata'],
        'bundle': TARGET_STAGE_BUNDLE,
        'materialCount': len(official_materials),
        'comparisonCount': len(comparisons),
        'baseMapPixelMismatchCount': len(mismatches),
        'unresolvedTexturePointerCount': len(unresolved),
        'baseMapPixelMismatches': mismatches,
        'unresolvedTexturePointers': unresolved,
        'comparisons': comparisons,
        'privacyBoundary': (
            'Raw current-JP AssetBundles remain transient. Only bounded texture dependency names, dimensions and decoded pixel hashes are persisted.'
        ),
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'materialCount': report['materialCount'],
        'baseMapPixelMismatchCount': report['baseMapPixelMismatchCount'],
        'unresolvedTexturePointerCount': report['unresolvedTexturePointerCount'],
        'baseMapPixelMismatches': [
            {
                'material': row['material'],
                'official': row['officialBaseMap']['resolvedTexture'].get('name') if row.get('officialBaseMap') else None,
                'officialHash': row['officialBaseMap']['resolvedTexture'].get('pixelSha256') if row.get('officialBaseMap') else None,
                'web': row['webBaseMap'],
            }
            for row in mismatches
        ],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
