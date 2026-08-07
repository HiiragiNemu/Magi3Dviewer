#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'magia-exedra-character-three' / 'loader.ts'
OLD = """            modelObject = fbxLoader.parse(\n                fbxBuffer,\n                new URL('.', fbxUrl).href,\n            )\n"""
NEW = """            modelObject = fbxLoader.parse(\n                fbxBuffer,\n                new URL('.', new URL(fbxUrl, document.baseURI)).href,\n            )\n"""


def main() -> int:
    text = TARGET.read_text(encoding='utf-8')
    if NEW in text:
        print('FBX relative parse base URL already patched')
        return 0
    count = text.count(OLD)
    if count != 1:
        raise RuntimeError(f'Expected exactly one guarded loader snippet, found {count}')
    TARGET.write_text(text.replace(OLD, NEW, 1), encoding='utf-8')
    verify = TARGET.read_text(encoding='utf-8')
    if NEW not in verify or OLD in verify:
        raise RuntimeError('FBX parse-base URL patch verification failed')
    print('Resolved root-relative FBX URL against document.baseURI before deriving the parse resource path')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
