#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path

import UnityPy
from UnityPy.export.Texture2DConverter import parse_image_data

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
TARGET_CUBEMAP = 'ReflectionProbe-0'
SERIALIZED_FACE_NAMES = ('positive-x', 'negative-x', 'positive-y', 'negative-y', 'positive-z', 'negative-z')
REPORT = Path('research/official-608-cubemap-face-decode.json')


def pixel_summary(image):
    rgba = image.convert('RGBA')
    raw = rgba.tobytes()
    pixels = list(rgba.getdata())
    count = max(len(pixels), 1)
    avg = [sum(pixel[channel] for pixel in pixels) / count for channel in range(4)]
    return {
        'size': list(rgba.size),
        'mode': rgba.mode,
        'pixelSha256': hashlib.sha256(raw).hexdigest(),
        'averageRgba8': avg,
        'centerRgba8': list(rgba.getpixel((rgba.width // 2, rgba.height // 2))),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix='magius-608-cubemap-decode-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        selected = [entry for entry in entries if entry.full_path.lower() == TARGET_BUNDLE]
        if len(selected) != 1:
            raise RuntimeError(f'expected one stage bundle, got {len(selected)}')
        bundle_path = base.download(selected[0], request_headers, token, temp)
        env = UnityPy.load(str(bundle_path))

        target = None
        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Cubemap':
                continue
            parsed = obj.read()
            if str(getattr(parsed, 'm_Name', '')) == TARGET_CUBEMAP:
                target = parsed
                break
        if target is None:
            raise RuntimeError(f'{TARGET_CUBEMAP} not found')

        data = bytes(target.get_image_data())
        face_size = int(target.m_CompleteImageSize)
        face_count = int(target.m_ImageCount)
        width = int(target.m_Width)
        height = int(target.m_Height)
        if face_count != 6:
            raise RuntimeError(f'expected six cubemap faces, got {face_count}')
        if len(data) != face_size * face_count:
            raise RuntimeError(
                f'face-major payload invariant failed: {len(data)} != {face_size} * {face_count}'
            )

        output_dir = args.output_dir
        if output_dir:
            output_dir.mkdir(parents=True, exist_ok=True)

        faces = []
        for index, name in enumerate(SERIALIZED_FACE_NAMES):
            face_data = data[index * face_size:(index + 1) * face_size]
            image = parse_image_data(
                face_data,
                width,
                height,
                target.m_TextureFormat,
                getattr(target.object_reader, 'version', (0, 0, 0, 0)),
                getattr(target.object_reader, 'platform', 0),
                getattr(target, 'm_PlatformBlob', None),
                True,
            ).convert('RGBA')
            item = {
                'serializedIndex': index,
                'assumedUnityFace': name,
                'compressedByteCountWithMips': len(face_data),
                'compressedSha256': hashlib.sha256(face_data).hexdigest(),
                **pixel_summary(image),
            }
            if output_dir:
                filename = f'{index}-{name}.png'
                image.save(output_dir / filename, format='PNG', optimize=True)
                item['file'] = filename
            faces.append(item)

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-assetbundle',
            'metadata': metadata,
            'bundle': TARGET_BUNDLE,
            'cubemap': TARGET_CUBEMAP,
            'textureFormat': int(target.m_TextureFormat),
            'width': width,
            'height': height,
            'mipCount': int(target.m_MipCount),
            'faceCount': face_count,
            'completeImageSizePerFace': face_size,
            'payloadByteCount': len(data),
            'layoutEvidence': 'payloadByteCount == m_CompleteImageSize * m_ImageCount; each 5488-byte ETC2_RGBA8 face chain decodes independently at 64x64',
            'faces': faces,
        }
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
