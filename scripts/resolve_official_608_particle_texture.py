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

TARGET_STAGE_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
TARGET_CAB = 'cab-45fe6895e0364350e5df2d082222970e'
TARGET_TEXTURE_PATH_ID = -70738714532392232
DISCOVERY = Path('research/official-jp-assetbundle-manifest-discovery.json')
OUTPUT_JSON = Path('research/official-608-particle-texture.json')
OUTPUT_PNG = Path('research/official-608-blue-bubble.png')
EXPECTED_STAGE_BUNDLE_COUNT = 15
EXPECTED_DEPENDENCY_COUNT = 14


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalize_name(value: Any) -> str:
    return str(value).replace('\\', '/').strip('/')


def internal_file_name(obj: Any) -> str:
    value = str(getattr(getattr(obj, 'assets_file', None), 'name', ''))
    return value.replace('\\', '/').rsplit('/', 1)[-1].lower()


def current_dependencies(metadata: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    report = json.loads(DISCOVERY.read_text(encoding='utf-8'))
    discovery_metadata = report.get('metadata') or {}
    current_revision = metadata.get('assetBundleRevision')
    discovery_revision = discovery_metadata.get('assetBundleRevision')
    if current_revision != discovery_revision:
        raise RuntimeError(
            'Bounded JP dependency discovery is stale: '
            f'catalog={current_revision}, discovery={discovery_revision}'
        )
    records = (((report.get('assetBundleCatalog') or {}).get('targetStageRecords')) or [])
    if len(records) != 1:
        raise RuntimeError(f'Expected one bounded current-JP 608 catalog record, found {len(records)}')
    record = records[0]
    if normalize_name(record.get('fullPath')) != TARGET_STAGE_BUNDLE:
        raise RuntimeError(f'Unexpected bounded stage record: {record.get("fullPath")!r}')
    raw = record.get('dependencies')
    if not isinstance(raw, str):
        raise TypeError(f'Current JP dependencies field is {type(raw).__name__}, expected str')
    dependencies = [normalize_name(value) for value in raw.split(',') if normalize_name(value)]
    if len(dependencies) != EXPECTED_DEPENDENCY_COUNT:
        raise RuntimeError(
            f'Current JP 608 dependency count changed: expected {EXPECTED_DEPENDENCY_COUNT}, got {len(dependencies)}'
        )
    if len(set(dependencies)) != len(dependencies):
        raise RuntimeError('Current JP 608 dependencies contain duplicates')
    return dependencies, record


def main() -> int:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='magius-608-particle-texture-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        by_name = {normalize_name(entry.full_path).lower(): entry for entry in entries}
        dependencies, bounded_record = current_dependencies(metadata)
        order = [TARGET_STAGE_BUNDLE, *dependencies]
        if len(order) != EXPECTED_STAGE_BUNDLE_COUNT:
            raise RuntimeError(
                f'Current JP 608 closure changed: expected {EXPECTED_STAGE_BUNDLE_COUNT}, got {len(order)}'
            )

        closure_entries = []
        missing = []
        for bundle_name in order:
            entry = by_name.get(bundle_name.lower())
            if entry is None:
                missing.append(bundle_name)
            else:
                closure_entries.append(entry)
        if missing:
            raise RuntimeError(f'Current JP 608 dependencies absent from catalog: {missing}')

        paths: list[tuple[Any, Path]] = [
            (entry, base.download(entry, request_headers, token, temp))
            for entry in closure_entries
        ]

        cab_sources: dict[str, str] = {}
        matches: list[tuple[Any, Any, Path]] = []
        per_bundle: list[dict[str, Any]] = []
        for entry, path in paths:
            env = UnityPy.load(str(path))
            internal_names = sorted({
                str(name).replace('\\', '/').rsplit('/', 1)[-1]
                for name in getattr(env, 'files', {}).keys()
            })
            for name in internal_names:
                cab_sources.setdefault(name.lower(), entry.full_path)
            object_count = 0
            for obj in env.objects:
                object_count += 1
                cab_name = internal_file_name(obj)
                if cab_name:
                    cab_sources.setdefault(cab_name, entry.full_path)
                if cab_name != TARGET_CAB:
                    continue
                if int(getattr(obj, 'path_id', 0) or 0) != TARGET_TEXTURE_PATH_ID:
                    continue
                type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
                if type_name != 'Texture2D':
                    raise RuntimeError(
                        f'Target CAB/pathID resolved to {type_name}, expected Texture2D'
                    )
                matches.append((entry, obj, path))
            per_bundle.append({
                'bundle': entry.full_path,
                'size': path.stat().st_size,
                'internalSerializedFiles': internal_names,
                'objectCount': object_count,
            })

        if len(matches) != 1:
            raise RuntimeError(
                f'Expected exactly one {TARGET_CAB}/{TARGET_TEXTURE_PATH_ID} Texture2D, found {len(matches)}; '
                f'CAB source={cab_sources.get(TARGET_CAB)}; knownCABs={len(cab_sources)}'
            )

        source_entry, obj, source_path = matches[0]
        tree = obj.read_typetree()
        if not isinstance(tree, dict):
            raise TypeError('Target Texture2D typetree is not a dictionary')
        texture = obj.read()
        image = texture.image
        if image is None:
            raise RuntimeError('Target Texture2D decoded without a PIL image')
        rgba = image.convert('RGBA')
        pixel_bytes = rgba.tobytes()
        rgba.save(OUTPUT_PNG, format='PNG', optimize=False)
        png_bytes = OUTPUT_PNG.read_bytes()

        report = {
            'schemaVersion': 2,
            'source': 'official-jp-current-assetbundle-catalog-dependencies',
            'metadata': metadata,
            'stage': {
                'rootBundle': TARGET_STAGE_BUNDLE,
                'dependencySource': 'current-JP GetResourceAssetBundleMstList.mstList.dependencies',
                'boundedCatalogRecord': bounded_record,
                'bundleCountIncludingRoot': len(order),
                'dependencyCount': len(dependencies),
                'dependencyOrder': dependencies,
                'totalDecryptedBytes': sum(path.stat().st_size for _, path in paths),
            },
            'targetPointer': {
                'externalFileId': 6,
                'serializedFile': TARGET_CAB,
                'pathId': TARGET_TEXTURE_PATH_ID,
            },
            'resolvedTexture': {
                'sourceBundle': source_entry.full_path,
                'sourceBundleSize': source_path.stat().st_size,
                'name': str(tree.get('m_Name', '')),
                'width': tree.get('m_Width'),
                'height': tree.get('m_Height'),
                'textureFormat': tree.get('m_TextureFormat'),
                'mipCount': tree.get('m_MipCount'),
                'imageCount': tree.get('m_ImageCount'),
                'dimension': tree.get('m_TextureDimension'),
                'colorSpace': tree.get('m_ColorSpace'),
                'decodedMode': rgba.mode,
                'decodedSize': list(rgba.size),
                'pixelSha256': sha256_bytes(pixel_bytes),
                'pngSha256': sha256_bytes(png_bytes),
                'pngBytes': len(png_bytes),
                'output': OUTPUT_PNG.as_posix(),
            },
            'closureBundleInventory': per_bundle,
            'privacyBoundary': (
                'Raw current-JP AssetBundles remain transient in the Actions temp directory. '
                'Only this bounded metadata report and the single decoded public-viewer texture are persisted.'
            ),
        }
        OUTPUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    print(json.dumps({
        'stageBundleCount': report['stage']['bundleCountIncludingRoot'],
        'dependencyCount': report['stage']['dependencyCount'],
        'targetPointer': report['targetPointer'],
        'resolvedTexture': report['resolvedTexture'],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
