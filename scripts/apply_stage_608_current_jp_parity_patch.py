#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

CATALOG = Path('public/stages/catalog/battle-608-00-00-001.json')
LOADER = Path('magia-exedra-character-three/loader.ts')

EXPECTED_ALPHA_TESTS = {
    'bg3d608_00_blue_ChairCD': 0.8999999761581421,
    'mt_bg3d608_00_red_MusicNoteA': 0.10000000149011612,
    'mt_bg3d608_00_red_MusicNoteB': 0.5,
    'mt_bg3d608_00_red_MusicNoteC': 0.699999988079071,
    'mt_bg3d608_00_red_violinCol': 0.5,
    'mt_bg3d608_00_red_violinShdLine': 0.5,
}

# Exact current-JP serialized state for all six target Materials:
# _Surface=0, _ALPHATEST_ON, _SrcBlend=1, _DstBlend=0, _ZWrite=1,
# renderQueue=2450. Three.js opaque alpha-test is the proven semantic match for
# blend/depth behavior. renderOrder=2450 preserves the serialized queue number
# only as ordering metadata; it is NOT claimed to be Unity renderQueue parity.
EXPECTED_TRANSPARENT = False
EXPECTED_RENDER_ORDER = 2450
LEGACY_ALPHA_TEST = 0.01
LEGACY_TRANSPARENT = True
LEGACY_RENDER_ORDER = 3000
LOADER_OLD = "new URL('.', fbxUrl).href,"
LOADER_NEW = "new URL('.', new URL(fbxUrl, document.baseURI)).href,"


def find_binding_span(text: str, material_name: str) -> tuple[int, int]:
    needle = f'"materialName": "{material_name}"'
    start = text.find(needle)
    if start < 0:
        raise RuntimeError(f'missing material binding: {material_name}')
    next_binding = text.find('"materialName": "', start + len(needle))
    end = len(text) if next_binding < 0 else next_binding
    return start, end


def patch_scalar(
    text: str,
    material_name: str,
    key: str,
    expected: str,
    allowed_existing: set[str],
) -> str:
    start, end = find_binding_span(text, material_name)
    block = text[start:end]
    pattern = re.compile(rf'("{re.escape(key)}"\s*:\s*)([^,\n}}]+)')
    matches = list(pattern.finditer(block))
    if len(matches) != 1:
        raise RuntimeError(
            f'{material_name}: expected exactly one {key}, got {len(matches)}'
        )
    match = matches[0]
    current = match.group(2).strip()
    if current not in allowed_existing:
        raise RuntimeError(
            f'{material_name}: refusing unexpected {key}={current}; '
            f'allowed={sorted(allowed_existing)}'
        )
    block = block[:match.start(2)] + expected + block[match.end(2):]
    return text[:start] + block + text[end:]


def patch_alpha_test(text: str, material_name: str, expected: float) -> str:
    start, end = find_binding_span(text, material_name)
    block = text[start:end]
    matches = list(re.finditer(r'("alphaTest"\s*:\s*)([-+0-9.eE]+)', block))
    if len(matches) != 1:
        raise RuntimeError(
            f'{material_name}: expected exactly one alphaTest, got {len(matches)}'
        )
    match = matches[0]
    current = float(match.group(2))
    allowed = (LEGACY_ALPHA_TEST, expected)
    if not any(abs(current - value) <= 1e-12 for value in allowed):
        raise RuntimeError(
            f'{material_name}: refusing unexpected alphaTest {current}; allowed {allowed}'
        )
    replacement = repr(expected)
    block = block[:match.start(2)] + replacement + block[match.end(2):]
    return text[:start] + block + text[end:]


def patch_binding(text: str, material_name: str, alpha_test: float) -> str:
    text = patch_alpha_test(text, material_name, alpha_test)
    text = patch_scalar(
        text,
        material_name,
        'transparent',
        'false',
        {'true', 'false'},
    )
    text = patch_scalar(
        text,
        material_name,
        'renderOrder',
        str(EXPECTED_RENDER_ORDER),
        {str(LEGACY_RENDER_ORDER), str(EXPECTED_RENDER_ORDER)},
    )
    return text


def verify_catalog(text: str) -> None:
    parsed = json.loads(text)
    bindings = {
        item['materialName']: item
        for item in parsed.get('materialBindings', [])
        if isinstance(item, dict) and isinstance(item.get('materialName'), str)
    }
    for material_name, expected in EXPECTED_ALPHA_TESTS.items():
        binding = bindings.get(material_name)
        if binding is None:
            raise RuntimeError(f'verification missing material: {material_name}')
        actual = binding.get('alphaTest')
        if not isinstance(actual, (int, float)) or abs(float(actual) - expected) > 1e-12:
            raise RuntimeError(
                f'{material_name}: alphaTest verification failed: {actual} != {expected}'
            )
        if binding.get('transparent') is not EXPECTED_TRANSPARENT:
            raise RuntimeError(
                f'{material_name}: expected opaque alpha-cutout transparent=false'
            )
        if binding.get('renderOrder') != EXPECTED_RENDER_ORDER:
            raise RuntimeError(
                f'{material_name}: expected renderOrder metadata {EXPECTED_RENDER_ORDER}, '
                f'got {binding.get("renderOrder")}'
            )


def patch_loader(text: str) -> str:
    old_count = text.count(LOADER_OLD)
    new_count = text.count(LOADER_NEW)
    if old_count == 1 and new_count == 0:
        return text.replace(LOADER_OLD, LOADER_NEW, 1)
    if old_count == 0 and new_count == 1:
        return text
    raise RuntimeError(
        f'loader URL-base contract drifted: old_count={old_count}, new_count={new_count}'
    )


def main() -> int:
    catalog_text = CATALOG.read_text(encoding='utf-8')
    for material_name, expected in EXPECTED_ALPHA_TESTS.items():
        catalog_text = patch_binding(catalog_text, material_name, expected)
    verify_catalog(catalog_text)
    CATALOG.write_text(catalog_text, encoding='utf-8')

    loader_text = LOADER.read_text(encoding='utf-8')
    loader_text = patch_loader(loader_text)
    if loader_text.count(LOADER_NEW) != 1 or loader_text.count(LOADER_OLD) != 0:
        raise RuntimeError('loader URL-base verification failed after patch')
    LOADER.write_text(loader_text, encoding='utf-8')

    print(json.dumps({
        'catalog': str(CATALOG),
        'loader': str(LOADER),
        'alphaTests': EXPECTED_ALPHA_TESTS,
        'surface': {
            'currentJpSerialized': {
                '_Surface': 0,
                '_SrcBlend': 1,
                '_DstBlend': 0,
                '_ZWrite': 1,
                'renderQueue': 2450,
                'keyword': '_ALPHATEST_ON',
            },
            'webBinding': {
                'transparent': EXPECTED_TRANSPARENT,
                'renderOrder': EXPECTED_RENDER_ORDER,
            },
            'fidelity': {
                'opaqueAlphaCutoutBlendDepthSemantics': 'exact-current-JP-saved-properties',
                'unityRenderQueueToThreeRenderOrder': 'ordering-approximation',
            },
        },
        'loaderBaseResolution': LOADER_NEW,
        'source': 'current-JP Material savedProperties + browser regression',
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
