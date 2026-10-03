#!/usr/bin/env python3
"""Project held official JP images into the viewer; never download or add models.

Character identity is resourceName -> style3dCharacterMstId, not a numeric
prefix guess. Only transparent padding is trimmed from native 3D portraits.
Scene images retain their authored landscape aspect ratio.
"""
import argparse
import hashlib
import json
import re
import warnings
from pathlib import Path

import UnityPy
from PIL import Image


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--master', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, help='Held official asset catalog, used to verify encoded file revisions')
    parser.add_argument('--download-metadata', type=Path, help='Held matching per-file decode metadata; never published')
    parser.add_argument('--decoded-overrides', type=Path,
                        help='Verified logical bundle -> decoded native PNG paths; only used for encoded bundles')
    args = parser.parse_args()
    warnings.filterwarnings('ignore', category=UserWarning)
    UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'
    root = Path(__file__).resolve().parent.parent
    public = root / 'public'
    manifest_path = public / 'ui-thumbnails/runtime-selection/manifest.v1.json'
    manifest = read(manifest_path)
    overrides = read(args.decoded_overrides) if args.decoded_overrides else {}
    metadata = read(args.download_metadata) if args.download_metadata else {}
    catalog = {}
    if args.catalog:
        payload = read(args.catalog)['payload']
        directories = {row['pathId']: row['path'] for row in payload['pathMappingMstList']}
        catalog = {directories[row['pathId']] + row['name']: row for row in payload['mstList']}
    master_path = args.master / 'getStyle3dCharacterMstList.json'
    rows = read(master_path)['payload']['mstList']
    model_ids = set(manifest['characters'])
    for path in (root / 'magia-exedra-character-three/models').iterdir():
        match = re.search(r'chara_(\d+)', path.name)
        if match:
            model_ids.add(match[1])
    # Existing typed home-model loaders, not new model support.
    model_ids.update(['113601', '114801'])
    report = {'schema': 'magius.selection-image-projection.v1',
              'masterSha256': sha(master_path.read_bytes()), 'portraits': [], 'scenes': [], 'unresolved': []}

    def extract(logical):
        path = args.assets / logical
        raw = path.read_bytes()
        source_hash = sha(raw)
        decode_receipt = {}
        if not raw.startswith(b'UnityFS') and logical in catalog:
            entry = catalog[logical]
            record = metadata.get('AssetBundles/' + logical, {})
            if entry.get('cryptoKey'):
                record = dict(entry, file_name=logical)
            if (record.get('file_name') == logical and record.get('revision') == entry['revision']
                    and len(raw) == entry['size'] and record.get('cryptoKey')):
                first = hashlib.sha512((logical + record['cryptoKey']).encode()).digest()
                key = first + hashlib.sha512(first).digest()
                candidate = bytes(value ^ key[i % len(key)] for i, value in enumerate(raw))
                if candidate.startswith(b'UnityFS'):
                    raw = candidate
                    decode_receipt = {'catalogRevision': entry['revision'], 'decodedBundleSha256': sha(raw),
                                      'decodeProvenance': 'held-official-catalog-matched-per-file-metadata'}
        if raw.startswith(b'UnityFS'):
            objects = list(UnityPy.load(raw).objects)
            textures = [o for o in objects if o.type.name == 'Texture2D']
            if len(textures) != 1:
                raise ValueError(f'Ambiguous native image: {logical}')
            obj = textures[0]
            native = obj.read().image.convert('RGBA')
            authority = {'sourceBundle': 'AssetBundles/' + logical, 'bundleSha256': source_hash,
                         'sourceType': 'Texture2D', 'pathId': str(obj.path_id),
                         'unityFallback': '2022.3.62f2'}
            authority.update(decode_receipt)
        elif logical in overrides:
            record = overrides[logical]
            decoded = Path(record['path'])
            assert sha(decoded.read_bytes()) == record['sha256'], 'Decoded source changed'
            assert record['provenance'], 'Decoded source must include its extraction provenance'
            native = Image.open(decoded).convert('RGBA')
            authority = {'sourceBundle': 'AssetBundles/' + logical, 'bundleSha256': sha(raw),
                         'sourceType': 'verified-decoded-Texture2D', 'decodedSha256': record['sha256'],
                         'provenance': record['provenance']}
        else:
            raise ValueError('Encoded native bundle requires verified decoded source: ' + logical)
        authority.update(sourceSize=list(native.size), sourcePixelSha256=sha(native.tobytes()))
        return native, authority

    def publish(image, relative, authority, portrait=False):
        if portrait:
            bounds = image.getbbox()
            if not bounds:
                raise ValueError('Empty native portrait: ' + relative)
            authority['transparentPaddingCrop'] = list(bounds)
            image = image.crop(bounds)
        image.thumbnail((256, 256) if portrait else (320, 180), Image.Resampling.LANCZOS)
        output = public / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, format='WEBP', lossless=True, exact=True, method=6)
        # Reopen the actual shipping file, including alpha and all visible pixels.
        with Image.open(output) as decoded:
            assert decoded.convert('RGBA').tobytes() == image.tobytes()
        authority.update(output='/' + relative, outputSize=list(image.size), outputSha256=sha(output.read_bytes()))
        return '/' + relative

    by_model = {re.search(r'chara_(\d+)', row['resourceName']).group(1): row for row in rows}
    # The legacy Madoka model and its replacement represent the same default
    # magical-girl outfit. Keep its identity explicit rather than treating
    # style3dCharacterMstId=100102 as viewer model 100102 (school uniform).
    by_model['100101'] = by_model['100107']
    for model in sorted(model_ids):
        row = by_model.get(model)
        if not row:
            report['unresolved'].append({'modelId': model, 'reason': 'no exact master resource mapping'})
            continue
        logical = f"home/doll_house_character/thumbnail_3d/{row['style3dCharacterMstId']}_thumbnail"
        try:
            image, authority = extract(logical)
        except (ValueError, FileNotFoundError) as error:
            report['unresolved'].append({'modelId': model, 'sourceBundle': logical, 'reason': str(error)})
            continue
        authority.update(modelId=model, style3dCharacterMstId=row['style3dCharacterMstId'],
                         resourceName=row['resourceName'])
        if model == '100101':
            authority['legacyOutfitAlias'] = '100107: default Madoka magical-girl outfit; legacy 100101 model retained'
        manifest['characters'][model] = publish(image, f'ui-thumbnails/runtime-selection/characters/{model}.webp', authority, True)
        report['portraits'].append(authority)

    # Add available master-bound landscape images, retaining every existing map.
    diorama = read(args.master / 'getDioramaBackgroundMstList.json')['payload']['mstList']
    for row in diorama:
        resource = row['backgroundResourceName']
        if resource in manifest['sceneResources']:
            continue
        logical = 'gallery/library/diorama_background/' + row['stageThumbnailName'] + '_thumbnail'
        try:
            image, authority = extract(logical)
        except (ValueError, FileNotFoundError):
            continue
        authority.update(backgroundResourceName=resource, dioramaBackgroundMstId=row['dioramaBackgroundMstId'])
        url = publish(image, f"ui-thumbnails/runtime-selection/scenes/diorama/{row['dioramaBackgroundMstId']}.webp", authority)
        manifest['sceneResources'][resource] = url
        report['scenes'].append(authority)

    # Fill native 2D backgrounds by their own original texture, not a neighboring
    # scene with a similar filename (the authored `originall` suffix is valid).
    for row in read(public / 'stages/catalogs/official-gallery-diorama-original.v1.json')['stages']:
        if row['id'] in manifest['scenes'] or row['backgroundResourceName'] in manifest['sceneResources']:
            continue
        try:
            image, authority = extract(row['assetBundleName'])
        except (ValueError, FileNotFoundError):
            continue
        authority.update(sceneId=row['id'], backgroundResourceName=row['backgroundResourceName'])
        url = publish(image, 'ui-thumbnails/runtime-selection/scenes/native/' + row['id'] + '.webp', authority)
        manifest['scenes'][row['id']] = url
        manifest['sceneResources'][row['backgroundResourceName']] = url
        report['scenes'].append(authority)
    manifest['characters'] = dict(sorted(manifest['characters'].items()))
    urls = set(manifest['characters'].values()) | set(manifest['scenes'].values()) | set(manifest['sceneResources'].values())
    manifest['counts'] = dict(characterModels=len(model_ids), characterThumbnails=len(manifest['characters']),
                             sceneIds=len(manifest['scenes']), sceneResourceNames=len(manifest['sceneResources']),
                             generatedImages=len(urls))
    write(manifest_path, manifest)
    write(args.report, report)
    print(json.dumps({'portraits': len(report['portraits']), 'sceneAdditions': len(report['scenes']),
                      'unresolved': len(report['unresolved']), 'manifest': manifest['counts']}))


if __name__ == '__main__':
    main()
