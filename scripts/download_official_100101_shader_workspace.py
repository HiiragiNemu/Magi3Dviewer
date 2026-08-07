#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import extract_official_100101_material_properties as base


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    shutil.rmtree(output, ignore_errors=True)
    output.mkdir(parents=True, exist_ok=False)

    session = base.requests.Session()
    entries, request_headers, token, metadata = base.catalog(session)
    character = [
        entry for entry in entries
        if any(value in entry.full_path.lower() for value in base.TARGET_BUNDLE_TOKENS)
        and entry.full_path.lower().startswith('battle/character/')
    ]
    shaders = [
        entry for entry in entries
        if entry.full_path.lower().startswith(('shader/', 'shaders/'))
    ]
    selected = sorted(
        {entry.full_path: entry for entry in [*character, *shaders]}.values(),
        key=lambda item: item.full_path,
    )
    if len(character) < 2:
        raise RuntimeError(f'expected both 100101 and 100107 character bundles; got {len(character)}')
    if not shaders or len(selected) > 120:
        raise RuntimeError(
            f'unsafe Shader workspace selection: character={len(character)} '
            f'shader={len(shaders)} total={len(selected)}'
        )
    downloaded = [base.download(entry, request_headers, token, output) for entry in selected]
    manifest = {
        'schemaVersion': 1,
        'metadata': metadata,
        'characterBundleCount': len(character),
        'shaderBundleCount': len(shaders),
        'bundleCount': len(downloaded),
        'bundles': [entry.full_path for entry in selected],
    }
    (output / 'workspace-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(json.dumps({
        'output': str(output),
        'characterBundleCount': len(character),
        'shaderBundleCount': len(shaders),
        'bundleCount': len(downloaded),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
