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
OUTPUT = Path('research/official-608-cubemap-payloads.json')


def byte_summary(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, memoryview):
        value = value.tobytes()
    elif isinstance(value, bytearray):
        value = bytes(value)
    elif isinstance(value, list) and all(isinstance(item, int) for item in value):
        value = bytes(item & 0xff for item in value)
    if not isinstance(value, bytes):
        return {'type': type(value).__name__, 'repr': repr(value)[:1000]}
    return {
        'byteCount': len(value),
        'sha256': hashlib.sha256(value).hexdigest(),
        'headHex': value[:64].hex(),
        'tailHex': value[-64:].hex() if value else '',
    }


def stream_summary(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return base.jsonable(value)
    result = {}
    for name in ('offset', 'size', 'path', 'm_Offset', 'm_Size', 'm_Path'):
        if hasattr(value, name):
            result[name] = base.jsonable(getattr(value, name))
    return result or {'repr': repr(value), 'type': type(value).__name__}


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-608-cubemap-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        selected = [entry for entry in entries if entry.full_path.lower() == TARGET_BUNDLE]
        if len(selected) != 1:
            raise RuntimeError(f'expected one stage bundle, got {len(selected)}')
        bundle_path = base.download(selected[0], request_headers, token, temp)
        env = UnityPy.load(str(bundle_path))

        cubemaps = []
        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Cubemap':
                continue
            path_id = int(getattr(obj, 'path_id', 0) or 0)
            try:
                tree = obj.read_typetree()
            except Exception as exc:
                tree = {'typetreeError': repr(exc)}
            parsed = None
            parsed_error = None
            try:
                parsed = obj.read()
            except Exception as exc:
                parsed_error = repr(exc)

            capability = {}
            streamed_image_data = None
            streamed_image_data_error = None
            if parsed is not None:
                for attr in ('image', 'images'):
                    try:
                        value = getattr(parsed, attr)
                    except Exception as exc:
                        capability[attr] = {'error': repr(exc)}
                    else:
                        if attr == 'images':
                            try:
                                capability[attr] = {
                                    'count': len(value),
                                    'types': [type(item).__name__ for item in list(value)[:12]],
                                    'sizes': [getattr(item, 'size', None) for item in list(value)[:12]],
                                }
                            except Exception as exc:
                                capability[attr] = {'error': repr(exc)}
                        else:
                            capability[attr] = {
                                'type': type(value).__name__,
                                'size': getattr(value, 'size', None),
                                'mode': getattr(value, 'mode', None),
                                'pixelSha256': hashlib.sha256(value.tobytes()).hexdigest()
                                    if hasattr(value, 'tobytes') else None,
                            }
                get_image_data = getattr(parsed, 'get_image_data', None)
                if callable(get_image_data):
                    capability['get_image_data'] = {'callable': True}
                    try:
                        streamed_image_data = get_image_data()
                    except Exception as exc:
                        streamed_image_data_error = repr(exc)
                        capability['get_image_data']['error'] = streamed_image_data_error
                    else:
                        capability['get_image_data']['result'] = byte_summary(streamed_image_data)
                else:
                    capability['get_image_data'] = {'callable': False}

            image_data = None
            stream_data = None
            if isinstance(tree, dict):
                for key in ('image data', 'm_ImageData', 'image_data'):
                    if key in tree:
                        image_data = tree.get(key)
                        break
                for key in ('m_StreamData', 'streamData', 'stream_data'):
                    if key in tree:
                        stream_data = tree.get(key)
                        break

            raw = None
            raw_error = None
            try:
                raw_value = obj.get_raw_data()
                raw = raw_value.tobytes() if hasattr(raw_value, 'tobytes') else bytes(raw_value)
            except Exception as exc:
                raw_error = repr(exc)

            cubemaps.append({
                'name': str(tree.get('m_Name', '')) if isinstance(tree, dict) else '',
                'pathId': path_id,
                'width': tree.get('m_Width') if isinstance(tree, dict) else None,
                'height': tree.get('m_Height') if isinstance(tree, dict) else None,
                'textureFormat': tree.get('m_TextureFormat') if isinstance(tree, dict) else None,
                'mipCount': tree.get('m_MipCount') if isinstance(tree, dict) else None,
                'imageCount': tree.get('m_ImageCount') if isinstance(tree, dict) else None,
                'dimension': tree.get('m_TextureDimension') if isinstance(tree, dict) else None,
                'colorSpace': tree.get('m_ColorSpace') if isinstance(tree, dict) else None,
                'completeImageSize': tree.get('m_CompleteImageSize') if isinstance(tree, dict) else None,
                'imageData': byte_summary(image_data),
                'streamedImageData': byte_summary(streamed_image_data),
                'streamedImageDataError': streamed_image_data_error,
                'streamData': stream_summary(stream_data),
                'rawObject': byte_summary(raw),
                'rawObjectError': raw_error,
                'parsedError': parsed_error,
                'extensionCapabilities': capability,
                'typetreeKeys': sorted(tree.keys()) if isinstance(tree, dict) else [],
            })

        if not cubemaps:
            raise RuntimeError('no Cubemap objects found in stage 608 root bundle')
        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-assetbundle',
            'metadata': metadata,
            'bundle': TARGET_BUNDLE,
            'cubemapCount': len(cubemaps),
            'cubemaps': cubemaps,
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
