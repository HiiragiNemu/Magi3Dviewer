import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
    unityDiffuseRadianceToThree,
    unityLightColorToLinear,
    unityWorldToViewerVector,
} from './src/viewer/unityLighting.ts'

const stagesSource = await readFile(
    new URL('./src/viewer/stages.ts', import.meta.url),
    'utf8',
)
const volumeSource = await readFile(
    new URL('./src/viewer/reDriveVolumeRuntime.ts', import.meta.url),
    'utf8',
)
const officialStage608 = JSON.parse(await readFile(
    new URL(
        './public/stages/official/battle-608-00-00-001/scene-profile.json',
        import.meta.url,
    ),
  'utf8',
))
const officialStage601 = JSON.parse(await readFile(
    new URL(
        './public/stages/official/battle-601-00-01-001/scene-profile.json',
        import.meta.url,
    ),
    'utf8',
))
const mainCatalog = JSON.parse(await readFile(
    new URL('./public/stages/catalog.json', import.meta.url),
    'utf8',
))

assert.match(
    stagesSource,
    /localLightIntensityScale: UNITY_TO_THREE_DIFFUSE_IRRADIANCE/,
    'debug state must expose Unity-to-Three Lambert normalization',
)
assert.equal(
    unityDiffuseRadianceToThree(2.5),
    2.5 * Math.PI,
    'serialized Unity radiance must cancel Three MeshStandard BRDF_Lambert 1/pi',
)
assert.match(stagesSource, /sourceColorSpace: 'unity-srgb'/)
assert.match(
    stagesSource,
    /profile\.lightmapping === 2 && bakedLightmapsActive/,
    'serialized Baked lights must be filtered only when a recovered lightmap is active',
)
assert.match(
    stagesSource,
    /activeStageLightmap\.matchedRendererCount[\s\S]*=== profileTextures\.lightmapBindings\?\.length/,
    'the baked-light decision must require complete binding coverage',
)
assert.match(
    stagesSource,
    /unmatchedBindingPaths\.length === 0[\s\S]*ambiguousBindingPaths\.length === 0[\s\S]*missingSecondUvPaths\.length === 0[\s\S]*unsupportedMaterialPaths\.length === 0/,
    'partial or unsupported lightmap bindings must retain realtime fallback lights',
)
assert.match(
    stagesSource,
    /bakedLightmapsActive,/,
    'stage-light diagnostics must expose whether baked lightmaps suppressed realtime fallback',
)
assert.match(
    stagesSource,
    /status: 'skipped-baked'/,
    'filtered Baked lights must remain visible in stage debug records',
)
assert.match(
    stagesSource,
    /rawIntensity: profile\.intensity[\s\S]*effectiveIntensity/,
    'stage-light diagnostics must expose raw and effective intensities',
)
assert.match(stagesSource, /unityLightColorToLinear/)
assert.match(stagesSource, /unityWorldToViewerVector/)
assert.match(
    stagesSource,
    /profileAffectsUnityLayer\(profile, 0\)[\s\S]*profileAffectsUnityLayer\(profile, stageLayer\)/,
    'serialized cullingMask must independently route each light to character and stage scenes',
)
assert.match(
    stagesSource,
    /addForegroundStageLight\(type, profile, effectiveIntensity, anchor\)/,
    'all-layer additional lights must be reproduced in the character render scene',
)
assert.match(
    stagesSource,
    /shadowLight\.shadow\.intensity = THREE\.MathUtils\.clamp\(shadow\?\.strength \?\? 1, 0, 1\)/,
    'serialized Unity shadow strength must reach Three LightShadow',
)
assert.match(stagesSource, /mainLight: 2048/)
assert.match(stagesSource, /additionalLight: 1024/)
assert.match(stagesSource, /additionalTiers: \[256, 512, 1024\]/)
assert.match(
    stagesSource,
    /profile\.type === 'directional' && profile\.role === 'character-key'/,
    'official MainLight must select the active URP main-light atlas size',
)
assert.match(
    stagesSource,
    /profile\.additionalLightData\?\.shadowResolutionTier/,
    'additional lights must consume their serialized URP resolution tier',
)
assert.match(stagesSource, /shadowLight\.shadow\.map\?\.dispose\(\)/)
assert.match(stagesSource, /shadowLight\.shadow\.map = null/)
assert.doesNotMatch(stagesSource, /shadow\.mapSize\.set\(1024, 1024\)/)
assert.match(
    stagesSource,
    /function attachOfficialStageLight[\s\S]*?light\.position\.set\(0, 0, -10\)[\s\S]*?light\.target\.position\.set\(0, 0, 0\)/,
    'an anchored Unity directional light must place the Three shadow camera behind its target',
)
assert.match(
    stagesSource,
    /attachOfficialStageLight\(stageLight, stageObject, profile, anchor\)/,
    'the background MainLight copy must use the shadow-camera-safe directional transform',
)
assert.match(
    stagesSource,
    /subVectors\(stageLightProfileTarget, stageLightProfilePosition\)[\s\S]*?addScaledVector\(stageLightProfileDirection, -10\)/,
    'profile-only directional lights must preserve direction while moving the shadow camera off the target plane',
)

assert.match(
    stagesSource,
    /profile\.fog\.affectsCharacters === false[\s\S]*\? null[\s\S]*new THREE\.Fog/,
    'gallery fog must be able to stay on stage geometry without washing out characters',
)

const memoryRoom = mainCatalog.stages.find(stage => stage.id === 'gallery-memory-room')
assert.ok(memoryRoom, 'Memory light room must remain in the official catalog')
assert.equal(memoryRoom.renderProfile.fog.affectsCharacters, false)
assert.ok(memoryRoom.renderProfile.ambientLight.intensity <= 0.3)
assert.ok(memoryRoom.renderProfile.directionalLight.intensity <= 0.8)
assert.ok(memoryRoom.renderProfile.bloom.strength <= 0.1)
assert.equal(
    memoryRoom.renderProfile.reDriveVolume,
    undefined,
    'unverified static white character overrides must not be applied to Memory light room',
)

assert.match(
    volumeSource,
    /rimColorOverride[\s\S]*rimDirectionOverride[\s\S]*validRimDirection[\s\S]*rim\.intensity > 0\.0001/,
    'Additional Rim activation must require valid colour and direction overrides',
)
assert.doesNotMatch(
    volumeSource,
    /rimEnabled\s*=\s*rimOverride\s*&&/,
    'a colour-only override must not enable static Additional Rim',
)

const effectiveIntensity = (type, raw) => {
    const safe = Number.isFinite(raw) ? Math.max(0, raw) : 0
    return safe
}
assert.equal(effectiveIntensity('directional', 1.25), 1.25)
assert.equal(effectiveIntensity('point', 500), 500)
assert.equal(effectiveIntensity('spot', 600), 600)
assert.equal(effectiveIntensity('point', -20), 0)
assert.equal(effectiveIntensity('point', Number.NaN), 0)

const capturedBgCenter = unityLightColorToLinear([1, 0.95, 0.9809523821])
assert.ok(Math.abs(capturedBgCenter[1] * 500 - 445.0027771) < 0.001)
assert.ok(Math.abs(capturedBgCenter[2] * 500 - 478.6076355) < 0.001)
assert.deepEqual(unityWorldToViewerVector([6, 7, -8]), [-6, 7, -8])

const stage608Lights = officialStage608.renderProfile.lights
const volumeLight = stage608Lights.find(light => light.name === 'VolumeLight')
assert.equal(volumeLight.cullingMask, 0xffffffff)
assert.equal(volumeLight.additionalLightData.shadowResolutionTier, 2)
assert.equal(volumeLight.additionalLightData.softShadowQuality, 1)
const baked608Lights = stage608Lights.filter(light => light.lightmapping === 2)
const runtime608Lights = stage608Lights.filter(light => light.lightmapping !== 2)
assert.ok(baked608Lights.length > 0, 'fixture must exercise Baked-light filtering')
assert.ok(runtime608Lights.length > 0, 'fixture must preserve Mixed/Realtime lights')
assert.ok(
    baked608Lights.every(light => light.lightmapping === 2),
    'only Unity LightmapBakeType.Baked lights may be filtered',
)

const stage601MainLight = officialStage601.renderProfile.lights.find(
    light => light.role === 'character-key' && light.type === 'directional',
)
assert.ok(stage601MainLight)
assert.equal(stage601MainLight.name, 'MainLight')
assert.equal(stage601MainLight.castShadow, true)
assert.equal(stage601MainLight.additionalLightData.shadowResolutionTier, 2)

const stage608Volume = officialStage608.renderProfile.reDriveVolume
assert.equal(stage608Volume.overrides.characterAdditionalRimLightColor, true)
assert.equal(stage608Volume.overrides.characterAdditionalRimLightDirection, true)
const stage608RimEnabled =
    stage608Volume.overrides.characterAdditionalRimLightColor
    && stage608Volume.overrides.characterAdditionalRimLightDirection
    && stage608Volume.characterAdditionalRimLightDirection.every(Number.isFinite)
assert.equal(
    stage608RimEnabled,
    true,
    'generated Stage 608 profile must preserve its explicit valid rim direction override',
)

console.log('Official stage lighting invariants passed.')
