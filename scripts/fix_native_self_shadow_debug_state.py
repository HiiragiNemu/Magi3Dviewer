#!/usr/bin/env python3
from pathlib import Path

path = Path('magia-exedra-character-three/scene/selfShadow.ts')
text = path.read_text(encoding='utf-8')
old = """        return {\n            enabled: reDriveSelfShadowUniformState.enabled.value > 0.5,\n            source: 'TW-native-ReDriveToonSelfShadowPass',\n            ...officialReDriveSelfShadowSettings,\n"""
new = """        return {\n            ...officialReDriveSelfShadowSettings,\n            enabled: reDriveSelfShadowUniformState.enabled.value > 0.5,\n            source: 'TW-native-ReDriveToonSelfShadowPass',\n"""
if old not in text:
    raise SystemExit('native self-shadow debug-state anchor not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('fixed native self-shadow debug-state spread order')
