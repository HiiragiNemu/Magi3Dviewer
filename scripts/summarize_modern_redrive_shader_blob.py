#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SOURCE = Path('research/official-redrive-modern-shader-blob.json')
OUTPUT = Path('research/official-redrive-modern-shader-blob-summary.json')

INTERESTING_EXACT = {
    'm_Platforms', 'm_Offsets', 'm_CompressedLengths', 'm_DecompressedLengths',
    'm_CompressedBlob', 'm_ParsedForm', 'm_SubPrograms', 'm_Program',
    'm_PlayerSubPrograms', 'm_ProgramBlob', 'm_Dependencies', 'm_NameIndices',
}
INTERESTING_TOKENS = (
    'platform', 'offset', 'compress', 'decompress', 'blob', 'subprogram',
    'program', 'gpu', 'pass', 'keyword', 'dependency', 'nameindices',
)


def is_summary(value: Any) -> bool:
    return isinstance(value, dict) and set(value) <= {
        'type', 'length', 'sha256', 'headHex', 'tailHex', 'items', 'truncated',
        'repr', 'callable', 'error'
    }


def collect(value: Any, path: str = '', depth: int = 0) -> list[dict[str, Any]]:
    if depth > 10:
        return []
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            key_s = str(key)
            child_path = f'{path}.{key_s}' if path else key_s
            lower = key_s.lower()
            if key_s in INTERESTING_EXACT or any(token in lower for token in INTERESTING_TOKENS):
                found.append({
                    'path': child_path,
                    'value': child,
                })
            if isinstance(child, (dict, list)) and not is_summary(child):
                found.extend(collect(child, child_path, depth + 1))
    elif isinstance(value, list):
        for index, child in enumerate(value[:128]):
            child_path = f'{path}[{index}]'
            if isinstance(child, (dict, list)):
                found.extend(collect(child, child_path, depth + 1))
    return found


def compact(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        if isinstance(value, (dict, list)):
            return {'type': type(value).__name__, 'length': len(value)}
        return value
    if isinstance(value, dict):
        # Byte/list summaries from the prior extractor are already bounded.
        if is_summary(value):
            return value
        return {str(key): compact(child, depth + 1) for key, child in list(value.items())[:80]}
    if isinstance(value, list):
        return [compact(child, depth + 1) for child in value[:80]]
    return value


def main() -> int:
    data = json.loads(SOURCE.read_text(encoding='utf-8'))
    shader = data['shader']
    typetree = shader.get('typetree') or {}
    attrs = shader.get('selectedAttributes') or {}
    candidates = collect(typetree)
    candidates.extend(
        {'path': f'selectedAttributes.{key}', 'value': value}
        for key, value in attrs.items()
    )
    # De-duplicate identical paths while preserving first occurrence.
    by_path: dict[str, Any] = {}
    for item in candidates:
        by_path.setdefault(item['path'], item['value'])

    report = {
        'schemaVersion': 1,
        'source': data.get('source'),
        'metadata': data.get('metadata'),
        'shader': {
            'pathId': shader.get('pathId'),
            'serializedFile': shader.get('serializedFile'),
            'rawObject': shader.get('rawObject'),
        },
        'candidateCount': len(by_path),
        'candidates': [
            {'path': path, 'value': compact(value)}
            for path, value in sorted(by_path.items())
        ],
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
