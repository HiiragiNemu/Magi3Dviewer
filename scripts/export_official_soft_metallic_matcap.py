#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any

import msgpack
import requests
import UnityPy
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

CRYPTO_KEY = b'/TZh+1VxrtkNiDEH'
SECRET_URL_HASH = '1c7f'
HOST = 'api-gl.mmme.pokelabo.jp'
LANGUAGE = 'ja-Jpan'
SIGNATURE = 'O57rcgETm7BOEVU52UL0lmIgZS8W1yDM834d7F69oK+PafVgDXKB4gjY++Uj5sHveKxURtIC1PCrg47mgx37rg=='
POST_DATA = bytes.fromhex(
    '8846515530616782552cab5e1d7c850fa3cfbbb21e660dc1baf05c6c89dd94d7'
    'e77e9545a5ecbbbdaf1f1e7c8e633b6a85fcf684a4df112e52d8640e551c26e7'
    '8b89bccd55ca0bf3289834dde68fbd55b8b6590009612a8f27ee1ecffe81bb621'
    'c895a68ead65183db91f283857bfa4cdcca13ad6b83ed99560b7d8b4dacc0e8a3'
    '3a9ad916395d96aecbde0b9796b800e750d4855297f6f7c5cface02edc1488520'
    'a67b7b8dbabfbe990c5317050077212e02bd254fc2353e111a99255c97cc4cb76'
    'bc02ebc2db136e4e5119d79c142d617f6c621334993fc90b70483d38bb3524294'
    '106aa72ae9fac5d7f2d1b489f9bdac72c7646d4158feb2da4b99c912539f951b0'
    '7e390f1839349b16993868ec980a63a46558093ef9b5ce4bbf1fd6117e'
)
TARGET_BUNDLE = 'shader/common/texture/matcap_soft_metallic'
TARGET_TEXTURE = 'matcap_SoftMetallic'
EXPECTED_PIXEL_SHA256 = 'bc693dc16619511f8478e06fa26e6a8ae82bbcac0cb0c66302311687ac31ed42'
OUTPUT = Path('magia-exedra-character-three/models/common/matcap_SoftMetallic.png')
EVIDENCE = Path('research/official-soft-metallic-matcap.json')


def url_hash(value: str) -> str:
    return base64.urlsafe_b64encode(hashlib.md5(value.encode()).digest()).decode().rstrip('=')


def decrypt_data(payload: bytes | bytearray) -> dict[str, Any]:
    iv = bytes(payload[:16])
    raw = unpad(AES.new(CRYPTO_KEY, AES.MODE_CBC, iv).decrypt(bytes(payload[16:])), AES.block_size)
    value = msgpack.unpackb(raw, raw=False)
    if not isinstance(value, dict):
        raise TypeError(type(value))
    return value


def byte_key(value: str) -> bytes:
    first = hashlib.sha512(value.encode()).digest()
    return first + hashlib.sha512(first).digest()


def headers() -> dict[str, str]:
    return {
        'Accept': '*/*',
        'Content-Type': 'application/x-msgpack',
        'x-region': 'AU',
        'x-language': LANGUAGE,
        'x-timezone-offset': '-14400',
        'X-GAME-SERVER-URL': f'https://{HOST}',
        'X-post-signature': SIGNATURE,
        'X-Unity-Version': '2022.3.62f2',
    }


def pick(item: dict[str, Any], keys: tuple[str, ...], default=None):
    for key in keys:
        if item.get(key) is not None:
            return item[key]
    return default


def main() -> int:
    session = requests.Session()
    request_headers = headers()
    config = session.post(f'https://{HOST}/api/config/get_config', headers=request_headers, data=POST_DATA, timeout=30)
    config.raise_for_status()
    token_response = session.post(f'https://{HOST}/api/akamai/create_token', headers=request_headers, data=POST_DATA, timeout=30)
    token_response.raise_for_status()
    token = decrypt_data(token_response.content)['payload']['token']
    revision = config.headers['x-resource-revision-asset-bundle']
    language_hash = url_hash(LANGUAGE)[:4]
    key = url_hash('GetResourceAssetBundleMstList:Android')[:4] + language_hash + revision
    response = session.post(
        'https://static-masterdata-mmme.akamaized.net/api/mst/'
        f'get_resource_asset_bundle_mst_list?key={key}&{token}',
        headers=request_headers,
        data=POST_DATA,
        timeout=60,
    )
    response.raise_for_status()
    payload = decrypt_data(response.content)['payload']
    path_map = {int(item['pathId']): str(item['path']) for item in payload['pathMappingMstList']}

    entry = None
    for item in payload['mstList']:
        path = path_map[int(item['pathId'])]
        name = pick(item, ('name', 'fileName', 'assetBundleName'))
        if name is None:
            continue
        full_path = f'{path}{name}'.replace('\\', '/').lstrip('/')
        if full_path.lower() != TARGET_BUNDLE.lower():
            continue
        entry = {
            'path': path,
            'name': str(name),
            'fullPath': full_path,
            'revision': str(pick(item, ('revision','revisionVer','revisionVersion','resourceRevision','assetBundleRevision','version'), revision)),
            'cryptoKey': str(item.get('cryptoKey', item.get('cryptKey', ''))),
            'encrypted': bool(item.get('isEncrypted', item.get('encrypted', True))),
        }
        break
    if entry is None:
        raise RuntimeError(f'current JP catalog does not contain {TARGET_BUNDLE}')

    parts = entry['path'].split('/')
    directories = [url_hash(f'{part}{SECRET_URL_HASH}') for part in parts[:-1] if part]
    final_component = parts[-1] if parts else ''
    filename = url_hash(f"{final_component}{entry['name']}{SECRET_URL_HASH}")
    resource_path = '/'.join([*directories, filename])
    resource_url = (
        'https://static-files-mmme.akamaized.net/web/resource/'
        f"{url_hash('assetbundles')}/{url_hash('android')}/{resource_path}"
        f"?key={language_hash}{entry['revision']}&{token}"
    )
    bundle_response = session.get(resource_url, headers=request_headers, timeout=120)
    bundle_response.raise_for_status()
    bundle = bytearray(bundle_response.content)
    encrypted_sha = hashlib.sha256(bundle).hexdigest()
    if entry['encrypted']:
        key_bytes = byte_key(entry['fullPath'] + entry['cryptoKey'])
        for index in range(len(bundle)):
            bundle[index] ^= key_bytes[index % len(key_bytes)]
    if not bundle.startswith(b'UnityFS'):
        raise RuntimeError('SoftMetallic bundle is not UnityFS after decrypt')

    env = UnityPy.load(bytes(bundle))
    target = None
    for obj in env.objects:
        if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Texture2D':
            continue
        texture = obj.read()
        if str(getattr(texture, 'm_Name', '')) == TARGET_TEXTURE:
            target = texture
            break
    if target is None:
        raise RuntimeError(f'{TARGET_TEXTURE} not found in {TARGET_BUNDLE}')

    image = target.image.convert('RGBA')
    pixel_sha = hashlib.sha256(image.tobytes()).hexdigest()
    if pixel_sha != EXPECTED_PIXEL_SHA256:
        raise RuntimeError(f'pixel SHA mismatch: {pixel_sha} != {EXPECTED_PIXEL_SHA256}')
    if image.size != (256, 256):
        raise RuntimeError(f'unexpected SoftMetallic dimensions: {image.size}')

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, format='PNG', optimize=True)
    png_sha = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    report = {
        'schemaVersion': 1,
        'source': 'current-JP-official-AssetBundle',
        'assetBundleRevision': revision,
        'bundle': TARGET_BUNDLE,
        'texture': TARGET_TEXTURE,
        'width': image.width,
        'height': image.height,
        'pixelSha256': pixel_sha,
        'pngSha256': png_sha,
        'encryptedBundleSha256': encrypted_sha,
        'decryptedBundleSha256': hashlib.sha256(bundle).hexdigest(),
    }
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
