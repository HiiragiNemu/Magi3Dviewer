#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / 'public' / 'stages' / 'catalog' / 'battle-608-00-00-001.json'
MATERIAL = 'bg3d608_00_blue_ChairCD'
EXACT_ALPHA_TEST = 0.8999999761581421
DEFERRED = (
    'bg3d608_00_blue_ChairCD exact Unity ZWrite=0/renderQueue=3000 ordering remains deferred; '
    'Web restores the current-JP alpha-cutout threshold and transparent blend path but StageMaterialBinding '
    'does not yet expose an exact depth-write/render-queue mapping.'
)
EVIDENCE = (
    'Current JP bg3d608_00_blue_ChairCD: renderQueue 3000, _ALPHATEST_ON, '
    '_AlphaClip=1, _Alpha_Clip=0.8999999761581421, _Surface=1, '
    '_SrcBlend=5, _DstBlend=10 and _ZWrite=0.'
)


def main() -> int:
    data = json.loads(STAGE.read_text(encoding='utf-8'))
    bindings = data.get('materialBindings') or []
    matches = [binding for binding in bindings if binding.get('materialName') == MATERIAL]
    if len(matches) != 1:
        raise RuntimeError(f'Expected exactly one {MATERIAL} binding, found {len(matches)}')
    binding = matches[0]

    if binding.get('shading') != 'lit':
        raise RuntimeError(f'{MATERIAL}: unexpected shading={binding.get("shading")!r}')
    expected_map = './stages/official/battle-608-00-00-001/bg3d608_00_blue_objects_col.png'
    if binding.get('baseMapUrl') != expected_map:
        raise RuntimeError(f'{MATERIAL}: unexpected baseMapUrl={binding.get("baseMapUrl")!r}')

    existing_alpha = binding.get('alphaTest')
    if existing_alpha not in (None, EXACT_ALPHA_TEST):
        raise RuntimeError(f'{MATERIAL}: refusing to overwrite unexpected alphaTest={existing_alpha!r}')
    existing_transparent = binding.get('transparent')
    if existing_transparent not in (None, True):
        raise RuntimeError(f'{MATERIAL}: refusing to overwrite transparent={existing_transparent!r}')

    binding['alphaTest'] = EXACT_ALPHA_TEST
    binding['transparent'] = True

    restoration = data.setdefault('restorationStatus', {})
    missing = restoration.setdefault('missing', [])
    evidence = restoration.setdefault('evidence', [])
    if DEFERRED not in missing:
        missing.append(DEFERRED)
    if EVIDENCE not in evidence:
        evidence.append(EVIDENCE)

    STAGE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    verify = json.loads(STAGE.read_text(encoding='utf-8'))
    rebound = next(item for item in verify['materialBindings'] if item.get('materialName') == MATERIAL)
    assert rebound['alphaTest'] == EXACT_ALPHA_TEST
    assert rebound['transparent'] is True
    assert DEFERRED in verify['restorationStatus']['missing']
    assert EVIDENCE in verify['restorationStatus']['evidence']
    print(json.dumps({
        'material': MATERIAL,
        'alphaTest': rebound['alphaTest'],
        'transparent': rebound['transparent'],
        'deferred': DEFERRED,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
