#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import apply_official_608_texture_parity as parity


def main() -> int:
    try:
        return parity.main()
    except RuntimeError as error:
        if str(error) != 'no content-mismatched public stage-608 Texture2D files were replaced':
            raise
        evidence_path = Path('research/stage-608-current-jp-texture-parity-evidence.json')
        if not evidence_path.is_file():
            raise RuntimeError('idempotent parity result did not persist evidence') from error
        evidence = json.loads(evidence_path.read_text(encoding='utf-8'))
        if evidence.get('replacementCount') != 0:
            raise RuntimeError('idempotent parity exception with non-zero replacementCount') from error
        if evidence.get('unchangedCount') != evidence.get('uniqueViewerTextureCount'):
            raise RuntimeError('idempotent parity result does not prove every Viewer texture already matches') from error
        print(json.dumps({
            'assetBundleRevision': evidence.get('assetBundleRevision'),
            'status': 'already-current-jp-exact',
            'replacementCount': 0,
            'unchangedCount': evidence.get('unchangedCount'),
            'uniqueViewerTextureCount': evidence.get('uniqueViewerTextureCount'),
        }, ensure_ascii=False, indent=2))
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
