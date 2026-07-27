#!/usr/bin/env python3
"""Current-schema wrapper for the one-time official AssetBundle executor."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('download_targeted_assets_base.py')
spec = importlib.util.spec_from_file_location('targeted_assets_base', MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f'Unable to load {MODULE_PATH}')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def get_catalog(session):
    request_headers = base.headers()
    config = session.post(
        f"https://{base.HOST}/api/config/get_config",
        headers=request_headers,
        data=base.POST_DATA,
        timeout=30,
    )
    config.raise_for_status()
    token_response = session.post(
        f"https://{base.HOST}/api/akamai/create_token",
        headers=request_headers,
        data=base.POST_DATA,
        timeout=30,
    )
    token_response.raise_for_status()
    token = base.decrypt_data(token_response.content)["payload"]["token"]
    language_hash = base.url_hash(base.LANGUAGE)[:4]
    catalog_revision = config.headers["x-resource-revision-asset-bundle"]
    key = (
        base.url_hash("GetResourceAssetBundleMstList:Android")[:4]
        + language_hash
        + catalog_revision
    )
    response = session.post(
        "https://static-masterdata-mmme.akamaized.net/api/mst/"
        f"get_resource_asset_bundle_mst_list?key={key}&{token}",
        headers=request_headers,
        data=base.POST_DATA,
        timeout=60,
    )
    response.raise_for_status()
    decoded = base.decrypt_data(response.content)
    payload = decoded["payload"]
    raw_items = payload["mstList"]
    path_map = {
        int(item["pathId"]): str(item["path"])
        for item in payload["pathMappingMstList"]
    }

    schema_path = Path('/tmp/private-evidence/catalog-schema.json')
    schema_path.parent.mkdir(parents=True, exist_ok=True)
    schema_path.write_text(json.dumps({
        'payloadKeys': sorted(payload.keys()),
        'itemKeys': sorted({key for item in raw_items[:100] for key in item.keys()}),
        'pathMappingKeys': sorted({key for item in payload['pathMappingMstList'][:100] for key in item.keys()}),
        'sampleItems': raw_items[:20],
        'samplePathMappings': payload['pathMappingMstList'][:20],
    }, ensure_ascii=False, indent=2), encoding='utf-8')

    revision_keys = (
        'revision',
        'revisionVer',
        'revisionVersion',
        'resourceRevision',
        'assetBundleRevision',
        'version',
    )
    name_keys = ('name', 'fileName', 'assetBundleName')

    def pick(item, keys, default=None):
        for key in keys:
            if key in item and item[key] is not None:
                return item[key]
        return default

    entries = []
    unresolved = []
    for index, item in enumerate(raw_items):
        path_id = int(item['pathId'])
        path = path_map[path_id]
        name = pick(item, name_keys)
        revision = pick(item, revision_keys)
        if name is None or revision is None:
            unresolved.append({
                'index': index,
                'keys': sorted(item.keys()),
                'item': item,
                'missingName': name is None,
                'missingRevision': revision is None,
            })
            continue
        entries.append(base.Entry(
            path_id=path_id,
            path=path,
            name=str(name),
            full_path=f"{path}{name}".replace('\\', '/').lstrip('/'),
            revision=str(revision),
            crypto_key=str(item.get('cryptoKey', item.get('cryptKey', ''))),
            encrypted=bool(item.get('isEncrypted', item.get('encrypted', True))),
        ))

    (schema_path.parent / 'catalog-unresolved-items.json').write_text(
        json.dumps(unresolved[:1000], ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    if not entries:
        raise RuntimeError(
            f'No catalog items could be normalized; inspect {schema_path}'
        )

    metadata = {
        'language': base.LANGUAGE,
        'assetBundleRevision': catalog_revision,
        'rawEntryCount': len(raw_items),
        'normalizedEntryCount': len(entries),
        'unresolvedEntryCount': len(unresolved),
        'revisionHeaders': {
            key: value for key, value in config.headers.items()
            if key.lower().startswith('x-resource-revision')
        },
    }
    return entries, request_headers, token, metadata


base.get_catalog = get_catalog

if __name__ == '__main__':
    base.main()
