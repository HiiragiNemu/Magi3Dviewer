#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / 'magia-exedra-character-three' / 'materialProfile.ts'
GEM = ROOT / 'magia-exedra-character-three' / 'shaders' / 'gem.ts'
TEST = ROOT / 'officialMaterialFresnelAniso.test.mjs'
EVIDENCE = ROOT / 'research' / 'official-redrive-gem-depthdiff-runtime-evidence.json'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def patch_profile() -> None:
    text = PROFILE.read_text(encoding='utf-8')
    text = replace_once(
        text,
        '    useDepthDiff: boolean;\n    firstHighlightSize: number;\n',
        '    useDepthDiff: boolean;\n'
        '    /** Serialized `_Transparency`; compiled GemDepthDiff also requires this to be non-zero. */\n'
        '    transparency?: boolean;\n'
        '    firstHighlightSize: number;\n',
        'OfficialGemProfile transparency gate',
    )
    text = replace_once(
        text,
        '            maskMatcapSpecular: false,\n            useDepthDiff: true,\n            firstHighlightSize: 0,\n',
        '            maskMatcapSpecular: false,\n'
        '            useDepthDiff: true,\n'
        '            // Exact current-JP saved property. The compiled Shader gates\n'
        '            // GemDepthDiff on `_UseGemDepthDiff && _Transparency`, so\n'
        '            // this material does not execute the depth-difference branch.\n'
        '            transparency: false,\n'
        '            firstHighlightSize: 0,\n',
        '100101 weapon Soul Gem transparency',
    )
    PROFILE.write_text(text, encoding='utf-8')


def patch_gem() -> None:
    text = GEM.read_text(encoding='utf-8')
    text = replace_once(
        text,
        "    set('uGemUseDepthDiff', gem.useDepthDiff ? 1 : 0);\n"
        "    set('uGemFirstHighlightSize', gem.firstHighlightSize);\n",
        "    set('uGemUseDepthDiff', gem.useDepthDiff ? 1 : 0);\n"
        "    set('uGemTransparency', gem.transparency ? 1 : 0);\n"
        "    set('uGemFirstHighlightSize', gem.firstHighlightSize);\n",
        'Gem transparency uniform setter',
    )
    text = replace_once(
        text,
        '        uniform float uGemUseDepthDiff;\n'
        '        uniform float uGemFirstHighlightSize;\n',
        '        uniform float uGemUseDepthDiff;\n'
        '        uniform float uGemTransparency;\n'
        '        uniform float uGemFirstHighlightSize;\n',
        'Gem transparency uniform declaration',
    )
    old = '''            // Depth-diff gems receive a stronger inner-edge response. In WebGL
            // this is a conservative local approximation until the dedicated
            // ReDrive depth texture pass is ported.
            float rdGemDepthProxy = smoothstep(
                uGemDepthDiffThreshold,
                1.0,
                1.0 - rdGemNdotV
            ) * uGemUseDepthDiff;
            rdGemBase += rdGemTint * rdGemDepthProxy * 0.32;
'''
    new = '''            // Exact current-JP compiled predicate:
            //   (_UseGemDepthDiff != 0) && (_Transparency != 0)
            // `mt_chara_100101_weapon_a_sj` has `_UseGemDepthDiff=1` but
            // `_Transparency=0`, so its official GemDepthDiff contribution is
            // exactly zero. Do not substitute the previous NdotV proxy.
            // The active transparent CameraDepthTexture formula is recovered,
            // but remains deferred until a proven material actually enters it
            // and the scene camera-depth input is wired without approximation.
            float rdGemDepthBranchEnabled =
                uGemUseDepthDiff * uGemTransparency;
            float rdGemDepthSelector = 0.0;
            if (rdGemDepthBranchEnabled > 0.5) {
                rdGemDepthSelector = 0.0; // deferred exact CameraDepthTexture branch
            }
            rdGemBase += rdGemTint * rdGemDepthSelector * 0.32;
'''
    text = replace_once(text, old, new, 'remove NdotV GemDepthDiff proxy')
    GEM.write_text(text, encoding='utf-8')


def patch_test() -> None:
    text = TEST.read_text(encoding='utf-8')
    text = replace_once(
        text,
        "  assert.equal(value.gem.useDepthDiff, true)\n"
        "  assert.equal(value.gem.maskMatcapMetallic, true)\n",
        "  assert.equal(value.gem.useDepthDiff, true)\n"
        "  assert.equal(value.gem.transparency, false)\n"
        "  assert.equal(value.gem.maskMatcapMetallic, true)\n",
        'weapon GemDepthDiff predicate test',
    )
    append = '''\n
test('100101 weapon GemDepthDiff follows exact current-JP transparency predicate', () => {
  assert.match(gem, /uGemUseDepthDiff \\* uGemTransparency/)
  assert.match(gem, /official GemDepthDiff contribution is/)
  assert.doesNotMatch(gem, /rdGemDepthProxy/)
  assert.doesNotMatch(gem, /1\\.0 - rdGemNdotV/)
})
'''
    if "GemDepthDiff follows exact current-JP transparency predicate" not in text:
        text += append
    TEST.write_text(text, encoding='utf-8')


def write_evidence() -> None:
    payload = {
        'schemaVersion': 1,
        'source': 'official-jp-current-modern-ReDrive-Shader-plus-Material-saved-properties',
        'assetBundleRevision': '61ad830ca038a9efd58e67170a61c85e',
        'material': 'mt_chara_100101_weapon_a_sj',
        'compiledShader': {
            'chunkIndex': 2,
            'platform': 9,
            'decodedSha256': '65536f9156cf560226d40a4094f1a27c448f6b2bfca1a8d6a77a8de89ee4f62a',
            'predicateOffsets': [334276, 334343, 334385],
            'predicate': '(_UseGemDepthDiff != 0) && (_Transparency != 0)',
            'cameraDepthFetchOffset': 334921,
            'depthDeltaScaleOffset': 335339,
            'thresholdOffsets': [335424, 335479, 335524],
        },
        'savedProperties': {
            '_UseGemDepthDiff': 1.0,
            '_Transparency': 0.0,
            '_GemDepthDiffThreshold': 0.5,
        },
        'runtimeConclusion': {
            'depthDiffBranchEnabled': False,
            'webAction': 'remove previous NdotV depth proxy for this proven current-JP material',
        },
        'deferred': (
            'Exact active `_Transparency != 0` CameraDepthTexture branch is not claimed as restored; '
            'it remains deferred until a proven material enters that branch and the camera-depth input is wired.'
        ),
    }
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def verify() -> None:
    profile = PROFILE.read_text(encoding='utf-8')
    gem = GEM.read_text(encoding='utf-8')
    test = TEST.read_text(encoding='utf-8')
    assert 'transparency: false' in profile
    assert "set('uGemTransparency', gem.transparency ? 1 : 0);" in gem
    assert 'uGemUseDepthDiff * uGemTransparency' in gem
    assert 'rdGemDepthProxy' not in gem
    assert 'GemDepthDiff follows exact current-JP transparency predicate' in test
    evidence = json.loads(EVIDENCE.read_text(encoding='utf-8'))
    assert evidence['runtimeConclusion']['depthDiffBranchEnabled'] is False
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


def main() -> int:
    patch_profile()
    patch_gem()
    patch_test()
    write_evidence()
    verify()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
