import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const combatSource = read('src/viewer/combatVfx.ts')
const product = JSON.parse(read('public/vfx/chara_101901/e/product.json'))

test('101901 E retains exact projectile travel and impact lifecycle identity', () => {
    const [, , projectile, impact] = product.timeline.controlClips
    const [tween] = product.timeline.effectTrackClips.filter(
        clip => clip.assetClass === 'TweenClip',
    )
    assert.deepEqual(
        [projectile.start, projectile.end, impact.start, impact.end],
        [3.2333333333333334, 4.033333333333333, 3.8833333333333333, 5.3],
    )
    assert.equal(tween.trackPathID, '8675231710218609878')
    assert.equal(tween.trackBinding.transformPathID, '-5996096602878588953')
    assert.equal(tween.startAnchor.selfLocatorName, 'Rib_root')
    assert.equal(tween.endAnchor.commonLocatorName, 'MainTargetBodyBottomPoint')
    assert.ok(projectile.particleSystemPathIDs.includes('1992581280663517118'))
    assert.ok(impact.particleSystemPathIDs.includes('378207055869233845'))
    const coreMaterialName = 'eff_101901_dml_core_01_ab'
    const coreSystem = product.particleRuntime.particleSystems.find(
        system => system.materials.includes(coreMaterialName),
    )
    assert.equal(coreSystem?.pathID, '4629656902011342632')
    assert.ok(product.particleRuntime.officialMaterials.some(
        material => material.name === coreMaterialName,
    ))
    assert.ok(!product.particleRuntime.materialBindings.some(
        binding => binding.materialName === coreMaterialName,
    ))
    assert.match(combatSource, /function closeOfficialParticleMaterialBindings\(/)
    assert.match(combatSource, /function isExplicitUntexturedRampMaterial\(/)
    assert.match(combatSource, /validKeywords \?\? \[\]\)\.includes\('IS_RAMP'\)/)
    assert.match(combatSource, /Other unresolved texture-driven materials continue/)
    assert.match(combatSource, /loaded\.materialBindings/)
    assert.match(combatSource, /fallbackMaterialBindingNames/)
    assert.match(combatSource, /Some exact Unity particle materials intentionally have no _MainTex PPtr/)
})

test('target-required products bind one visible enemy and reject missing target', () => {
    assert.match(combatSource, /function loadedEnemyObjects\(/)
    assert.match(combatSource, /object\.userData\.enemyMstId/)
    assert.match(combatSource, /binding: 'scene-enemy' as const/)
    const targetGuard = combatSource.indexOf(
        'if (productMainTargetAnchors(product).length > 0 && !resolvedTarget.target)',
    )
    const hierarchyCreate = combatSource.indexOf('const root = createHierarchy(product)', targetGuard)
    assert.ok(targetGuard >= 0 && hierarchyCreate > targetGuard)
    assert.match(combatSource, /target-required product has no unambiguous scene target/)
    assert.doesNotMatch(combatSource, /product-authoring-fallback/)
})

test('parked or hidden self anchors use a recorded visible character fallback', () => {
    assert.match(combatSource, /function isEffectivelyVisible\(/)
    assert.match(combatSource, /distanceTo\([\s\S]*?\) <= 5/)
    assert.match(combatSource, /\['Weapon_R', 'Weapon_L', 'Hand_R', 'Hand_L', 'Chest', 'Hip'\]/)
    assert.match(combatSource, /recordAnchorFallback\(instance, anchor, resolved\)/)
    assert.match(combatSource, /anchorFallbacks: \[\.\.\.instance\.anchorFallbacks\]/)
})

test('debug state exposes the live projectile travel impact phase route', () => {
    assert.match(combatSource, /activePhases\.add\('projectile'\)/)
    assert.match(combatSource, /activePhases\.add\('travel'\)/)
    assert.match(combatSource, /activePhases\.add\('impact'\)/)
    assert.match(combatSource, /targetWorldPosition/)
    assert.match(combatSource, /targetEnemyMstId/)
    assert.match(combatSource, /controlPhases/)
    assert.match(combatSource, /drawableParticleSystems/)
    assert.match(combatSource, /particleDrawables/)
    assert.match(combatSource, /drawnParticlePathIDs/)
})
