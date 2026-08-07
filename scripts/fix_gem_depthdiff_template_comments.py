#!/usr/bin/env python3
from pathlib import Path

PATH = Path('magia-exedra-character-three/shaders/gem.ts')

REPLACEMENTS = {
    '// `_UseGemDepthDiff != 0 && _Transparency != 0`.':
        '// _UseGemDepthDiff != 0 && _Transparency != 0.',
    '// `1 - _GemDepthDiffThreshold`; true maps to 0, false maps to 1.':
        '// 1 - _GemDepthDiffThreshold; true maps to 0, false maps to 1.',
    '// The old NdotV `rdGemDepthProxy` has been removed completely.':
        '// The old NdotV rdGemDepthProxy implementation has been removed completely.',
    '// colour transport (`ShadowTex` + global tint + Web SH/light path)':
        '// colour transport (ShadowTex + global tint + Web SH/light path)',
    '// `rdToonShadowColor` equals native `_BaseMap * _ShadowColor`.':
        '// rdToonShadowColor equals native _BaseMap * _ShadowColor.',
}


def main() -> int:
    text = PATH.read_text(encoding='utf-8')
    for old, new in REPLACEMENTS.items():
        old_count = text.count(old)
        new_count = text.count(new)
        if old_count == 1 and new_count == 0:
            text = text.replace(old, new, 1)
        elif old_count == 0 and new_count == 1:
            continue
        else:
            raise RuntimeError(
                f'Gem template comment contract drifted for {old!r}: '
                f'old_count={old_count}, new_count={new_count}'
            )

    # The injected GLSL spans two TypeScript template literals. There must be
    # no Markdown-style backtick left inside their GLSL comments because it
    # would terminate the surrounding TypeScript template literal.
    marker = "shader.fragmentShader = /* glsl */ `"
    first = text.index(marker) + len(marker)
    replace_call = text.index("    `.replace(", first)
    second_marker = "        /* glsl */ `"
    second = text.index(second_marker, replace_call) + len(second_marker)
    second_end = text.index("        `,\n    );", second)
    for label, chunk in (
        ('prefix GLSL template', text[first:replace_call]),
        ('opaque-fragment GLSL template', text[second:second_end]),
    ):
        if '`' in chunk:
            raise RuntimeError(f'{label} still contains an unescaped backtick')

    PATH.write_text(text, encoding='utf-8')
    print('GemDepthDiff GLSL template comments contain no accidental backticks.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
