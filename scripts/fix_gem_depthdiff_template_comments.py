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


def patch_chunk(chunk: str, label: str) -> str:
    for old, new in REPLACEMENTS.items():
        old_count = chunk.count(old)
        new_count = chunk.count(new)
        if old_count == 1 and new_count == 0:
            chunk = chunk.replace(old, new, 1)
        elif old_count == 0 and new_count in {0, 1}:
            continue
        else:
            raise RuntimeError(
                f'{label}: Gem template comment contract drifted for {old!r}: '
                f'old_count={old_count}, new_count={new_count}'
            )
    return chunk


def main() -> int:
    text = PATH.read_text(encoding='utf-8')

    # Scope edits strictly to the two injected GLSL template bodies. An
    # identical research sentence intentionally exists in an ordinary
    # TypeScript comment outside the template and must not be rewritten just to
    # satisfy the parser cleanup.
    first_marker = "shader.fragmentShader = /* glsl */ `"
    first_start = text.index(first_marker) + len(first_marker)
    first_end = text.index("    `.replace(", first_start)
    second_marker = "        /* glsl */ `"
    second_start = text.index(second_marker, first_end) + len(second_marker)
    second_end = text.index("        `,\n    );", second_start)

    first_chunk = patch_chunk(text[first_start:first_end], 'prefix GLSL template')
    second_chunk = patch_chunk(text[second_start:second_end], 'opaque-fragment GLSL template')

    if '`' in first_chunk:
        raise RuntimeError('prefix GLSL template still contains an unescaped backtick')
    if '`' in second_chunk:
        raise RuntimeError('opaque-fragment GLSL template still contains an unescaped backtick')

    text = (
        text[:first_start]
        + first_chunk
        + text[first_end:second_start]
        + second_chunk
        + text[second_end:]
    )
    PATH.write_text(text, encoding='utf-8')
    print('GemDepthDiff GLSL template comments contain no accidental backticks.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
