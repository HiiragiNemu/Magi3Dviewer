#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import UnityPy
from PIL import Image

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base
import resolve_official_608_particle_texture as closure

TARGET_STAGE_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
WEB_CATALOG_PATH = Path('public/stages/catalog/battle-608-00-00-001.json')
OUTPUT_PATH = Path('research/stage-608-current-jp-texture-parity-evidence.json')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pixel_hash(image: Image.Image) -> str:
    return sha256(image.convert('RGBA').tobytes())


def transformed_hashes(image: Image.Image) -> dict[str, str]:
    rgba = image.convert('RGBA')
    return {
        'identity': pixel_hash(rgba),
        'flipY': pixel_hash(rgba.transpose(Image.Transpose.FLIP_TOP_BOTTOM)),
        'flipX': pixel_hash(rgba.transpose(Image.Transpose.FLIP_LEFT_RIGHT)),
        'flipXY': pixel_hash(
            rgba.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(
                Image.Transpose.FLIP_TOP_BOTTOM
            )
        ),
    }


def internal_file_name(obj: Any) -> str:
    value = str(getattr(getattr(obj, 'assets_file', None), 'name', ''))
    return value.replace('\\', '/').rsplit('/', 1)[-1].lower()


def repo_path_from_url(url: str) -> Path:
    value = url.strip()
    while value.startswith('./'):
        value = value[2:]
    if value.startswith('/') or '..' in Path(value).parts:
        raise RuntimeError(f'unsafe Viewer texture URL: {url}')
    result = Path('public') / value
    if result.suffix.lower() != '.png':
        raise RuntimeError(f'expected public PNG binding, got: {url}')
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo-root', type=Path, required=True)
    parser.add_argument('--material-report', type=Path, required=True)
    parser.add_argument('--external-report', type=Path, required=True)
    parser.add_argument('--expected-revision', required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.repo_root.resolve()
    material_report = json.loads(args.material_report.read_text(encoding='utf-8'))
    external_report = json.loads(args.external_report.read_text(encoding='utf-8'))

    evidence_revision = str((material_report.get('metadata') or {}).get('assetBundleRevision'))
    if evidence_revision != args.expected_revision:
        raise RuntimeError(
            f'material evidence revision mismatch: {evidence_revision} != {args.expected_revision}'
        )
    external_revision = str((external_report.get('metadata') or {}).get('assetBundleRevision'))
    if external_revision != evidence_revision:
        raise RuntimeError('external-file evidence revision does not match Material evidence')

    catalog_path = root / WEB_CATALOG_PATH
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    bindings = {
        str(row.get('materialName')): row
        for row in catalog.get('materialBindings') or []
        if isinstance(row, dict) and row.get('materialName')
    }

    external_rows = external_report.get('materials') or []
    if not external_rows:
        raise RuntimeError('external-file report contains no Material rows')
    external_by_file_id = {
        int(row['fileId']): str(row['name']).lower()
        for row in (external_rows[0].get('externals') or [])
    }

    targets: list[dict[str, Any]] = []
    for material in material_report.get('materials') or []:
        name = str(material.get('name') or '')
        binding = bindings.get(name)
        if not binding or not binding.get('baseMapUrl'):
            continue
        base_map = next(
            (
                tex for tex in (material.get('texEnvs') or [])
                if tex.get('property') == '_BaseMap'
                and int(tex.get('pathId') or 0) != 0
            ),
            None,
        )
        if base_map is None:
            continue
        targets.append({
            'material': name,
            'repoPath': str(repo_path_from_url(str(binding['baseMapUrl']))),
            'fileId': int(base_map.get('fileId') or 0),
            'pathId': int(base_map.get('pathId') or 0),
        })

    if not targets:
        raise RuntimeError('no current-JP 608 BaseMap targets resolved from Viewer bindings')

    with tempfile.TemporaryDirectory(prefix='magius-608-texture-parity-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        current_revision = str(metadata.get('assetBundleRevision'))
        if current_revision != args.expected_revision:
            raise RuntimeError(
                'current JP AssetBundle revision changed; refuse to apply stale evidence: '
                f'{current_revision} != {args.expected_revision}'
            )

        by_name = {
            closure.normalize_name(entry.full_path).lower(): entry
            for entry in entries
        }
        dependencies, _record = closure.current_dependencies(metadata)
        ordered_names = [TARGET_STAGE_BUNDLE, *dependencies]
        selected_entries = []
        for name in ordered_names:
            entry = by_name.get(name.lower())
            if entry is None:
                raise RuntimeError(f'current-JP closure dependency missing: {name}')
            selected_entries.append(entry)

        downloaded = [
            (entry, base.download(entry, request_headers, token, temp))
            for entry in selected_entries
        ]

        root_local: dict[int, tuple[Any, Any]] = {}
        closure_objects: dict[tuple[str, int], tuple[Any, Any]] = {}
        for entry, path in downloaded:
            env = UnityPy.load(str(path))
            is_root = closure.normalize_name(entry.full_path).lower() == TARGET_STAGE_BUNDLE.lower()
            for obj in env.objects:
                path_id = int(getattr(obj, 'path_id', 0) or 0)
                cab = internal_file_name(obj)
                closure_objects[(cab, path_id)] = (entry, obj)
                if is_root:
                    root_local[path_id] = (entry, obj)

        resolved_cache: dict[tuple[int, int], dict[str, Any]] = {}

        def resolve_texture(file_id: int, path_id: int) -> dict[str, Any]:
            key = (file_id, path_id)
            if key in resolved_cache:
                return resolved_cache[key]
            target_cab = None if file_id == 0 else external_by_file_id.get(file_id)
            match = (
                root_local.get(path_id)
                if file_id == 0
                else closure_objects.get((target_cab or '', path_id))
            )
            if match is None:
                raise RuntimeError(
                    f'unresolved current-JP Texture pointer fileId={file_id} pathId={path_id}'
                )
            entry, obj = match
            type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
            if type_name != 'Texture2D':
                raise RuntimeError(
                    f'expected Texture2D for fileId={file_id} pathId={path_id}, got {type_name}'
                )
            tree = obj.read_typetree()
            texture = obj.read()
            image = getattr(texture, 'image', None)
            if image is None:
                raise RuntimeError(
                    f'UnityPy could not decode Texture2D fileId={file_id} pathId={path_id}'
                )
            rgba = image.convert('RGBA')
            result = {
                'image': rgba,
                'textureName': str(tree.get('m_Name', '')) if isinstance(tree, dict) else '',
                'sourceBundle': str(entry.full_path),
                'width': rgba.size[0],
                'height': rgba.size[1],
                'pixelSha256': pixel_hash(rgba),
                'transformedPixelSha256': transformed_hashes(rgba),
            }
            resolved_cache[key] = result
            return result

        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for target in targets:
            resolved = resolve_texture(target['fileId'], target['pathId'])
            grouped[target['repoPath']].append({**target, 'resolved': resolved})

        replacements: list[dict[str, Any]] = []
        unchanged: list[dict[str, Any]] = []
        for repo_path, rows in sorted(grouped.items()):
            official_hashes = {row['resolved']['pixelSha256'] for row in rows}
            if len(official_hashes) != 1:
                raise RuntimeError(
                    'one Viewer texture URL maps to multiple current-JP Texture2D pixels: '
                    f'{repo_path}: {sorted(official_hashes)}'
                )
            official_names = {row['resolved']['textureName'] for row in rows}
            source_bundles = {row['resolved']['sourceBundle'] for row in rows}
            if len(official_names) != 1 or len(source_bundles) != 1:
                raise RuntimeError(
                    f'non-unique current-JP source identity for shared Viewer URL: {repo_path}'
                )

            official = rows[0]['resolved']
            destination = root / repo_path
            if not destination.is_file():
                raise RuntimeError(f'Viewer binding points to missing public PNG: {repo_path}')
            before_bytes = destination.read_bytes()
            with Image.open(io.BytesIO(before_bytes)) as before_image:
                before_rgba = before_image.convert('RGBA')
                before_pixel_hash = pixel_hash(before_rgba)

            exact_transform = next(
                (
                    label for label, value in official['transformedPixelSha256'].items()
                    if value == before_pixel_hash
                ),
                None,
            )
            common = {
                'repoPath': repo_path,
                'materials': sorted(row['material'] for row in rows),
                'officialTextureName': next(iter(official_names)),
                'officialSourceBundle': next(iter(source_bundles)),
                'size': [official['width'], official['height']],
                'officialPixelSha256': official['pixelSha256'],
                'beforePixelSha256': before_pixel_hash,
                'beforeFileSha256': sha256(before_bytes),
                'officialToBeforeExactTransformMatch': exact_transform,
            }

            if before_pixel_hash == official['pixelSha256']:
                unchanged.append(common)
                continue
            if exact_transform is not None:
                raise RuntimeError(
                    'orientation-only mismatch requires renderer/UV review and must not be auto-rewritten: '
                    f'{repo_path} matches official transform {exact_transform}'
                )

            destination.parent.mkdir(parents=True, exist_ok=True)
            official['image'].save(destination, format='PNG', optimize=True)
            after_bytes = destination.read_bytes()
            with Image.open(io.BytesIO(after_bytes)) as after_image:
                after_hash = pixel_hash(after_image)
            if after_hash != official['pixelSha256']:
                raise RuntimeError(
                    f'written PNG does not preserve exact decoded pixels: {repo_path}'
                )
            replacements.append({
                **common,
                'afterPixelSha256': after_hash,
                'afterFileSha256': sha256(after_bytes),
            })

    evidence = {
        'schemaVersion': 1,
        'source': 'current-JP-AssetBundle-closure-to-public-Viewer-Texture2D-parity',
        'assetBundleRevision': args.expected_revision,
        'stageBundle': TARGET_STAGE_BUNDLE,
        'targetBranchPurpose': 'P0.3 phase-2 stacked visual-regression candidate',
        'boundMaterialCount': len(targets),
        'uniqueViewerTextureCount': len(grouped),
        'replacementCount': len(replacements),
        'unchangedCount': len(unchanged),
        'replacements': replacements,
        'unchanged': unchanged,
        'privacyBoundary': (
            'Raw current-JP AssetBundle bytes were transient runner inputs and are not committed. '
            'Only individual decoded Texture2D PNGs required by existing public Viewer bindings '
            'and compact hash/provenance evidence are persisted.'
        ),
        'fidelityBoundary': (
            'This proves decoded Texture2D pixel identity only. It does not by itself prove '
            'shader, sampler, UV, colorspace, renderQueue, ReflectionProbe or runtime parity.'
        ),
    }
    output = root / OUTPUT_PATH
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    if not replacements:
        raise RuntimeError('no content-mismatched public stage-608 Texture2D files were replaced')

    print(json.dumps({
        'assetBundleRevision': args.expected_revision,
        'boundMaterialCount': evidence['boundMaterialCount'],
        'uniqueViewerTextureCount': evidence['uniqueViewerTextureCount'],
        'replacementCount': evidence['replacementCount'],
        'replacementPaths': [row['repoPath'] for row in replacements],
        'unchangedCount': evidence['unchangedCount'],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
