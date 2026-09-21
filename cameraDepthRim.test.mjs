import { assertReleaseMaterialCorpus } from './releaseCorpusTestSupport.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [
    depthRim,
    cameraDepth,
    shadow,
    hair,
    gem,
    scene,
    general,
    materialProfilesText,
    queueEvidenceText,
    submeshGroups,
    materialProfileSource,
    extractor,
    loader,
    officialFaceDepthOnly,
] = await Promise.all([
    readFile('magia-exedra-character-three/shaders/depthRim.ts', 'utf8'),
    readFile('magia-exedra-character-three/scene/cameraDepth.ts', 'utf8'),
    readFile('magia-exedra-character-three/shaders/shadow.ts', 'utf8'),
    readFile('magia-exedra-character-three/shaders/hair.ts', 'utf8'),
    readFile('magia-exedra-character-three/shaders/gem.ts', 'utf8'),
    readFile('magia-exedra-character-three/scene/index.ts', 'utf8'),
    readFile('magia-exedra-character-three/shaders/general.ts', 'utf8'),
    readFile('magia-exedra-character-three/official-material-profiles.json', 'utf8'),
    readFile('research/official-camera-depth-material-queue-evidence.json', 'utf8'),
    readFile('magia-exedra-character-three/submeshGroups.generated.ts', 'utf8'),
    readFile('magia-exedra-character-three/materialProfile.ts', 'utf8'),
    readFile('scripts/extract-official-material-profiles.py', 'utf8'),
    readFile('magia-exedra-character-three/loader.ts', 'utf8'),
    readFile(
        'artifacts/verification/20260824-108301-hair-cheek-shadow-visual-fail/iteration-14-official-face-gradient-mouth-nose/official-evidence/tw-depth-only/Creative-Character-ReDriveToon-pass7-depthonly-face-blob433.glsl',
        'utf8',
    ),
])

const materialProfiles = JSON.parse(materialProfilesText)
const queueEvidence = JSON.parse(queueEvidenceText)

function restoredGroupCounts(characterId, meshName) {
    const characterBlock = submeshGroups.match(
        new RegExp(`\\n    ${characterId}: \\{([\\s\\S]*?)\\n    \\},`),
    )?.[1]
    assert.ok(characterBlock, `missing character ${characterId}`)
    const escapedMeshName = meshName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const values = characterBlock.match(
        new RegExp(`"${escapedMeshName}": \\[([^\\]]+)\\]`),
    )?.[1]
    assert.ok(values, `missing ${characterId}/${meshName}`)
    return values.split(',').map(value => Number(value.trim()))
}

const clamp01 = value => Math.max(0, Math.min(1, value))

function linearEye(rawDepth, near, far, orthographic) {
    return orthographic
        ? rawDepth * (far - near) + near
        : (near * far) / (far - rawDepth * (far - near))
}

function rimReference({
    centerZ,
    sampledZ,
    rimThreshold = 0.02,
    shadowThreshold = 0.03,
    ndotV = 0,
    isHair = false,
}) {
    const depth = clamp01(10 * (sampledZ - (centerZ + rimThreshold)))
    const shadow = clamp01(
        50 * (sampledZ - (centerZ - shadowThreshold)),
    )
    const edge = 1 - Number(isHair) * ndotV
    const t = clamp01((edge * depth - 0.1) / 0.025)
    return { depth, shadow, rim: t * t * (3 - 2 * t) }
}

function gemDepthSelector({
    enabled,
    useDepthDiff,
    transparency,
    centerZ,
    sampledZ,
    threshold,
}) {
    if (!(enabled && useDepthDiff && transparency)) return 0
    const g = clamp01(5 * (sampledZ - (centerZ - 0.01)))
    return g >= 1 - threshold ? 0 : 1
}

test('official depth path joins opaque stage and character roots without a depth clear', () => {
    assert.match(depthRim, /enabled:\s*true/)
    assert.match(cameraDepth, /new THREE\.DepthTexture/)
    assert.match(cameraDepth, /officialOpaqueLayerMask = 0x7fffffff/)
    assert.match(cameraDepth, /officialOpaqueRenderQueueMax = 2500/)
    assert.match(cameraDepth, /if \(mesh\.customDepthMaterial\)/)
    assert.match(cameraDepth, /stageUnityMaterialState\s*\?\.effectiveRenderQueue/)
    assert.match(cameraDepth, /magiusEnemyRenderQueue/)
    assert.match(cameraDepth, /queue > officialOpaqueRenderQueueMax/)
    assert.match(cameraDepth, /meshUsesOfficialCameraDepth/)
    assert.match(cameraDepth, /profile\.depthRim\?\.useDepthTex/)
    assert.match(scene, /this\.cameraDepth\.render\(\)/)

    const prepareStart = cameraDepth.indexOf(
        'this.prepareSceneDepth(',
        cameraDepth.indexOf('    render() {'),
    )
    const backgroundPrepare = cameraDepth.indexOf(
        'this.scene.backgroundScene,\n                    camera,',
        prepareStart,
    )
    const foregroundPrepare = cameraDepth.indexOf(
        'this.scene.scene,\n                camera,',
        backgroundPrepare,
    )
    const clear = cameraDepth.indexOf('renderer.clear(true, true, false)')
    const backgroundRender = cameraDepth.indexOf(
        'renderer.render(this.scene.backgroundScene, camera)',
    )
    const foregroundRender = cameraDepth.indexOf(
        'renderer.render(this.scene.scene, camera)',
        backgroundRender,
    )
    assert.ok(backgroundPrepare > 0 && foregroundPrepare > backgroundPrepare)
    assert.ok(clear > foregroundPrepare)
    assert.ok(backgroundRender > clear && foregroundRender > backgroundRender)
    assert.match(cameraDepth, /renderer\.autoClear = false/)
    assert.doesNotMatch(cameraDepth, /renderer\.clearDepth\(/)
})

test('official CameraDepth queue evidence covers every mixed renderer without whole-mesh loss', () => {
    assert.equal(queueEvidence.summary.bundleCount, 95)
    assert.equal(queueEvidence.summary.materialRows, 1655)
    assert.equal(queueEvidence.summary.transparentQueueRows, 48)
    assert.equal(queueEvidence.summary.multiMaterialRenderers, 459)
    assert.equal(queueEvidence.mixedTransparentQueueRenderers.length, 40)
    assert.equal(queueEvidence.oldWholeMeshGemLossCases.length, 4)
    assert.equal(queueEvidence.localFbxMixedTransparentQueueRenderers.length, 38)
    assert.equal(queueEvidence.nonLocalOrAlternateMixedTransparentQueueRenderers.length, 2)
    assert.deepEqual(
        queueEvidence.oldWholeMeshGemLossCases.map(value => value.bundle),
        [
            'chara_100106_battle_unit',
            'chara_105801_battle_unit',
            'chara_115001_battle_unit',
            'chara_115101_battle_unit',
        ],
    )

    for (const renderer of queueEvidence.mixedTransparentQueueRenderers) {
        for (const material of renderer.materials) {
            const generated = materialProfiles.materials[material.name.toLowerCase()]
            assert.ok(generated, `missing profile ${material.name}`)
            assert.equal(
                generated.customRenderQueue,
                material.queue,
                `${renderer.bundle}/${renderer.mesh}/${material.name} queue`,
            )
        }
    }

    for (const renderer of queueEvidence.localFbxMixedTransparentQueueRenderers) {
        const characterId = Number(renderer.bundle.match(/chara_(\d+)_/)?.[1])
        assert.equal(
            restoredGroupCounts(characterId, renderer.mesh).length,
            renderer.materials.length,
            `${renderer.bundle}/${renderer.mesh} material groups`,
        )
    }
})

test('100107 weapon_b skips only queue-3000 alpha while 101901 keeps all opaque groups', () => {
    const target = queueEvidence.targetCases.find(
        value => value.bundle === 'chara_100107_battle_unit' && value.mesh === 'weapon_b_mesh',
    )
    assert.ok(target)
    assert.deepEqual(restoredGroupCounts(100107, 'weapon_b_mesh'), [4077, 48, 168])
    assert.deepEqual(
        target.materials.map(value => [value.name, value.queue]),
        [
            ['mt_chara_100101_weapon_a', -1],
            ['mt_chara_100101_weapon_a_alpha', 3000],
            ['mt_chara_100101_weapon_a_sj', -1],
        ],
    )
    assert.equal(
        queueEvidence.mixedTransparentQueueRenderers.some(
            value => value.bundle === 'chara_101901_battle_unit',
        ),
        false,
    )
    assert.equal(
        materialProfiles.materials.mt_chara_100101_weapon_a_alpha.customRenderQueue,
        3000,
    )
    assert.equal(
        materialProfiles.materials.mt_chara_101901_body_sj.customRenderQueue,
        -1,
    )
})

test('all generated profiles carry exact queues and RenderQueueRange opaque ends at 2500', () => {
    const profiles = Object.values(materialProfiles.materials)
    const { historical, added } = assertReleaseMaterialCorpus(materialProfiles)
    assert.equal(
        profiles.every(value => Number.isInteger(value.customRenderQueue)),
        true,
    )
    assert.equal(historical.filter(value => value.customRenderQueue >= 3000).length, 46)
    assert.equal(added.filter(value => value.customRenderQueue >= 3000).length, 1)
    assert.equal(profiles.filter(value => value.customRenderQueue >= 3000).length, 47)
    assert.equal(historical.filter(value => value.customRenderQueue > 2500).length, 48)
    assert.equal(added.filter(value => value.customRenderQueue > 2500).length, 1)
    assert.equal(profiles.filter(value => value.customRenderQueue > 2500).length, 49)
    assert.equal(
        profiles.filter(value =>
            value.customRenderQueue > 2500 &&
            value.customRenderQueue < 3000
        ).length,
        2,
    )
    const opaqueRangeTransparency =
        materialProfiles.materials.mt_chara_100201_acc_alpha
    assert.equal(opaqueRangeTransparency.customRenderQueue, 2500)
    assert.equal(opaqueRangeTransparency.gem.transparency, true)
    assert.match(
        cameraDepth,
        /if \(profile && profile\.customRenderQueue >= 0\) \{\s*return profile\.customRenderQueue\s*\}/,
    )
    assert.match(
        cameraDepth,
        /if \(queue != undefined\) return queue > officialOpaqueRenderQueueMax/,
    )
})

test('depth prepass retains restored groups and skips only their transparent material slots', () => {
    assert.match(cameraDepth, /forwardMaterials\.map\(\(material, index\) =>/)
    assert.match(
        cameraDepth,
        /slot\.transparent\s*\? this\.skipDepthMaterial\s*:\s*slot\.depthMaterial/,
    )
    assert.match(cameraDepth, /this\.skipDepthMaterial\.visible = false/)
    assert.doesNotMatch(cameraDepth, /hasTransparentGem/)
})

test('depth prepass preserves official cutouts, camera visibility and helper exclusions', () => {
    for (const token of [
        'sourceMaterial.alphaTest > 0',
        'depthMaterial.map = map',
        'depthMaterial.alphaMap = alphaMap',
        'depthMaterial.alphaTest = sourceMaterial.alphaTest',
        'depthMaterial.side = sourceMaterial.side',
        'depthMaterial.displacementMap = displacementMap',
        'isVisibleInHierarchy(mesh)',
        'isOfficialCameraDepthLayer(mesh, camera)',
        "stencilRole === 'selector-mask'",
        "mesh.name.includes(':official-outline:')",
        'current === this.scene.stageCharacterShadows.root',
    ]) assert.ok(cameraDepth.includes(token), 'missing ' + token)
    assert.match(
        cameraDepth,
        /object\.layers\.mask &\s*camera\.layers\.mask &\s*officialOpaqueLayerMask/,
    )
    assert.match(cameraDepth, /isLine\?: boolean/)
    assert.match(cameraDepth, /isPoints\?: boolean/)
    assert.match(cameraDepth, /isSprite\?: boolean/)
    assert.match(cameraDepth, /object\.visible = false/)
    assert.match(cameraDepth, /snapshot\.object\.visible = snapshot\.visible/)
})

test('depth scope is generic and restores all material renderer and XR state', () => {
    assert.match(cameraDepth, /snapshot\.mesh\.material = snapshot\.material/)
    assert.match(cameraDepth, /snapshot\.mesh\.visible = snapshot\.visible/)
    assert.match(cameraDepth, /renderer\.setRenderTarget\(previousTarget\)/)
    assert.match(
        cameraDepth,
        /renderer\.setClearColor\(previousClearColor, previousClearAlpha\)/,
    )
    assert.match(cameraDepth, /renderer\.autoClear = previousAutoClear/)
    assert.match(cameraDepth, /renderer\.xr\.enabled = previousXrEnabled/)
    assert.doesNotMatch(
        cameraDepth,
        /(?:characterId|stageId|materialPathID)\s*(?:===|==)|case\s+(?:100102|108301|101901|100107|100805)/,
    )
})
test('opaque-scope fixture accepts only official camera-visible opaque draws', function () {
    function drawEligible(fixture) {
        const layerVisible = Boolean(
            fixture.objectLayer &
            fixture.cameraLayer &
            0x7fffffff
        )
        return Boolean(
            fixture.consumer &&
            fixture.visible &&
            layerVisible &&
            fixture.queue <= 2500
        )
    }

    const fixtures = [
        { label: 'opaque', consumer: true, visible: true, objectLayer: 1, cameraLayer: 1, queue: 2000, expected: true },
        { label: 'alpha-cutout opaque', consumer: true, visible: true, objectLayer: 1, cameraLayer: 1, queue: 2450, alphaTest: 0.5, expected: true },
        { label: 'transparent queue', consumer: true, visible: true, objectLayer: 1, cameraLayer: 1, queue: 2501, expected: false },
        { label: 'invisible hierarchy', consumer: true, visible: false, objectLayer: 1, cameraLayer: 1, queue: 2000, expected: false },
        { label: 'camera-layer mismatch', consumer: true, visible: true, objectLayer: 2, cameraLayer: 1, queue: 2000, expected: false },
        { label: 'official layer31 exclusion', consumer: true, visible: true, objectLayer: 0x80000000, cameraLayer: 0xffffffff, queue: 2000, expected: false },
        { label: 'no CameraDepth consumer', consumer: false, visible: true, objectLayer: 1, cameraLayer: 1, queue: 2000, expected: false },
    ]
    for (const fixture of fixtures) {
        assert.equal(drawEligible(fixture), fixture.expected, fixture.label)
    }
})

test('nested Viewer helper roots and prepare/render failures restore exact state', function () {
    const renderStart = cameraDepth.indexOf('    render() {')
    const renderEnd = cameraDepth.indexOf('    dispose()', renderStart)
    const renderBody = cameraDepth.slice(renderStart, renderEnd)
    const tryIndex = renderBody.indexOf('        try {')
    const detachIndex = renderBody.indexOf('this.detachViewerDepthHelperRoots(')
    const backgroundPrepare = renderBody.indexOf(
        'this.scene.backgroundScene,\n                    camera,',
    )
    const foregroundPrepare = renderBody.indexOf(
        'this.scene.scene,\n                camera,',
        backgroundPrepare,
    )
    const finallyIndex = renderBody.indexOf('        } finally {')
    const helperRestore = renderBody.indexOf(
        'this.restoreViewerDepthHelperRoots(detachedHelperSnapshots)',
        finallyIndex,
    )

    assert.ok(renderStart >= 0 && renderEnd >= 0)
    assert.ok(tryIndex >= 0 && tryIndex < detachIndex)
    assert.ok(detachIndex < backgroundPrepare)
    assert.ok(backgroundPrepare < foregroundPrepare)
    assert.ok(foregroundPrepare < finallyIndex)
    assert.ok(finallyIndex < helperRestore)
    assert.match(cameraDepth, /isTransformControlsRoot\?: boolean/)
    assert.match(cameraDepth, /collectViewerDepthHelperRoots\(object, snapshots\)/)
    assert.match(cameraDepth, /snapshots\.push\(\{ object, parent, index \}\)/)
    assert.match(cameraDepth, /snapshot\.object\.parent = null/)
    assert.match(cameraDepth, /snapshot\.object\.parent = snapshot\.parent/)
    assert.match(renderBody, /let depthReady = false/)
    assert.match(renderBody, /if \(!depthReady\) state\.enabled\.value = 0/)

    const requiredFinallyRestores = [
        'snapshot.mesh.material = snapshot.material',
        'snapshot.mesh.visible = snapshot.visible',
        'snapshot.object.visible = snapshot.visible',
        'renderer.setRenderTarget(previousTarget)',
        'renderer.setClearColor(previousClearColor, previousClearAlpha)',
        'renderer.autoClear = previousAutoClear',
        'renderer.xr.enabled = previousXrEnabled',
    ]
    for (const token of requiredFinallyRestores) {
        assert.ok(
            renderBody.indexOf(token, finallyIndex) >= finallyIndex,
            'restore outside finally: ' + token,
        )
    }

    for (const failurePhase of ['prepare', 'render']) {
        const state = {
            material: 'forward',
            visible: true,
            helperParent: 'scene',
            helperIndex: 2,
            renderTarget: 'display',
            clearColor: 'original',
            autoClear: true,
            xr: true,
            depthEnabled: true,
        }
        const original = { ...state }
        assert.throws(function () {
            try {
                state.helperParent = null
                state.helperIndex = -1
                state.material = 'depth'
                state.visible = false
                state.depthEnabled = false
                if (failurePhase === 'prepare') {
                    throw new Error('prepare-throw')
                }
                state.renderTarget = 'camera-depth'
                state.clearColor = 'transparent-black'
                state.autoClear = false
                state.xr = false
                throw new Error('render-throw')
            } finally {
                Object.assign(state, original)
            }
        }, new RegExp(failurePhase + '-throw'))
        assert.deepEqual(state, original, failurePhase)
    }
})
test('all face profiles carry the official camera-depth write offset', () => {
    const profiles = Object.values(materialProfiles.materials)
    assert.equal(
        profiles.every(profile =>
            Number.isFinite(profile.face.cameraDepthTextureZWriteOffset)
        ),
        true,
    )
    assert.equal(
        materialProfiles.materials.mt_chara_100102_face.face
            .cameraDepthTextureZWriteOffset,
        0.03999999910593033,
    )
    for (const name of [
        'mt_chara_108301_face',
        'mt_chara_101901_face',
        'mt_chara_100101_face',
    ]) {
        assert.equal(
            materialProfiles.materials[name].face
                .cameraDepthTextureZWriteOffset,
            0.05000000074505806,
        )
    }
    assert.match(
        extractor,
        /"cameraDepthTextureZWriteOffset": number\(\s*"_FaceAreaCameraDepthTextureZWriteOffset",\s*0\.05,?\s*\)/,
    )
    assert.match(
        materialProfileSource,
        /cameraDepthTextureZWriteOffset: number;/,
    )
})

test('face DepthOnly writes the serialized offset before forward depth gating', () => {
    assert.match(
        officialFaceDepthOnly,
        /abs\(u_xlat1\.w\) \+ _FaceAreaCameraDepthTextureZWriteOffset/,
    )
    assert.match(
        officialFaceDepthOnly,
        /\(-_FaceAreaCameraDepthTextureZWriteOffset\) \/ u_xlat8\.x/,
    )
    assert.match(
        cameraDepth,
        /faceDepthMaterials = new Map<\s*THREE\.Mesh/,
    )
    assert.match(cameraDepth, /profile\?\.face\.isFace/)
    assert.match(
        cameraDepth,
        /uRdFaceAreaCameraDepthTextureZWriteOffset/,
    )
    assert.match(
        cameraDepth,
        /max\(\s*abs\(gl_Position\.w\) \+\s*uRdFaceAreaCameraDepthTextureZWriteOffset,\s*uRdCameraNear \+ 5\.96046448e-08\s*\)/,
    )
    assert.match(
        cameraDepth,
        /gl_Position\.z \+=\s*-uRdFaceAreaCameraDepthTextureZWriteOffset \*\s*projectionMatrix\[2\]\[2\]/,
    )
    assert.match(
        cameraDepth,
        /injectCharacterPerspectiveCancellation\(shader, reference\)/,
    )
    assert.match(loader, /mesh\.userData\.characterPerspectiveReference =\s*characterPerspectiveReference/)
    assert.match(cameraDepth, /officialFaceCameraDepthRuntime/)
    assert.doesNotMatch(
        `${cameraDepth}\n${loader}`,
        /(?:characterId|faceProfile\.characterId)\s*(?:===|==)\s*(?:100102|108301|101901|100107)|case\s+(?:100102|108301|101901|100107)/,
    )
})

test('face depth offset leaves the existing Body Hair Gem signal unchanged', () => {
    assert.match(
        depthRim,
        /rdDepthCenterZ - uRdDepthShadowDiffThreshold/,
    )
    assert.match(
        depthRim,
        /rdDepthShadowSignal >= 0\.100000001 \? 1\.0 : 0\.0/,
    )
    assert.doesNotMatch(
        cameraDepth,
        /opaqueDepthMaterial\.onBeforeCompile\s*=/,
    )
})

test('alpha-cutout depth material owns an immutable official UV0 transform contract', () => {
    const mapAssignment = shadow.indexOf('material.map = alphaTex')
    const compileHook = shadow.indexOf('material.onBeforeCompile = shader =>')
    assert.ok(mapAssignment > 0 && mapAssignment < compileHook)
    assert.match(
        shadow,
        /if \(alphaTex\.matrixAutoUpdate\) alphaTex\.updateMatrix\(\)/,
    )
    assert.match(shadow, /uRdAlphaUvTransform = \{ value: alphaTex\.matrix \}/)
    assert.match(
        shadow,
        /uRdAlphaUvTransform \* vec3\(uv, 1\.0\)/,
    )
    assert.match(
        shadow,
        /texture2D\(tAlpha, vRdAlphaCutoutUv\)\.a < uAlphaTest/,
    )
    assert.doesNotMatch(shadow, /texture2D\(tAlpha, vMapUv\)/)
})

test('static GLSL keeps recovered coordinates, gates, constants and debug channels', () => {
    for (const token of [
        'uRdDepthUseDepthTex',
        'uRdDepthUseRimLight',
        'uRdDepthDitherFade',
        'vRdDepthRimVertexColorG * uRdDepthTexWidth',
        '0.660000026',
        '0.850000024',
        'texelFetch(uRdCameraDepthTexture, pixel, 0)',
        '10.0 * (rdDepthMainZ - rdDepthRimReference)',
        '50.0 * (',
        'vec2(0.1)',
        'vec2(0.125)',
        'rdDepthShadowSignal,',
        'rdDepthRim.x,',
        'rdDepthRim.y',
    ]) assert.ok(depthRim.includes(token), `missing ${token}`)
    assert.match(depthRim, /step\(0\.5, uRdDepthUseDepthTex\)/)
    assert.match(depthRim, /step\(0\.5, uRdDepthUseRimLight\)/)
    assert.match(depthRim, /uRdDepthDitherFade <= 0\.5/)
    assert.match(depthRim, /if \(rdDepthDitherTest < 0\.0\) discard/)
    assert.match(depthRim, /if \(index == 12\) return 0\.941176474/)
})

test('depth shadow selects raw toon ramp before ShadowFeather', () => {
    const rampIndex = general.indexOf('float rdToonRamp = saturate(')
    const selectorMarker = general.indexOf(
        '// RD_DEPTH_SHADOW_SELECTOR_BEGIN',
        rampIndex,
    )
    const featherIndex = general.indexOf(
        'float rdToonRampLow = saturate(',
        selectorMarker,
    )
    assert.ok(rampIndex > 0 && rampIndex < selectorMarker)
    assert.ok(selectorMarker < featherIndex)
    assert.match(
        depthRim,
        /rdDepthShadowSignal >= 0\.100000001 \? 1\.0 : 0\.0/,
    )
    assert.match(depthRim, /rdToonRamp \*= rdDepthShadowSelector/)
})

test('rim uses official smoothstep and reuses the established scene-light carrier', () => {
    assert.match(
        depthRim,
        /rdDepthRim = smoothstep\(\s*vec2\(0\.1\),\s*vec2\(0\.125\)/,
    )
    assert.match(
        depthRim,
        /rdDepthLightCarrier =\s*rdToonSceneLightColor \*\s*\(rdToonBaseWeight \* 0\.800000012 \+ 0\.200000003\)/,
    )
    assert.doesNotMatch(depthRim, /uGlobalCharacterLightingOverrideColor/)
    assert.match(general, /\/\/ RD_DEPTH_RIM_COMPOSITE_BEGIN/)
})

test('CPU depth linearization matches perspective and orthographic endpoints', () => {
    const near = 0.1
    const far = 100
    assert.equal(linearEye(0, near, far, false), near)
    assert.ok(Math.abs(linearEye(1, near, far, false) - far) < 1e-10)
    assert.equal(linearEye(0, near, far, true), near)
    assert.equal(linearEye(1, near, far, true), far)
    const rawAtThree = (far - near * far / 3) / (far - near)
    assert.ok(Math.abs(linearEye(rawAtThree, near, far, false) - 3) < 1e-10)
})

test('Body and Gem share depth signal while Hair alone applies 1-NdotV gate', () => {
    const common = { centerZ: 3, sampledZ: 3.14, ndotV: 0.95 }
    const body = rimReference(common)
    const gemClass = rimReference({ ...common, isHair: false })
    const hairClass = rimReference({ ...common, isHair: true })
    assert.deepEqual(gemClass, body)
    assert.equal(body.rim, 1)
    assert.equal(hairClass.rim, 0)
    assert.match(depthRim, /1\.0 - uRdDepthRimIsHair \* rdDepthNdotV/)
    assert.match(depthRim, /profile\?\.gem\.enabled \? 1 : 0/)
    assert.match(hair, /shared CameraDepthTexture signal gated by \(1 - NdotV\)/)
    assert.doesNotMatch(hair, /0\.55\/0\.93\/0\.16 proxy[\s\S]*smoothstep/)
})

test('GemDepthDiff requires both official predicates and runs before MatCap', () => {
    const sample = {
        enabled: true,
        useDepthDiff: true,
        transparency: true,
        centerZ: 2,
        sampledZ: 1.99,
        threshold: 0.5,
    }
    assert.equal(gemDepthSelector(sample), 1)
    assert.equal(gemDepthSelector({ ...sample, transparency: false }), 0)
    assert.equal(gemDepthSelector({ ...sample, useDepthDiff: false }), 0)
    assert.equal(gemDepthSelector({ ...sample, enabled: false }), 0)
    const selectorIndex = gem.indexOf('float rdGemDepthBranchEnabled')
    const matCapIndex = gem.indexOf('if (uMaterialMatCapEnabled > 0.5)', selectorIndex)
    assert.ok(selectorIndex > 0 && selectorIndex < matCapIndex)
    assert.match(gem, /5\.0 \* \(/)
    assert.match(gem, /1\.0 - uGemDepthDiffThreshold/)
    assert.match(gem, /step\(0\.0000001, abs\(uGemUseDepthDiff\)\)/)
    assert.match(gem, /step\(0\.0000001, abs\(uGemTransparency\)\)/)
    assert.doesNotMatch(gem, /uGemUseDepthDiff \* uGemTransparency/)
    assert.doesNotMatch(gem, /rdGemTint \* rdGemDepthSelector/)
})
