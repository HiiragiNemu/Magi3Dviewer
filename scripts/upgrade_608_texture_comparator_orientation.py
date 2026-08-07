#!/usr/bin/env python3
from pathlib import Path

path = Path('scripts/resolve_official_608_material_textures.py')
text = path.read_text(encoding='utf-8')

old = """                    result.update({
                        'size': list(rgba.size),
                        'pixelSha256': sha256(rgba.tobytes()),
                    })
"""
new = """                    flip_y = rgba.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                    flip_x = rgba.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    flip_xy = flip_y.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    result.update({
                        'size': list(rgba.size),
                        'pixelSha256': sha256(rgba.tobytes()),
                        'pixelSha256FlipY': sha256(flip_y.tobytes()),
                        'pixelSha256FlipX': sha256(flip_x.tobytes()),
                        'pixelSha256FlipXY': sha256(flip_xy.tobytes()),
                    })
"""
if old in text:
    text = text.replace(old, new, 1)
elif "'pixelSha256FlipY'" not in text:
    raise RuntimeError('official texture hash insertion point changed')

old = """        comparisons.append({
            'material': name,
"""
new = """        transform_match = None
        if official_base and web_hash:
            resolved = official_base.get('resolvedTexture', {})
            for transform, key in (
                ('identity', 'pixelSha256'),
                ('flip-y', 'pixelSha256FlipY'),
                ('flip-x', 'pixelSha256FlipX'),
                ('flip-xy', 'pixelSha256FlipXY'),
            ):
                if resolved.get(key) == web_hash:
                    transform_match = transform
                    break
        comparisons.append({
            'material': name,
            'officialToViewerExactTransformMatch': transform_match,
"""
if old in text:
    text = text.replace(old, new, 1)
elif "'officialToViewerExactTransformMatch'" not in text:
    raise RuntimeError('comparison insertion point changed')

old = """    mismatches = [
        row for row in comparisons
        if row['baseMapPixelMatch'] is False
    ]
"""
new = """    mismatches = [
        row for row in comparisons
        if row['baseMapPixelMatch'] is False
    ]
    orientation_only = [
        row for row in mismatches
        if row.get('officialToViewerExactTransformMatch') in {'flip-y', 'flip-x', 'flip-xy'}
    ]
    content_mismatches = [
        row for row in mismatches
        if row.get('officialToViewerExactTransformMatch') is None
    ]
"""
if old in text:
    text = text.replace(old, new, 1)
elif 'content_mismatches = [' not in text:
    raise RuntimeError('mismatch classification insertion point changed')

old = """        'baseMapPixelMismatchCount': len(mismatches),
        'missingViewerTextureFileCount': len(missing_viewer_files),
"""
new = """        'baseMapPixelMismatchCount': len(mismatches),
        'orientationOnlyMismatchCount': len(orientation_only),
        'contentMismatchCount': len(content_mismatches),
        'orientationOnlyMismatches': orientation_only,
        'contentMismatches': content_mismatches,
        'missingViewerTextureFileCount': len(missing_viewer_files),
"""
if old in text:
    text = text.replace(old, new, 1)
elif "'orientationOnlyMismatchCount'" not in text:
    raise RuntimeError('report classification insertion point changed')

old = """        'baseMapPixelMismatchCount': report['baseMapPixelMismatchCount'],
        'missingViewerTextureFileCount': report['missingViewerTextureFileCount'],
"""
new = """        'baseMapPixelMismatchCount': report['baseMapPixelMismatchCount'],
        'orientationOnlyMismatchCount': report['orientationOnlyMismatchCount'],
        'contentMismatchCount': report['contentMismatchCount'],
        'contentMismatchMaterials': [row['material'] for row in content_mismatches],
        'missingViewerTextureFileCount': report['missingViewerTextureFileCount'],
"""
if old in text:
    text = text.replace(old, new, 1)
elif "'contentMismatchMaterials'" not in text:
    raise RuntimeError('stdout classification insertion point changed')

path.write_text(text, encoding='utf-8')
print('608 texture comparator orientation classification ready')
