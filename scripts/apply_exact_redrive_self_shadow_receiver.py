from pathlib import Path
import re

shadow = Path('magia-exedra-character-three/scene/selfShadow.ts')
general = Path('magia-exedra-character-three/shaders/general.ts')
face = Path('magia-exedra-character-three/shaders/face.ts')


def replace_once(path, old, new, label):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: {label}: expected 1 literal match, got {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'patched {path}: {label}')


def regex_once(path, pattern, replacement, label):
    text = path.read_text(encoding='utf-8')
    new, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path}: {label}: expected 1 regex match, got {count}')
    path.write_text(new, encoding='utf-8')
    print(f'patched {path}: {label}')

# Pass exact fragment view depth needed by the native 2-unit range fade.
replace_once(
    shadow,
    "        varying vec3 vRdToonWorldPosition;\n        ${shader.vertexShader}\n",
    "        varying vec3 vRdToonWorldPosition;\n        varying float vRdToonViewDepth;\n        ${shader.vertexShader}\n",
    'vertex view-depth varying declaration',
)
replace_once(
    shadow,
    "        vRdToonWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\n",
    "        vRdToonWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\n        vRdToonViewDepth = -mvPosition.z;\n",
    'vertex view-depth assignment',
)
replace_once(
    shadow,
    "        varying vec3 vRdToonWorldPosition;\n        uniform sampler2D tRdToonSelfShadowMap;\n",
    "        varying vec3 vRdToonWorldPosition;\n        varying float vRdToonViewDepth;\n        uniform sampler2DShadow tRdToonSelfShadowMap;\n",
    'hardware comparison sampler',
)

# Replace the old Web-only manual 2x2 PCF with the recovered current-JP receiver:
# one comparison-sampler lookup, depth bias before compare, 2-unit range fade,
# optional smoothstep(0.1,0.2,N.L) fix, and disabled/out-of-range => fully lit.
regex_once(
    shadow,
    r'''        float rdToonSelfShadowVisibility\(vec3 worldPosition\) \{.*?\n        \}\n\n        \$\{shader\.fragmentShader\}''',
    '''        float rdToonSelfShadowVisibility(\n            vec3 worldPosition,\n            vec3 viewNormal\n        ) {\n            if (uRdToonSelfShadowEnabled < 0.5) return 1.0;\n\n            // Current-JP compiled ReDriveToon receiver. The native pass is\n            // orthographic, so clip W is 1; keep the homogeneous divide only\n            // as a defensive Web invariant. Native converts XYZ from [-1,1]\n            // to [0,1] before subtracting the global receiver depth bias.\n            vec4 shadowClip =\n                uRdToonSelfShadowWorldToClip * vec4(worldPosition, 1.0);\n            if (abs(shadowClip.w) <= 0.000001) return 1.0;\n            vec3 shadowCoord = shadowClip.xyz / shadowClip.w;\n            shadowCoord = shadowCoord * 0.5 + 0.5;\n            if (\n                shadowCoord.x <= 0.0 || shadowCoord.x >= 1.0 ||\n                shadowCoord.y <= 0.0 || shadowCoord.y >= 1.0 ||\n                shadowCoord.z <= 0.0 || shadowCoord.z >= 1.0\n            ) return 1.0;\n\n            float compareDepth =\n                shadowCoord.z - uRdToonGlobalSelfShadowDepthBias;\n            float visibility = texture(\n                tRdToonSelfShadowMap,\n                vec3(shadowCoord.xy, compareDepth)\n            );\n\n            // Native fades self-shadow to fully lit over the last two units\n            // of _RdToonSelfShadowRange. vRdToonViewDepth is the Three\n            // equivalent of the recovered absolute eye-depth coordinate.\n            float rangeFade = clamp(\n                (abs(vRdToonViewDepth) -\n                    (uRdToonSelfShadowRange - 2.0)) * 0.5,\n                0.0,\n                1.0\n            );\n            visibility = mix(visibility, 1.0, rangeFade);\n\n            // Current-JP optional NdotL fix: smoothstep(0.1, 0.2, N.L)\n            // written explicitly as the compiled cubic polynomial. Both\n            // operands are view-space in this Web port.\n            float ndotl = clamp(\n                dot(normalize(viewNormal),\n                    normalize(uRdToonSelfShadowLightDirection)),\n                0.0,\n                1.0\n            );\n            float ndotlT = clamp((ndotl - 0.1) * 10.0, 0.0, 1.0);\n            float ndotlFix =\n                ndotlT * ndotlT * (3.0 - 2.0 * ndotlT);\n            visibility *= mix(\n                1.0,\n                ndotlFix,\n                step(0.5, uRdToonSelfShadowUseNdotLFix)\n            );\n            return min(visibility, 1.0);\n        }\n\n        ${shader.fragmentShader}''',
    'native receiver function',
)

# Native self-shadow RT is 16-bit depth with bilinear comparison sampling.
replace_once(
    shadow,
    "        depthTexture.minFilter = THREE.NearestFilter\n        depthTexture.magFilter = THREE.NearestFilter\n        depthTexture.generateMipmaps = false\n",
    "        depthTexture.minFilter = THREE.LinearFilter\n        depthTexture.magFilter = THREE.LinearFilter\n        depthTexture.compareFunction = THREE.LessEqualCompare\n        depthTexture.generateMipmaps = false\n",
    'depth comparison texture state',
)

# Shader normals are view-space. Transform the recovered world self-shadow light
# direction into the same space before NdotLFix, preserving the native dot result.
replace_once(
    shadow,
    "        reDriveSelfShadowUniformState.lightDirection.value\n            .copy(this.forward)\n            .transformDirection(this.shadowCamera.matrixWorld)\n",
    "        reDriveSelfShadowUniformState.lightDirection.value\n            .copy(this.forward)\n            .transformDirection(this.shadowCamera.matrixWorld)\n            .transformDirection(this.scene.camera.matrixWorldInverse)\n",
    'self-shadow light direction into view space',
)

# Both native receiver call sites have the Three view-space `normal` available.
for path in (general, face):
    replace_once(
        path,
        "rdToonSelfShadowVisibility(\n                vRdToonWorldPosition\n            )",
        "rdToonSelfShadowVisibility(\n                vRdToonWorldPosition,\n                normal\n            )",
        'pass view normal to receiver',
    )

# Fail closed against the previous approximation.
source = shadow.read_text(encoding='utf-8')
for forbidden in (
    'visibility += step(compareDepth, texture2D(',
    'return visibility * 0.25;',
    'sampler2D tRdToonSelfShadowMap',
    'depthTexture.minFilter = THREE.NearestFilter',
):
    if forbidden in source:
        raise SystemExit(f'obsolete self-shadow approximation remains: {forbidden}')
for required in (
    'uniform sampler2DShadow tRdToonSelfShadowMap;',
    'depthTexture.compareFunction = THREE.LessEqualCompare',
    '(uRdToonSelfShadowRange - 2.0)',
    '(ndotl - 0.1) * 10.0',
    'ndotlT * ndotlT * (3.0 - 2.0 * ndotlT)',
):
    if required not in source:
        raise SystemExit(f'missing exact self-shadow receiver token: {required}')
print('current-JP self-shadow receiver patch complete')
