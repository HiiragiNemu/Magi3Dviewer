#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import requests

import extract_official_100101_material_properties as base

OUTPUT = Path('research/official-jp-assetbundle-manifest-discovery.json')
MAX_CANDIDATES = 80
TERMS = ('manifest', 'assetbundlemanifest', 'asset_bundle_manifest', 'android')
INTERESTING_KEYS = (
    'name', 'fileName', 'assetBundleName', 'pathId', 'path', 'label', 'crc',
    'revision', 'revisionVer', 'revisionVersion', 'resourceRevision',
    'assetBundleRevision', 'version', 'hash', 'dependencies', 'dependency',
    'isEncrypted', 'encrypted', 'isRenamedName', 'size',
)


def safe_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [safe_value(item) for item in value[:30]]
    if isinstance(value, dict):
        return {str(key): safe_value(child) for key, child in list(value.items())[:40]}
    return repr(value)


def contains_term(value: Any) -> bool:
    if isinstance(value, str):
        lower = value.lower()
        return any(term in lower for term in TERMS)
    if isinstance(value, dict):
        return any(contains_term(key) or contains_term(child) for key, child in value.items())
    if isinstance(value, (list, tuple)):
        return any(contains_term(child) for child in value)
    return False


def compact_item(item: dict[str, Any], path_map: dict[int, str] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in INTERESTING_KEYS:
        if key in item:
            result[key] = safe_value(item[key])
    path_id = item.get('pathId')
    if path_map is not None and path_id is not None:
        try:
            result['resolvedPath'] = path_map.get(int(path_id))
        except Exception:
            pass
    result['keys'] = sorted(str(key) for key in item.keys())
    return result


def summarize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw_items = payload.get('mstList') or []
    raw_paths = payload.get('pathMappingMstList') or []
    path_map = {
        int(item['pathId']): str(item['path'])
        for item in raw_paths
        if isinstance(item, dict) and item.get('pathId') is not None and item.get('path') is not None
    }
    item_key_union = sorted({str(key) for item in raw_items if isinstance(item, dict) for key in item.keys()})
    path_key_union = sorted({str(key) for item in raw_paths if isinstance(item, dict) for key in item.keys()})
    candidates = [
        compact_item(item, path_map)
        for item in raw_items
        if isinstance(item, dict) and contains_term(item)
    ][:MAX_CANDIDATES]
    path_candidates = [
        safe_value(item)
        for item in raw_paths
        if isinstance(item, dict) and contains_term(item)
    ][:MAX_CANDIDATES]
    unresolved_name_items = []
    name_keys = ('name', 'fileName', 'assetBundleName')
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        if not any(item.get(key) is not None for key in name_keys):
            unresolved_name_items.append(compact_item(item, path_map))
            if len(unresolved_name_items) >= 20:
                break
    return {
        'payloadKeys': sorted(str(key) for key in payload.keys()),
        'rawEntryCount': len(raw_items),
        'pathMappingCount': len(raw_paths),
        'itemKeyUnion': item_key_union,
        'pathMappingKeyUnion': path_key_union,
        'termCandidates': candidates,
        'pathTermCandidates': path_candidates,
        'unresolvedNameSamples': unresolved_name_items,
    }


def try_file_catalog(session: requests.Session, request_headers: dict[str, str], token: str) -> dict[str, Any]:
    url = f'https://static-masterdata-mmme.akamaized.net/api/mst/get_resource_file_mst_list?{token}'
    try:
        response = session.post(url, headers=request_headers, data=base.POST_DATA, timeout=60)
    except Exception as exc:
        return {'attempted': True, 'error': repr(exc)}
    result: dict[str, Any] = {
        'attempted': True,
        'statusCode': response.status_code,
        'contentLength': len(response.content),
    }
    if not response.ok:
        result['responseHeaders'] = {
            key: value for key, value in response.headers.items()
            if key.lower().startswith('x-resource-revision')
        }
        return result
    try:
        payload = base.decrypt_data(response.content)['payload']
    except Exception as exc:
        result['decryptError'] = repr(exc)
        return result
    if not isinstance(payload, dict):
        result['payloadType'] = type(payload).__name__
        return result
    result['summary'] = summarize_payload(payload)
    return result


def main() -> int:
    session = requests.Session()
    request_headers = base.headers()
    config = session.post(
        f'https://{base.HOST}/api/config/get_config',
        headers=request_headers,
        data=base.POST_DATA,
        timeout=30,
    )
    config.raise_for_status()
    token_response = session.post(
        f'https://{base.HOST}/api/akamai/create_token',
        headers=request_headers,
        data=base.POST_DATA,
        timeout=30,
    )
    token_response.raise_for_status()
    token = base.decrypt_data(token_response.content)['payload']['token']

    language_hash = base.url_hash(base.LANGUAGE)[:4]
    revision = config.headers['x-resource-revision-asset-bundle']
    key = base.url_hash('GetResourceAssetBundleMstList:Android')[:4] + language_hash + revision
    response = session.post(
        'https://static-masterdata-mmme.akamaized.net/api/mst/'
        f'get_resource_asset_bundle_mst_list?key={key}&{token}',
        headers=request_headers,
        data=base.POST_DATA,
        timeout=60,
    )
    response.raise_for_status()
    decoded = base.decrypt_data(response.content)
    payload = decoded.get('payload')
    if not isinstance(payload, dict):
        raise TypeError(f'asset-bundle payload is {type(payload).__name__}')

    normalized_entries, _, _, metadata = base.catalog(session)
    normalized_candidates = [
        {
            'path': entry.path,
            'name': entry.name,
            'fullPath': entry.full_path,
            'revision': entry.revision,
            'encrypted': entry.encrypted,
        }
        for entry in normalized_entries
        if contains_term(entry.full_path) or contains_term(entry.path) or contains_term(entry.name)
    ][:MAX_CANDIDATES]

    report = {
        'schemaVersion': 1,
        'source': 'official-jp-current-resource-api-bounded-discovery',
        'purpose': (
            'Discover the current JP AssetBundleManifest/root-catalog route after the historical '
            "normalized fullPath='android' assumption stopped matching. This report intentionally "
            'persists only schema/header/candidate evidence, never auth tokens or the full catalog.'
        ),
        'metadata': metadata,
        'configResourceRevisionHeaders': {
            key: value for key, value in config.headers.items()
            if key.lower().startswith('x-resource-revision')
        },
        'assetBundleCatalog': summarize_payload(payload),
        'normalizedEntryCount': len(normalized_entries),
        'normalizedTermCandidates': normalized_candidates,
        'resourceFileCatalogProbe': try_file_catalog(session, request_headers, token),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'output': str(OUTPUT),
        'metadata': metadata,
        'resourceHeaders': report['configResourceRevisionHeaders'],
        'assetBundlePayloadKeys': report['assetBundleCatalog']['payloadKeys'],
        'assetBundleItemKeys': report['assetBundleCatalog']['itemKeyUnion'],
        'assetBundleTermCandidateCount': len(report['assetBundleCatalog']['termCandidates']),
        'normalizedTermCandidateCount': len(normalized_candidates),
        'fileCatalogStatus': report['resourceFileCatalogProbe'].get('statusCode'),
        'fileCatalogPayloadKeys': (report['resourceFileCatalogProbe'].get('summary') or {}).get('payloadKeys'),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
