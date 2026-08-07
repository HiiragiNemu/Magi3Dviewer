#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'magia-exedra-character-three' / 'scene' / 'selfShadow.ts'

OLD_HEAD = """        const outlineStates: Array<[THREE.Object3D, boolean]> = []\n\n        // Never sample the same RT while its depth attachment is being written.\n        reDriveSelfShadowUniformState.enabled.value = 0\n"""
NEW_HEAD = """        const outlineStates: Array<[THREE.Object3D, boolean]> = []\n        const receiverShadowMap = reDriveSelfShadowUniformState.map.value\n\n        // The native caster pass does not bind its receiver shadow map while\n        // writing that same depth attachment. Merely branching on `enabled` is\n        // insufficient in WebGL: an active sampler that references the current\n        // framebuffer attachment still forms an illegal feedback loop. Keep the\n        // authored skinned/alpha-tested caster materials, but explicitly unbind\n        // only the injected ReDrive receiver sampler for this pass.\n        reDriveSelfShadowUniformState.enabled.value = 0\n        reDriveSelfShadowUniformState.map.value = null\n"""

OLD_TAIL = """            renderer.autoClear = oldAutoClear\n            renderer.xr.enabled = oldXrEnabled\n        }\n"""
NEW_TAIL = """            renderer.autoClear = oldAutoClear\n            renderer.xr.enabled = oldXrEnabled\n            reDriveSelfShadowUniformState.map.value = receiverShadowMap\n        }\n"""


def main() -> int:
    text = TARGET.read_text(encoding='utf-8')
    already = NEW_HEAD in text and NEW_TAIL in text
    if already:
        print('Self-shadow receiver sampler is already detached during the caster pass')
        return 0
    if text.count(OLD_HEAD) != 1:
        raise RuntimeError(f'Expected one guarded caster-pass head, found {text.count(OLD_HEAD)}')
    if text.count(OLD_TAIL) != 1:
        raise RuntimeError(f'Expected one guarded caster-pass tail, found {text.count(OLD_TAIL)}')
    text = text.replace(OLD_HEAD, NEW_HEAD, 1).replace(OLD_TAIL, NEW_TAIL, 1)
    TARGET.write_text(text, encoding='utf-8')
    verify = TARGET.read_text(encoding='utf-8')
    if NEW_HEAD not in verify:
        raise RuntimeError('Guarded caster-pass receiver sampler detach was not persisted')
    if NEW_TAIL not in verify:
        raise RuntimeError('Guarded caster-pass receiver sampler restore was not persisted')
    print('Detached ReDrive receiver sampler only while its depth attachment is the active render target')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
