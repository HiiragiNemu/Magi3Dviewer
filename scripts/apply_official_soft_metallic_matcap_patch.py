#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / 'magia-exedra-character-three' / 'materialProfile.ts'
GEM = ROOT / 'magia-exedra-character-three' / 'shaders' / 'gem.ts'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def patch_profile() -> None:
    text = PROFILE.read_text(encoding='utf-8')
    text = replace_once(
        text,
        "export interface OfficialGemProfile {\n    enabled: boolean;\n    useMatCap: boolean;\n",
        "export type OfficialGemMatCapSource = 'character-or-fallback' | 'soft-metallic';\n\nexport interface OfficialGemProfile {\n    enabled: boolean;\n    useMatCap: boolean;\n    /** Exact serialized MatCap dependency when recovered; otherwise character package/fallback. */\n    matCapSource: OfficialGemMatCapSource;\n",
        'gem matcap source field',
    )
    text = text.replace(
        "    useMatCap: false,\n    matCapIntensity: 0,",
        "    useMatCap: false,\n    matCapSource: 'character-or-fallback',\n    matCapIntensity: 0,",
        1,
    )
    text = text.replace(
        "    useMatCap: true,\n    matCapIntensity: 2,",
        "    useMatCap: true,\n    matCapSource: 'character-or-fallback',\n    matCapIntensity: 2,",
        1,
    )

    body_marker = "['mt_chara_100101_body_sj', {"
    body_index = text.index(body_marker)
    body_use = text.index('            useMatCap: true,', body_index)
    body_insert = body_use + len('            useMatCap: true,')
    text = text[:body_insert] + "\n            matCapSource: 'soft-metallic'," + text[body_insert:]

    weapon_marker = "['mt_chara_100101_weapon_a_sj', {"
    weapon_index = text.index(weapon_marker)
    weapon_use = text.index('            useMatCap: true,', weapon_index)
    weapon_insert = weapon_use + len('            useMatCap: true,')
    text = text[:weapon_insert] + "\n            matCapSource: 'soft-metallic'," + text[weapon_insert:]

    PROFILE.write_text(text, encoding='utf-8')


def patch_gem() -> None:
    text = GEM.read_text(encoding='utf-8')
    text = replace_once(
        text,
        "import DefaultGemMatCap from '../models/chara_109801_battle_unit/matcap02_invert.png';\n",
        "import DefaultGemMatCap from '../models/chara_109801_battle_unit/matcap02_invert.png';\nimport OfficialSoftMetallicMatCap from '../models/common/matcap_SoftMetallic.png';\n",
        'soft metallic import',
    )
    text = replace_once(
        text,
        """    // Character bundles may ship their own Gem MatCap.  Use that exact
    // texture first; the historical 109801 texture is only a fallback for
    // bundles where no dedicated MatCap was exported.
    const matCap = await loadTexture(matCapUrl ?? DefaultGemMatCap, {
        colorSpace: THREE.NoColorSpace,
    });
""",
        """    // Exact current-JP evidence for 100101/100107 body_SJ and
    // weapon_a_sj resolves `_MatCapTex` to the common 256x256
    // `matcap_SoftMetallic` texture. Do not substitute a character-package
    // guess or the historical 109801 fallback for those material slots.
    const requiresSoftMetallic = profiles.some(
        profile =>
            profile.gem.enabled &&
            profile.gem.useMatCap &&
            profile.gem.matCapSource === 'soft-metallic',
    );
    const resolvedMatCapUrl = requiresSoftMetallic
        ? OfficialSoftMetallicMatCap
        : (matCapUrl ?? DefaultGemMatCap);
    const matCap = await loadTexture(resolvedMatCapUrl, {
        colorSpace: THREE.NoColorSpace,
    });
""",
        'gem resource selection',
    )
    GEM.write_text(text, encoding='utf-8')


def main() -> int:
    patch_profile()
    patch_gem()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
