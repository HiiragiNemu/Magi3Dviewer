#!/usr/bin/env python3
"""Resolve ReflectionProbe -> Cubemap objects inside an exact scene closure.

The extractor deliberately treats Cubemap decoding as capability-detected:
- if the installed UnityPy exposes `images`, export every face image;
- if it exposes a single `image`, export that decoded image;
- otherwise retain the exact raw serialized object plus texture metadata and
  stream-data information for a later format-specific decoder.

Cross-file references are resolved with UnityPy PPtr.deref(), so a probe and its
Cubemap do not need to live in the same serialized file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def safe_name(value: str) -> str:
    value = re.sub(r'[^A-Za-z0-9_.-]+', '_', value).strip('._')
    return value[:160] or 'object'


def source_name(obj: Any) -> str | None:
    for owner_name in ('assets_file', 'assetsfile', 'reader'):
        owner = getattr(obj, owner_name, None)
        for field in ('name', 'file_name', 'path'):
            value = getattr(owner, field, None) if owner is not None else None
            if value:
                return str(value).replace('\\', '/')
    return None


def object_type(obj: Any) -> str:
    return str(getattr(getattr(obj, 'type', None), 'name', 'Unknown'))


def object_name(obj: Any) -> str | None:
    try:
        value = obj.peek_name()
        if value:
            return str(value)
    except Exception:
        pass
    try:
        parsed = obj.parse_as_object()
        value = getattr(parsed, 'm_Name', None)
        if value:
            return str(value)
    except Exception:
        pass
    return None


def pointer_target(pointer: Any):
    if pointer is None:
        return None
    try:
        return pointer.deref()
    except Exception:
        try:
            return getattr(pointer, 'get_obj')()
        except Exception:
            return None


def read_raw_data(obj: Any) -> bytes | None:
    for name in ('get_raw_data', 'get_raw_data', 'get_raw_data'):
        method = getattr(obj, name, None)
        if method is None:
            continue
        try:
            value = method()
        except Exception:
            continue
        if isinstance(value, bytes):
            return value
    return None


def pptr_summary(pointer: Any) -> dict[str, int] | None:
    if pointer is None:
        return None
    values = {}
    for output_key, candidates in {
        'fileID': ('m_FileID', 'fileID', 'FileID'),
        'pathID': ('m_PathID', 'pathID', 'PathID'),
    }.items():
        raw = None
        for candidate in candidates:
            raw = getattr(pointer, candidate, None)
            if raw is not None:
                break
        try:
            values[output_key] = int(raw or 0)
        except (TypeError, ValueError):
            values[output_key] = 0
    return values


def parsed_texture_metadata(parsed: Any) -> dict[str, Any]:
    fields = (
        'm_Name',
        'm_Width',
        'm_Height',
        'm_CompleteImageSize',
        'm_TextureFormat',
        'm_MipCount',
        'm_ImageCount',
        'm_TextureDimension',
        'm_IsReadable',
        'm_ColorSpace',
        'm_LightmapFormat',
    )
    result = {}
    for field in fields:
        value = getattr(parsed, field, None)
        if value is None:
            continue
        try:
            json.dumps(value)
            result[field] = value
        except TypeError:
            try:
                result[field] = int(value)
            except Exception:
                result[field] = repr(value)
    stream = getattr(parsed, 'm_StreamData', None)
    if stream is not None:
        stream_record = {}
        for field in ('offset', 'size', 'path', 'm_Offset', 'm_Size', 'm_Path'):
            value = getattr(stream, field, None)
            if value is not None:
                stream_record[field] = value
        if stream_record:
            result['m_StreamData'] = stream_record
    texture_data = None
    for field in ('image_data', 'm_TextureData', 'm_ImageData'):
        value = getattr(parsed, field, None)
        if isinstance(value, (bytes, bytearray)):
            texture_data = bytes(value)
            result[field] = {
                'byteCount': len(texture_data),
                'sha256': sha256_bytes(texture_data),
            }
            break
    return result


def export_decoded_images(parsed: Any, destination: Path) -> dict[str, Any]:
    result = {
        'mode': 'raw-only',
        'images': [],
        'decodeErrors': [],
    }
    try:
        images = getattr(parsed, 'images')
    except Exception as exc:
        images = None
        result['decodeErrors'].append(f'images: {exc!r}')
    if images is not None:
        try:
            values = list(images)
            for index, image in enumerate(values):
                path = destination / f'face-{index:02d}.png'
                image.save(path)
                result['images'].append(path.name)
            if result['images']:
                result['mode'] = 'images'
                return result
        except Exception as exc:
            result['decodeErrors'].append(f'images export: {exc!r}')

    try:
        image = getattr(parsed, 'image')
    except Exception as exc:
        image = None
        result['decodeErrors'].append(f'image: {exc!r}')
    if image is not None:
        try:
            path = destination / 'image.png'
            image.save(path)
            result['images'].append(path.name)
            result['mode'] = 'image'
            return result
        except Exception as exc:
            result['decodeErrors'].append(f'image export: {exc!r}')
    return result


def cubemap_key(obj: Any) -> tuple[str, int]:
    return source_name(obj) or '<unknown>', int(getattr(obj, 'path_id', 0) or 0)


def extract_cubemap(obj: Any, root: Path) -> dict[str, Any]:
    source, path_id = cubemap_key(obj)
    name = object_name(obj) or f'Cubemap:{path_id}'
    destination = root / f'{safe_name(name)}__{path_id}'
    destination.mkdir(parents=True, exist_ok=True)
    try:
        parsed = obj.parse_as_object()
        parse_error = None
    except Exception as exc:
        parsed = None
        parse_error = repr(exc)

    metadata = parsed_texture_metadata(parsed) if parsed is not None else {}
    decode = export_decoded_images(parsed, destination) if parsed is not None else {
        'mode': 'raw-only',
        'images': [],
        'decodeErrors': [f'parse: {parse_error}'],
    }
    raw = read_raw_data(obj)
    raw_record = None
    if raw is not None:
        raw_path = destination / 'serialized-object.bin'
        raw_path.write_bytes(raw)
        raw_record = {
            'path': raw_path.name,
            'byteCount': len(raw),
            'sha256': sha256_bytes(raw),
        }
    try:
        typetree = obj.parse_as_dict()
    except Exception as exc:
        typetree = None
        typetree_error = repr(exc)
    else:
        typetree_error = None
    if typetree is not None:
        (destination / 'typetree.json').write_text(
            json.dumps(typetree, ensure_ascii=False, indent=2, default=repr) + '\n',
            encoding='utf-8',
        )
    record = {
        'name': name,
        'source': source,
        'pathId': path_id,
        'type': object_type(obj),
        'metadata': metadata,
        'decoded': decode,
        'raw': raw_record,
        'parseError': parse_error,
        'typetreeError': typetree_error,
        'directory': destination.name,
    }
    (destination / 'cubemap.json').write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('asset_root', type=Path, help='Exact staged AssetBundles closure root')
    parser.add_argument('-o', '--output', type=Path, default=Path('research/reflection-probes'))
    args = parser.parse_args()

    bundle_files = [
        path for path in sorted(args.asset_root.rglob('*'))
        if path.is_file() and path.name != 'closure.json'
    ]
    if not bundle_files:
        raise FileNotFoundError(f'No AssetBundle files under {args.asset_root}')
    try:
        import UnityPy  # type: ignore
    except ImportError as exc:
        raise RuntimeError('UnityPy is required') from exc
    env = UnityPy.load(*(str(path) for path in bundle_files))
    objects = list(env.objects)
    args.output.mkdir(parents=True, exist_ok=True)
    cubemap_root = args.output / 'cubemaps'
    cubemap_root.mkdir(exist_ok=True)

    cubemap_readers: dict[tuple[str, int], Any] = {}
    for obj in objects:
        if object_type(obj) == 'Cubemap':
            cubemap_readers[cubemap_key(obj)] = obj

    cubemap_records: dict[tuple[str, int], dict[str, Any]] = {}
    links = []
    probe_errors = []
    for obj in objects:
        if object_type(obj) != 'ReflectionProbe':
            continue
        source = source_name(obj) or '<unknown>'
        path_id = int(getattr(obj, 'path_id', 0) or 0)
        try:
            probe = obj.parse_as_object()
        except Exception as exc:
            probe_errors.append({
                'source': source,
                'pathId': path_id,
                'error': repr(exc),
            })
            continue
        probe_name = object_name(obj) or f'ReflectionProbe:{path_id}'
        for field in ('m_BakedTexture', 'm_CustomBakedTexture'):
            pointer = getattr(probe, field, None)
            target = pointer_target(pointer)
            target_record = None
            if target is not None:
                key = cubemap_key(target)
                if key not in cubemap_records:
                    cubemap_records[key] = extract_cubemap(target, cubemap_root)
                target_record = {
                    'source': key[0],
                    'pathId': key[1],
                    'name': cubemap_records[key]['name'],
                    'type': cubemap_records[key]['type'],
                    'directory': cubemap_records[key]['directory'],
                }
            links.append({
                'probe': {
                    'name': probe_name,
                    'source': source,
                    'pathId': path_id,
                },
                'field': field,
                'pointer': pptr_summary(pointer),
                'target': target_record,
            })

    # Also retain unreferenced Cubemap objects in the exact closure. They may be
    # assigned through ReDriveVolume or Material parameters rather than a built-
    # in ReflectionProbe component.
    for key, obj in cubemap_readers.items():
        if key not in cubemap_records:
            cubemap_records[key] = extract_cubemap(obj, cubemap_root)

    summary = {
        'schemaVersion': 1,
        'bundleFileCount': len(bundle_files),
        'reflectionProbeCount': sum(1 for obj in objects if object_type(obj) == 'ReflectionProbe'),
        'cubemapCount': len(cubemap_records),
        'probeCubemapLinkCount': len(links),
        'probeCubemapLinks': links,
        'cubemaps': [
            cubemap_records[key]
            for key in sorted(cubemap_records, key=lambda item: (item[0], item[1]))
        ],
        'probeParseErrorCount': len(probe_errors),
        'probeParseErrors': probe_errors,
    }
    (args.output / 'reflection-probe-cubemaps.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(json.dumps({
        'reflectionProbeCount': summary['reflectionProbeCount'],
        'cubemapCount': summary['cubemapCount'],
        'probeCubemapLinkCount': summary['probeCubemapLinkCount'],
        'decodedModes': {
            record['decoded']['mode']: sum(
                1 for candidate in cubemap_records.values()
                if candidate['decoded']['mode'] == record['decoded']['mode']
            )
            for record in cubemap_records.values()
        },
        'probeParseErrorCount': len(probe_errors),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
