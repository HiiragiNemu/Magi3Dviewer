from pathlib import Path
import re


def replace_once(path: Path, pattern: str, replacement: str, *, flags=0, label: str):
    text = path.read_text(encoding='utf-8')
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one {label} match, got {count}')
    path.write_text(new_text, encoding='utf-8')
    print(f'patched {path}: {label}')


general = Path('magia-exedra-character-three/shaders/general.ts')
stylization = Path('magia-exedra-character-three/shaders/stylization.ts')
gem = Path('magia-exedra-character-three/shaders/gem.ts')

# Current-JP Creative/Character/ReDriveToon compiled GLSL (Unity 2022.3.62f2):
# - normalizes two 2-D directions in view-space XZ and dots them;
# - shifts the Aniso threshold toward 1.001 by (1-Control.G);
# - uses threshold +/- feather, saturate, then x*x*(3-2*x);
# - applies _AnisoMaskByMetallic as 1 + flag*(Control.G-1).
replace_once(
    general,
    r'''                vec3 rdAnisoTangent = cross\(vec3\(0\.0, 1\.0, 0\.0\), normal\);.*?                rdAnisoBand \*= mix\(\n                    1\.0,\n                    rdToonMetallicMask,\n                    saturate\(uMaterialAnisoMaskByMetallic\)\n                \);''',
    '''                // Exact current-JP Aniso band structure recovered from the\n                // compiled ReDriveToon forward program. `normal` and the Three\n                // light/view vectors are already view-space here, so project both\n                // directions to XZ before normalization as the native shader does.\n                vec2 rdAnisoHalfXZ = rdHalfDirection.xz;\n                vec2 rdAnisoNormalXZ = normal.xz;\n                float rdAnisoHalfLen2 = dot(rdAnisoHalfXZ, rdAnisoHalfXZ);\n                float rdAnisoNormalLen2 = dot(rdAnisoNormalXZ, rdAnisoNormalXZ);\n                float rdAnisoDirectionalCoordinate = 0.0;\n                if (rdAnisoHalfLen2 > 0.0000001 && rdAnisoNormalLen2 > 0.0000001) {\n                    rdAnisoHalfXZ *= inversesqrt(rdAnisoHalfLen2);\n                    rdAnisoNormalXZ *= inversesqrt(rdAnisoNormalLen2);\n                    rdAnisoDirectionalCoordinate = saturate(\n                        dot(rdAnisoHalfXZ, rdAnisoNormalXZ)\n                    );\n                }\n                float rdSpecularCoordinate = rdNdotH;\n\n                // Native: center = threshold +\n                // (1.00100005-threshold)*(1-Control.G).  Feather is applied\n                // symmetrically at +/- the serialized value, followed by the\n                // explicit cubic smoothstep polynomial.\n                float rdAnisoCenter =\n                    uMaterialAnisoThreshold +\n                    (1.00100005 - uMaterialAnisoThreshold) *\n                    (1.0 - rdToonMetallicMask);\n                float rdAnisoLow = rdAnisoCenter - uMaterialAnisoFeather;\n                float rdAnisoHigh = rdAnisoCenter + uMaterialAnisoFeather;\n                float rdAnisoBand = step(\n                    rdAnisoCenter,\n                    rdAnisoDirectionalCoordinate\n                );\n                if (rdAnisoHigh > rdAnisoLow + 0.000001) {\n                    float rdAnisoT = saturate(\n                        (rdAnisoDirectionalCoordinate - rdAnisoLow) /\n                        (rdAnisoHigh - rdAnisoLow)\n                    );\n                    rdAnisoBand =\n                        rdAnisoT * rdAnisoT * (3.0 - 2.0 * rdAnisoT);\n                }\n                float rdAnisoMetallicScale =\n                    1.0 + uMaterialAnisoMaskByMetallic *\n                    (rdToonMetallicMask - 1.0);''',
    flags=re.S,
    label='Aniso coordinate/band',
)

# Remove the old Web-only Aniso specular amplification/tint and add the recovered
# additive Aniso colour term separately. The authored SpecularGradientMap keeps
# its N.H coordinate; the native Aniso term is not a fake perturbation of N.H.
replace_once(
    general,
    r'''                // Exact current-JP per-material Aniso colour/threshold are\n                // recovered\. The directional coordinate remains the current\n                // Web approximation until the compiled ReDrive subprogram is\n                // decoded; keep that uncertainty local to this one term\.\n                float rdAnisoInfluence =\n                    saturate\(uMaterialAnisotropy\) \* rdAnisoBand;\n                rdSpecularColor = mix\(\n                    rdSpecularColor,\n                    uMaterialAnisoColor,\n                    rdAnisoInfluence\n                \);\n                rdSpecular \*= mix\(1\.0, 1\.22, rdAnisoInfluence\);\n                outgoingLight \+= rdSpecularColor \* rdSpecular;''',
    '''                // Native Aniso is an additive scene-light-coloured term.\n                float rdAnisoInfluence =\n                    saturate(uMaterialAnisotropy) * rdAnisoBand;\n                outgoingLight +=\n                    rdToonSceneLightColor *\n                    uMaterialAnisoColor *\n                    rdAnisoInfluence *\n                    rdAnisoMetallicScale;\n                outgoingLight += rdSpecularColor * rdSpecular;''',
    flags=re.S,
    label='Aniso additive colour',
)

# Exact generic Fresnel threshold arithmetic. The compiled shader first applies
# metallic masking to the geometric edge coordinate, then evaluates a band centred
# on (1-threshold) with feather/2 and x*x*(3-2*x). This replaces the old Web
# threshold +/- feather approximation and post-threshold metallic multiply.
replace_once(
    stylization,
    r'''        float rdToonFresnelStart = clamp\(\n            uFresnelThreshold - uFresnelFeather,\n            0\.0,\n            1\.0\n        \);.*?        rdToonFresnelMask \*= mix\(\n            1\.0,\n            rdToonMetallicMask,\n            saturate\(uFresnelMaskByMetallic\)\n        \);''',
    '''        float rdToonFresnelMetallicScale = mix(\n            1.0,\n            rdToonMetallicMask,\n            saturate(uFresnelMaskByMetallic)\n        );\n        float rdToonFresnelInput =\n            rdToonEdge * rdToonFresnelMetallicScale;\n        float rdToonFresnelCenter = 1.0 - uFresnelThreshold;\n        float rdToonFresnelLow =\n            rdToonFresnelCenter - uFresnelFeather * 0.5;\n        float rdToonFresnelHigh =\n            rdToonFresnelCenter + uFresnelFeather * 0.5;\n        float rdToonFresnelMask = step(\n            rdToonFresnelCenter,\n            rdToonFresnelInput\n        );\n        if (rdToonFresnelHigh > rdToonFresnelLow + 0.000001) {\n            float rdToonFresnelT = saturate(\n                (rdToonFresnelInput - rdToonFresnelLow) /\n                (rdToonFresnelHigh - rdToonFresnelLow)\n            );\n            rdToonFresnelMask =\n                rdToonFresnelT * rdToonFresnelT *\n                (3.0 - 2.0 * rdToonFresnelT);\n        }''',
    flags=re.S,
    label='Fresnel exact band',
)

# Exact current-JP MatCap combination recovered from the ReDriveToon executable:
# for each RGB channel use base*matcap when base<=0.5, otherwise
# 1 - 2*(1-base)*(1-matcap), then base += factor*(blend-base), where factor is
# MatCapIntensity times the serialized specular/metallic masks.
replace_once(
    gem,
    r'''            if \(uGemUseMatCap > 0\.5\) \{\n                vec3 rdGemReflection = mix\(\n                    rdGemTint \* rdGemMatCapLuma,\n                    rdGemMatCap,\n                    0\.64\n                \);\n                rdGemBase \+= rdGemReflection \*\n                    uGemMatCapIntensity \*\n                    rdGemMatCapMask \* 0\.34;\n            \}''',
    '''            if (uGemUseMatCap > 0.5) {\n                vec3 rdGemMatCapLow = rdGemMatCap * rdGemBase;\n                vec3 rdGemMatCapHigh =\n                    vec3(1.0) -\n                    (vec3(1.0) - rdGemBase) *\n                    (vec3(1.0) - rdGemMatCap) * 2.0;\n                vec3 rdGemMatCapBlend = mix(\n                    rdGemMatCapLow,\n                    rdGemMatCapHigh,\n                    step(vec3(0.5), rdGemBase)\n                );\n                float rdGemMatCapFactor =\n                    uGemMatCapIntensity * rdGemMatCapMask;\n                rdGemBase +=\n                    rdGemMatCapFactor *\n                    (rdGemMatCapBlend - rdGemBase);\n            }''',
    label='Gem MatCap exact blend',
)

# Remove a now-dead luminance value from the previous approximation.
text = gem.read_text(encoding='utf-8')
old = '            float rdGemMatCapLuma = dot(rdGemMatCap, vec3(0.2126, 0.7152, 0.0722));\n'
if text.count(old) != 1:
    raise SystemExit(f'{gem}: expected one dead MatCap luma declaration, got {text.count(old)}')
gem.write_text(text.replace(old, '', 1), encoding='utf-8')
print(f'patched {gem}: remove obsolete MatCap luma')

# Fail closed against the exact anti-patterns this patch is meant to eliminate.
checks = {
    general: [
        'dot(rdHalfDirection, rdAnisoTangent) * 0.52',
        'uMaterialAnisoThreshold - uMaterialAnisoFeather',
        'rdSpecular *= mix(1.0, 1.22, rdAnisoInfluence)',
    ],
    stylization: [
        'uFresnelThreshold - uFresnelFeather',
        'uFresnelThreshold + uFresnelFeather',
    ],
    gem: [
        'rdGemMatCapLuma',
        'rdGemMatCapMask * 0.34',
    ],
}
for path, forbidden in checks.items():
    data = path.read_text(encoding='utf-8')
    for token in forbidden:
        if token in data:
            raise SystemExit(f'{path}: obsolete approximation still present: {token}')

print('exact ReDrive formula patch complete')
