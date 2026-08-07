#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHARACTER = ROOT / 'magia-exedra-character-three/models/chara_100107_battle_unit'
OUTPUT = ROOT / 'research/character-100107-material-audit.json'


def read_fbx_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if path.suffix == '.gz' or data[:2] == b'\x1f\x8b':
        return gzip.decompress(data)
    return data


def strings(data: bytes, minimum: int = 4) -> list[str]:
    pattern = rb'[\x20-\x7e]{' + str(minimum).encode() + rb',}'
    return [match.decode('ascii', errors='ignore') for match in re.findall(pattern, data)]


def unique_sorted(values):
    return sorted(set(values), key=lambda value: value.lower())


def main() -> int:
    if not CHARACTER.is_dir():
        raise FileNotFoundError(CHARACTER)
    files = sorted(path for path in CHARACTER.iterdir() if path.is_file())
    fbx_candidates = [path for path in files if '.fbx' in path.name.lower()]
    if not fbx_candidates:
        raise RuntimeError('100107 bundle has no FBX payload')

    all_strings: list[str] = []
    fbx_reports = []
    for path in fbx_candidates:
        payload = read_fbx_bytes(path)
        text = strings(payload)
        all_strings.extend(text)
        fbx_reports.append({
            'file': path.name,
            'compressedBytes': path.stat().st_size,
            'decodedBytes': len(payload),
            'header': payload[:24].decode('ascii', errors='replace'),
        })

    joined = '\n'.join(all_strings)
    material_tokens = unique_sorted(re.findall(
        r'(?i)(?:Material::)?(mt_chara_100107_[A-Za-z0-9_.-]+)', joined
    ))
    character_tokens = unique_sorted(re.findall(
        r'(?i)(chara_100107_[A-Za-z0-9_.-]+)', joined
    ))
    feature_tokens = unique_sorted(
        value for value in all_strings
        if any(token in value.lower() for token in (
            '_sj', 'jewel', 'gem', 'aniso', 'fresnel', 'shoe', 'boot',
            'metal', 'specular', 'glass', 'trans', 'cosmic', 'depth',
        )) and len(value) < 220
    )

    texture_files = [
        path.name for path in files
        if path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.tga', '.dds'}
    ]
    report = {
        'schemaVersion': 1,
        'characterId': 100107,
        'directory': CHARACTER.relative_to(ROOT).as_posix(),
        'fileCount': len(files),
        'files': [{'name': path.name, 'bytes': path.stat().st_size} for path in files],
        'fbx': fbx_reports,
        'materialTokens': material_tokens,
        'characterTokens': character_tokens,
        'featureRelevantStrings': feature_tokens[:1000],
        'textures': {
            'all': texture_files,
            'color': [x for x in texture_files if 'color' in x.lower()],
            'shadow': [x for x in texture_files if 'shadow' in x.lower()],
            'control': [x for x in texture_files if 'ctrl' in x.lower()],
            'gemMatCap': [x for x in texture_files if 'gem_matcap' in x.lower() or ('matcap' in x.lower() and 'metallic_gradient' not in x.lower())],
            'metallicGradient': [x for x in texture_files if 'metallic_gradient' in x.lower()],
            'highlight': [x for x in texture_files if 'highlight' in x.lower()],
        },
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'materialTokens': material_tokens,
        'featureRelevantStrings': feature_tokens[:100],
        'gemMatCap': report['textures']['gemMatCap'],
        'metallicGradient': report['textures']['metallicGradient'],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
