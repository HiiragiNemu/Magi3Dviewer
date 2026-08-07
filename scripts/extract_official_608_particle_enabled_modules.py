#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

SOURCE = Path('research/official-608-particle-systems.json')
OUTPUT = Path('research/official-608-particle-enabled-modules.json')
MODULES = ('SizeModule', 'RotationModule', 'UVModule')
MAX_PROFILE_BYTES = 96 * 1024
MAX_TOTAL_BYTES = 512 * 1024


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def sha(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def components(report: dict[str, Any], type_name: str) -> list[dict[str, Any]]:
    return [
        item for item in report.get('components', [])
        if isinstance(item, dict) and item.get('type') == type_name
    ]


def main() -> int:
    source = json.loads(SOURCE.read_text(encoding='utf-8'))
    systems = components(source, 'ParticleSystem')
    if len(systems) != 6:
        raise RuntimeError(f'Expected six current-JP ParticleSystem components, got {len(systems)}')

    output: dict[str, Any] = {
        'schemaVersion': 1,
        'source': 'official-jp-current-608-particle-components',
        'assetBundleRevision': (source.get('metadata') or {}).get('assetBundleRevision'),
        'systemCount': len(systems),
        'modules': {},
        'interpretation': (
            'Values below are exact serialized current-JP ParticleSystem module evidence. '
            'Curve evaluation, random stream equivalence, native integrator order, billboard camera-facing rules '
            'and render sorting remain separate implementation questions and must not be inferred from serialization alone.'
        ),
    }

    total_profile_bytes = 0
    for module_name in MODULES:
        unique: dict[str, dict[str, Any]] = {}
        assignments: list[dict[str, Any]] = []
        for component in systems:
            tree = component.get('typetree') or {}
            module = tree.get(module_name)
            if not isinstance(module, dict):
                raise RuntimeError(
                    f'{component.get("gameObjectPath")}: missing dictionary {module_name}'
                )
            digest = sha(module)
            encoded = canonical(module).encode('utf-8')
            if len(encoded) > MAX_PROFILE_BYTES:
                raise RuntimeError(
                    f'{module_name} profile {digest} is unexpectedly large: {len(encoded)} bytes'
                )
            total_profile_bytes += len(encoded) if digest not in unique else 0
            unique.setdefault(digest, {
                'sha256': digest,
                'bytes': len(encoded),
                'profile': module,
            })
            assignments.append({
                'gameObjectPath': component.get('gameObjectPath'),
                'particleSystemPathId': component.get('pathId'),
                'profileSha256': digest,
            })
        output['modules'][module_name] = {
            'uniqueProfileCount': len(unique),
            'profiles': list(unique.values()),
            'assignments': assignments,
        }

    if total_profile_bytes > MAX_TOTAL_BYTES:
        raise RuntimeError(f'Enabled-module evidence too large: {total_profile_bytes} bytes')

    encoded = json.dumps(output, ensure_ascii=False, indent=2) + '\n'
    OUTPUT.write_text(encoded, encoding='utf-8')
    print(json.dumps({
        'output': str(OUTPUT),
        'bytes': len(encoded.encode('utf-8')),
        'moduleUniqueProfileCounts': {
            name: value['uniqueProfileCount']
            for name, value in output['modules'].items()
        },
        'assignments': {
            name: [row['profileSha256'][:12] for row in value['assignments']]
            for name, value in output['modules'].items()
        },
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
