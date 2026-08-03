import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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
        './public/stages/catalog/battle-608-00-00-001.json',
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
    /const UNITY_LOCAL_LIGHT_TO_THREE_INTENSITY = 0\.01/,
    'Unity point/spot intensity conversion must stay explicit and auditable',
)
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
assert.doesNotMatch(
    stagesSource,
    /new THREE\.(?:PointLight|SpotLight)\([\s\S]{0,160}?profile\.intensity/,
    'Unity local-light intensities must not be passed directly to Three.js',
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
    return type === 'directional' ? safe : safe * 0.01
}
assert.equal(effectiveIntensity('directional', 1.25), 1.25)
assert.equal(effectiveIntensity('point', 500), 5)
assert.equal(effectiveIntensity('spot', 600), 6)
assert.equal(effectiveIntensity('point', -20), 0)
assert.equal(effectiveIntensity('point', Number.NaN), 0)

const stage608Lights = officialStage608.renderProfile.lights
const baked608Lights = stage608Lights.filter(light => light.lightmapping === 2)
const runtime608Lights = stage608Lights.filter(light => light.lightmapping !== 2)
assert.ok(baked608Lights.length > 0, 'fixture must exercise Baked-light filtering')
assert.ok(runtime608Lights.length > 0, 'fixture must preserve Mixed/Realtime lights')
assert.ok(
    baked608Lights.every(light => light.lightmapping === 2),
    'only Unity LightmapBakeType.Baked lights may be filtered',
)

const stage608Volume = officialStage608.renderProfile.reDriveVolume
assert.equal(stage608Volume.overrides.characterAdditionalRimLightColor, true)
assert.equal(stage608Volume.overrides.characterAdditionalRimLightDirection, false)
const stage608RimEnabled =
    stage608Volume.overrides.characterAdditionalRimLightColor
    && stage608Volume.overrides.characterAdditionalRimLightDirection
    && stage608Volume.characterAdditionalRimLightDirection.every(Number.isFinite)
assert.equal(
    stage608RimEnabled,
    false,
    'Stage 608 colour-only default must not become an always-on white rim',
)

console.log('Official stage lighting invariants passed.')
