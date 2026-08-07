#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

PATH = Path('magia-exedra-character-three/scene/selfShadow.ts')

OLD_SETUP = '''        // Never sample the same RT while its depth attachment is being written.\n        reDriveSelfShadowUniformState.enabled.value = 0\n'''
NEW_SETUP = '''        // WebGL rejects a framebuffer attachment that is still bound to an\n        // active sampler even when the shader branch using that sampler is\n        // disabled.  Preserve the exact ReDrive self-shadow texture, but truly\n        // unbind it while writing the same depth attachment.\n        const oldSelfShadowMap = reDriveSelfShadowUniformState.map.value\n        reDriveSelfShadowUniformState.enabled.value = 0\n        reDriveSelfShadowUniformState.map.value = null\n'''

OLD_RESTORE = '''            renderer.setRenderTarget(oldTarget)\n            renderer.setClearColor(this.previousClearColor, oldClearAlpha)\n'''
NEW_RESTORE = '''            renderer.setRenderTarget(oldTarget)\n            reDriveSelfShadowUniformState.map.value = oldSelfShadowMap\n            renderer.setClearColor(this.previousClearColor, oldClearAlpha)\n'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    if old_count == 0 and new_count == 1:
        return text
    raise RuntimeError(
        f'{label} contract drifted: old_count={old_count}, new_count={new_count}'
    )


def main() -> int:
    text = PATH.read_text(encoding='utf-8')
    text = replace_once(text, OLD_SETUP, NEW_SETUP, 'self-shadow map unbind')
    text = replace_once(text, OLD_RESTORE, NEW_RESTORE, 'self-shadow map restore')

    if text.count('reDriveSelfShadowUniformState.map.value = null') < 2:
        # One is dispose(), one is the render-target write guard.
        raise RuntimeError('expected render-target unbind plus dispose-time unbind')
    if text.count('reDriveSelfShadowUniformState.map.value = oldSelfShadowMap') != 1:
        raise RuntimeError('expected exactly one render-target map restore')

    PATH.write_text(text, encoding='utf-8')
    print(
        'Applied fail-closed WebGL feedback-loop guard: '
        'self-shadow sampler is null while its depth attachment is rendered.'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
