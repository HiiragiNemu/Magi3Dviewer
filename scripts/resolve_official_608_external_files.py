#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

TARGET_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
TARGET_MATERIAL = 'bg3d608_00_blue_fish'
OUTPUT = Path('research/official-608-external-files.json')


def external_record(value, index: int):
    return {
        'fileId': index,
        'path': str(
            getattr(value, 'path', None)
            or getattr(value, 'm_PathName', None)
            or getattr(value, 'path_name', None)
            or ''
        ),
        'name': str(
            getattr(value, 'name', None)
            or getattr(value, 'm_AssetPath', None)
            or getattr(value, 'asset_path', None)
            or ''
        ),
        'guid': repr(getattr(value, 'guid', None) or getattr(value, 'm_GUID', None)),
        'type': repr(getattr(value, 'type', None) or getattr(value, 'm_Type', None)),
        'repr': repr(value),
    }


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-608-externals-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        selected = [entry for entry in entries if entry.full_path.lower() == TARGET_BUNDLE]
        if len(selected) != 1:
            raise RuntimeError(f'expected one stage bundle, got {len(selected)}')
        bundle_path = base.download(selected[0], request_headers, token, temp)
        env = UnityPy.load(str(bundle_path))

        results = []
        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Material':
                continue
            try:
                tree = obj.read_typetree()
            except Exception:
                continue
            if str(tree.get('m_Name', '')).lower() != TARGET_MATERIAL:
                continue
            assets_file = getattr(obj, 'assets_file', None)
            externals = list(getattr(assets_file, 'externals', []) or [])
            if not externals:
                externals = list(getattr(assets_file, 'm_Externals', []) or [])
            results.append({
                'material': tree.get('m_Name'),
                'sourceSerializedFile': str(getattr(assets_file, 'name', '')),
                'externalCount': len(externals),
                'externals': [external_record(value, i + 1) for i, value in enumerate(externals)],
            })

        if not results:
            raise RuntimeError('target Fish Material or its external table was not found')
        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-assetbundle',
            'metadata': metadata,
            'bundle': TARGET_BUNDLE,
            'materials': results,
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
