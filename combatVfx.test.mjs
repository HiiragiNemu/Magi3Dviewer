import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const product = action => JSON.parse(read(
    `public/vfx/chara_101901/${action}/product.json`,
))
const q = product('q')
const e = product('e')
const combatSource = read('src/viewer/combatVfx.ts')
const screenSource = read('src/viewer/combatVfxScreenEffects.ts')
const particleSource = read('src/viewer/stageParticles.ts')
const effectsSource = read('magia-exedra-character-three/scene/effects.ts')
const sceneIndexSource = read('magia-exedra-character-three/scene/index.ts')
const viewerSceneSource = read('src/viewer/scene.ts')
const combatCatalog = JSON.parse(read('public/vfx/catalog.v1.json'))
const officialDepthRimSource = read(
    'artifacts/research/20260813-shader-reverse/official-shaders/'
    + 'main_depth_rim__blob-96__FOG_LINEAR___MAIN_LIGHT_SHADOWS_'
    + '__MAIN_LIGHT_SHADOWS_CASCADE___ADDITIONAL_LIGHT_SHADOWS_'
    + '__USE_DEPTHTEX_RIM_SHADOW.glsl',
)

test('Q/E v2 products preserve exact identity, particle assignment and full texture closure', () => {
    for (const [value, action, systems, textures] of [
        [q, 'Q', 31, 20],
        [e, 'E', 60, 31],
    ]) {
        assert.equal(value.schemaVersion, 2)
        assert.equal(value.productType, 'magius-official-combat-vfx-v2')
        assert.equal(value.action, action)
        assert.equal(value.particleRuntime.particleSystems.length, systems)
        assert.equal(value.particleRuntime.textureUrls.length, textures)
        const all = new Set(value.particleRuntime.particleSystems.map(row => row.pathID))
        const assigned = value.timeline.controlClips.flatMap(
            row => row.particleSystemPathIDs,
        )
        assert.equal(new Set(assigned).size, systems)
        assert.deepEqual(new Set(assigned), all)
        for (const url of value.particleRuntime.textureUrls) {
            assert.ok(fs.existsSync(path.join(
                root,
                `public/vfx/chara_101901/${action.toLowerCase()}`,
                url.replace(/^\.\//, ''),
            )), url)
        }
    }
})

test('consumer accepts the cue schema and resolves every product through the catalog', () => {
    assert.match(combatSource, /COMBAT_VFX_CUE_EVENT = 'magius:combat-effect-cue'/)
    assert.match(combatSource, /magius-viewer-combat-vfx-slot-v1/)
    assert.match(combatSource, /CombatVfxCatalogClient/)
    assert.match(combatSource, /catalog\.requireByBundleKey\(normalizedBundleKey\)/)
    assert.doesNotMatch(combatSource, /PRODUCT_BY_BUNDLE/)
    assert.doesNotMatch(combatSource, /special_skill_direction_10190101/)
    assert.match(combatSource, /product\.skillUniqueId !== cue\.payload\.skillUniqueId/)
    assert.match(combatSource, /product\.skillMstId !== cue\.payload\.skillMstId/)
})

test('anchor responsibility is explicit for self, target and prefab controls', () => {
    assert.deepEqual(q.timeline.controlClips.map(row => row.anchor.role), [
        'self', 'self', 'main-target',
    ])
    assert.deepEqual(e.timeline.controlClips.map(row => row.anchor.role), [
        'self', 'self', 'prefab', 'main-target',
    ])
    assert.equal(
        e.timeline.controlClips[2].anchor.prefabLocator.hierarchyPath,
        'chara_101901_singleskill_00/Effect/tween',
    )
    assert.match(combatSource, /export function setCombatVfxMainTarget/)
    assert.match(combatSource, /resolveStageHierarchyPath\(instance\.actor/)
    assert.match(combatSource, /anchor\.hierarchyPathTemplate\?\.replace/)
    assert.match(combatSource, /anchor\.prefabLocator\?\.hierarchyPath/)
})

test('E projectile and impact retain the official control split and TweenTrack binding', () => {
    const [charge, actorAura, projectile, impact] = e.timeline.controlClips
    assert.deepEqual(
        [charge, actorAura, projectile, impact].map(row => row.particleSystemPathIDs.length),
        [4, 21, 9, 26],
    )
    assert.deepEqual(
        [projectile.start, projectile.end, impact.start, impact.end],
        [3.2333333333333334, 4.033333333333333, 3.8833333333333333, 5.3],
    )
    const systems = new Map(e.particleRuntime.particleSystems.map(row => [row.pathID, row]))
    assert.ok(projectile.particleSystemPathIDs.some(pathID =>
        systems.get(pathID)?.hierarchyPath.endsWith('/fireball_core')))

    const tweenClips = e.timeline.effectTrackClips.filter(
        row => row.assetClass === 'TweenClip',
    )
    assert.equal(tweenClips.length, 1)
    const [tween] = tweenClips
    assert.equal(tween.trackPathID, '8675231710218609878')
    assert.equal(tween.start, projectile.start)
    assert.equal(tween.duration, projectile.duration)
    assert.equal(
        tween.trackBinding.hierarchyPath,
        'chara_101901_singleskill_00/Effect/tween',
    )
    assert.equal(tween.trackBinding.transformPathID, '-5996096602878588953')
    assert.equal(tween.startAnchor.role, 'self')
    assert.equal(tween.startAnchor.selfLocatorName, 'Rib_root')
    assert.equal(tween.endAnchor.role, 'main-target')
    assert.equal(tween.endAnchor.commonLocatorName, 'MainTargetBodyBottomPoint')
    assert.deepEqual(tween.behaviour.startLocationOffset, {
        x: 0, y: 0, z: 0.20000000298023224,
    })
    assert.deepEqual(tween.behaviour.endLocationOffset, { x: 0, y: 0, z: -0.5 })
    assert.equal(tween.behaviour.shouldTweenPosition, 1)
    assert.equal(tween.behaviour.shouldTweenRotation, 1)
})

test('runtime moves the bound projectile before its ControlPlayable anchor is evaluated', () => {
    assert.match(combatSource, /product\.timeline\.effectTrackClips/)
    assert.match(combatSource, /function updateTween\(/)
    assert.match(combatSource, /curveValue\(behaviour\.curve, normalized\)/)
    assert.match(combatSource, /start\.position\.clone\(\)\.lerp\(end\.position, progress\)/)
    assert.match(combatSource, /slerpQuaternions\(/)
    const updateStart = combatSource.indexOf('function updateInstance(')
    const tweenUpdate = combatSource.indexOf(
        'for (const tween of instance.tweens) updateTween(instance, tween)',
        updateStart,
    )
    const controlUpdate = combatSource.indexOf(
        'for (const control of instance.controls)',
        updateStart,
    )
    assert.ok(updateStart >= 0 && tweenUpdate > updateStart && controlUpdate > tweenUpdate)
})

test('target-required products bind a real scene enemy and fail closed without one', () => {
    assert.match(combatSource, /function loadedEnemyObjects\(/)
    assert.match(combatSource, /object\.userData\.enemyMstId/)
    assert.match(combatSource, /binding: 'scene-enemy' as const/)
    assert.match(combatSource, /productMainTargetAnchors\(product\)\.length > 0/)
    assert.match(combatSource, /target-required product has no unambiguous scene target/)
    assert.doesNotMatch(combatSource, /product-authoring-fallback/)
    assert.match(combatSource, /function rebindInstanceMainTarget\(/)
    assert.match(combatSource, /instance\.anchorCache\.clear\(\)/)
    assert.match(combatSource, /targetBinding: instance\.targetBinding/)
    assert.match(combatSource, /activeTweenCount:/)
})

test('E product carries all eight official Screen Track classes and exact key values', () => {
    const byClass = new Map(e.timeline.screenTracks.map(row => [row.class, row]))
    assert.deepEqual(new Set(byClass.keys()), new Set([
        'PostProcessBloomTrack',
        'PostProcessKawaseBlurTrack',
        'PostProcessRadialBlurTrack',
        'PostProcessChromaticAberrationTrack',
        'CharacterAdditionalRimLightTrack',
        'CharacterLightingOverrideTrack',
        'CharacterTintColorTrack',
        'TimelineSpeedTrack',
    ]))
    const bloom = byClass.get('PostProcessBloomTrack').clips[0].behaviour.behaviour
    assert.equal(bloom.intensity, 1)
    assert.ok(Math.abs(bloom.threshold - 0.8) < 1e-6)
    assert.ok(Math.abs(bloom.scatter - 0.7) < 1e-6)
    const radial = byClass.get('PostProcessRadialBlurTrack').clips[0]
    assert.equal(radial.behaviour.behaviour.focusPow, 23)
    assert.ok(Math.abs(radial.behaviour.behaviour.centorPos.y - 0.36) < 1e-6)
    const direction = byClass.get('CharacterLightingOverrideTrack')
        .clips[0].behaviour.behaviour
    assert.equal(direction.isDirection, 1)
    assert.equal(direction.isColor, 0)
    assert.equal(direction.isRatio, 0)
    assert.deepEqual(direction._globalCharacterLightingOverrideDirection, {
        x: 150,
        y: 30,
        z: 0,
    })
})

test('E HDR additional rim uses only the official depth-rim carrier', () => {
    const track = e.timeline.screenTracks.find(
        row => row.class === 'CharacterAdditionalRimLightTrack',
    )
    const colors = track.clips.map(
        clip => clip.behaviour.behaviour._globalCharacterAdditionalRimLightColor,
    )
    assert.ok(Math.max(...colors.flatMap(color => [color.r, color.g, color.b])) > 22)
    assert.match(
        officialDepthRimSource,
        /\* _GlobalCharacterAdditionalRimLightColor\.xyz/,
    )
    const start = combatSource.indexOf(
        "const rim = weightedBehaviours(product, 'CharacterAdditionalRimLightTrack', time)",
    )
    const end = combatSource.indexOf(
        "const tint = weightedBehaviours(product, 'CharacterTintColorTrack', time)",
    )
    assert.ok(start >= 0 && end > start)
    const runtimeBlock = combatSource.slice(start, end)
    assert.match(runtimeBlock, /DepthRimExperiment\.additionalDirectionVS\.set/)
    assert.match(runtimeBlock, /DepthRimExperiment\.additionalColor\.set/)
    assert.doesNotMatch(runtimeBlock, /toonStylizationOptions\.rim/)
    assert.doesNotMatch(runtimeBlock, /getHexString/)
    assert.doesNotMatch(combatSource, /state\.rim(?:Enabled|Color|Strength|Direction)/)
})

test('TimelineSpeed changes director time while particle controls keep a wall clock', () => {
    const speeds = e.timeline.screenTracks
        .find(row => row.class === 'TimelineSpeedTrack')
        .clips.map(row => row.behaviour.behaviour)
    assert.deepEqual(speeds.map(row => row.speed), [
        1,
        0.6000000238418579,
        1,
        0.800000011920929,
        1,
        0.800000011920929,
        1,
    ])
    assert.ok(speeds.every(row => row.applySPFXSpeed === 0))
    assert.match(combatSource, /timelineTime \+= deltaSeconds \* timelineSpeed/)
    assert.match(combatSource, /control\.particleTime \+= deltaSeconds/)
})

test('screen-track mixer uses official blend-out direction and restores baseline in clip gaps', () => {
    assert.match(
        combatSource,
        /\(time - \(clip\.end - clip\.blendOutDuration\)\) \/ clip\.blendOutDuration/,
    )
    const start = combatSource.indexOf('function applyScreenTracks(')
    const firstWeighted = combatSource.indexOf('weightedBehaviours(', start)
    const baselineReset = combatSource.indexOf(
        'toonStylizationOptions.characterTint = baseline.characterTint',
        start,
    )
    assert.ok(start >= 0 && baselineReset > start && firstWeighted > baselineReset)
    assert.match(combatSource, /combatVfxScreenPass\.setState\(screenState\)/)
})

test('screen tracks use one persistent composer pass and no per-frame render-target allocation', () => {
    assert.match(effectsSource, /combatVfxScreenPass = new CombatVfxScreenPass\(\)/)
    assert.ok(
        effectsSource.indexOf('addPass(this.combatVfxScreenPass)')
        < effectsSource.indexOf('addPass(this.outputPass)'),
    )
    assert.match(sceneIndexSource, /this\.effects\.combatVfxScreenPass\.enabled/)
    assert.doesNotMatch(screenSource, /new THREE\.WebGLRenderTarget/)
    assert.match(screenSource, /class CombatVfxScreenPass extends Pass/)
})

test('particle runtime consumes official secondary, wave and dissolve maps plus Unity blend state', () => {
    for (const token of [
        "'_SecondTex'",
        "'_WaveTex'",
        "'_SecondWaveTex'",
        "'_DissolveTex'",
        "'_SrcBlend'",
        "'_DstBlend'",
        "'_ZWrite'",
    ]) assert.ok(particleSource.includes(token), token)
    assert.match(particleSource, /buildContinuousBirthTimes/)
    assert.match(particleSource, /emission\.m_Bursts/)
    assert.match(particleSource, /velocityOverLifetime/)
    assert.match(particleSource, /forceActive/)
    assert.match(particleSource, /forcePlayOnAwake/)
})

test('runtime update avoids scene-wide traversal and frame-time material or RT reconstruction', () => {
    const updateBody = combatSource.match(
        /function updateRuntime\(\) \{[\s\S]*?\n\}/,
    )?.[0]
    assert.ok(updateBody)
    assert.doesNotMatch(updateBody, /\.traverse\(/)
    assert.doesNotMatch(updateBody, /new THREE\.(ShaderMaterial|WebGLRenderTarget|TextureLoader)/)
    assert.match(combatSource, /productPromises = new Map/)
})

test('scene installs the consumer without touching setupViewer, DOM toolbar, or locomotion chain', () => {
    assert.match(viewerSceneSource, /installCombatVfxRuntime\(scene\)/)
    assert.match(viewerSceneSource, /combatVfx: getCombatVfxDebugState\(\)/)
    assert.doesNotMatch(combatSource, /setupViewer|toolbar-tools|side-dock/)
    assert.doesNotMatch(combatSource, /viewerLocomotion|characterTimeline/)
})

test('Viewer startup loads only the VFX catalog and defers products until an actual cue', () => {
    const installStart = combatSource.indexOf('export function installCombatVfxRuntime')
    const installEnd = combatSource.indexOf('Object.assign(window', installStart)
    const installBody = combatSource.slice(installStart, installEnd)
    assert.match(installBody, /productCatalog\.ready\(\)/)
    assert.match(installBody, /catalogEntries = catalog\.list\(\)/)
    assert.doesNotMatch(installBody, /loadCombatVfxProduct\(/)
    assert.doesNotMatch(installBody, /Promise\.all\(catalogEntries/)
    assert.match(combatSource, /async function consumeCue[\s\S]*?loadCombatVfxProduct\(cue\.payload\.bundleKey\)/)
})

test('consumer exposes stable runtime contract and disposes every transient role', () => {
    assert.match(combatSource, /COMBAT_VFX_STATE_CHANGE_EVENT = 'magius:combat-vfx-state-change'/)
    assert.match(combatSource, /export function installCombatVfxRuntime/)
    assert.match(combatSource, /export function getCombatVfxDebugState/)
    assert.match(combatSource, /control\.particles\.dispose\(\)/)
    assert.match(combatSource, /anchorCache: new Map\(\)/)
    assert.match(combatSource, /instance\.anchorCache\.clear\(\)/)
    assert.match(combatSource, /instance\.root\.removeFromParent\(\)/)
    assert.match(combatSource, /loaded\.textures\.forEach\(texture => texture\.dispose\(\)\)/)
})

test('selection catalog exposes all 443 enemy and 211 character target products', () => {
    const target = combatCatalog.entries.filter(
        entry => entry.publicationScope === 'target',
    )
    const enemy = target.filter(entry => entry.domain === 'enemy')
    const character = target.filter(entry => entry.domain === 'character')
    const runtimeReady = target.filter(entry => entry.runtimeReady)
    const failClosed = target.filter(entry => !entry.runtimeReady)
    assert.equal(target.length, 654)
    assert.equal(enemy.length, 443)
    assert.equal(character.length, 211)
    assert.equal(runtimeReady.length, 654)
    assert.equal(failClosed.length, 0)
    assert.ok(runtimeReady.every(entry => entry.failClosedReasons.length === 0))
})

test('runtime selection is direction-keyed, fail-closed, lazy and actor-generic', () => {
    assert.match(combatSource, /export async function listCombatVfxSelections/)
    assert.match(combatSource, /export async function playCombatVfxSelection/)
    assert.match(combatSource, /catalog\.getByStableKey\(stableKey\)/)
    assert.match(
        combatSource,
        /catalog\.getByDirection\(selection\.domain!, directionKey!\)/,
    )
    assert.match(combatSource, /entry\.publicationScope !== 'target'/)
    assert.match(combatSource, /if \(!entry\.runtimeReady\)/)
    assert.match(combatSource, /resolveSelectionActorKey\(scene, selection\.actorKey\)/)
    assert.doesNotMatch(combatSource, /600001|600002|600003/)
})

test('combat VFX can be disabled, immediately cleared and resumed without product preload', () => {
    assert.match(combatSource, /export function setCombatVfxEnabled\(enabled: boolean\)/)
    assert.match(combatSource, /export function stopCombatVfx\(\)/)
    assert.match(combatSource, /if \(!runtimeEnabled\) \{[\s\S]*?suppressedCount\+\+/)
    assert.match(combatSource, /if \(!runtimeEnabled\) stopCombatVfx\(\)/)
    assert.match(
        combatSource,
        /for \(const instance of \[\.\.\.activeInstances\.values\(\)\]\) \{\s*disposeInstance\(instance, false\)/,
    )
    const consumeStart = combatSource.indexOf('async function consumeCueDetail(')
    const disabledCheck = combatSource.indexOf('if (!runtimeEnabled)', consumeStart)
    const productLoad = combatSource.indexOf('loadCombatVfxProduct(', consumeStart)
    assert.ok(consumeStart >= 0 && disabledCheck > consumeStart && productLoad > disabledCheck)
    for (const api of [
        'listCombatVfxSelections',
        'playCombatVfxSelection',
        'setCombatVfxEnabled',
        'stopCombatVfx',
    ]) assert.match(combatSource, new RegExp(`Object\\.assign\\(window,[\\s\\S]*?${api}`))
})
