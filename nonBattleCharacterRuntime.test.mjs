import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import zlib from 'node:zlib'
import ts from 'typescript'

globalThis.document = {
    baseURI: 'http://127.0.0.1:4173/',
    createElementNS() {
        const listeners = new Map()
        return {
            addEventListener(type, callback) { listeners.set(type, callback) },
            removeEventListener(type) { listeners.delete(type) },
            set src(value) {
                this._src = value
                queueMicrotask(() => listeners.get('load')?.({ target: this }))
            },
            get src() { return this._src },
        }
    },
}

const repo = new URL('./', import.meta.url)
const profileUrl = new URL(
    './public/nonbattle-characters/characters/113401/profile.v1.json',
    repo,
)
const aqProfileUrl = new URL(
    './public/nonbattle-characters/characters/113501/profile.v1.json',
    repo,
)
const yodakaProfileUrl = new URL(
    './public/nonbattle-characters/characters/113601/profile.v1.json',
    repo,
)
const yodakaEffectUrl = new URL(
    './magia-exedra-character-three/nonbattle-models/chara_113601_model/wing-drop-effect.v1.json',
    repo,
)
const manifestUrl = new URL('./public/nonbattle-characters/manifest.v1.json', repo)

const profile = JSON.parse(fs.readFileSync(profileUrl, 'utf8'))
const aqProfile = JSON.parse(fs.readFileSync(aqProfileUrl, 'utf8'))
const yodakaProfile = JSON.parse(fs.readFileSync(yodakaProfileUrl, 'utf8'))
const yodakaEffect = JSON.parse(fs.readFileSync(yodakaEffectUrl, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestUrl, 'utf8'))

async function importCharacterPhysicsRuntime() {
    const compiledRoot = new URL(
        './artifacts/verification/20260902-nonbattle-113601-production/test-compiled/',
        repo,
    )
    fs.mkdirSync(compiledRoot, { recursive: true })
    for (const name of ['math', 'binding', 'magicaWind', 'nativeColliders', 'runtime']) {
        const source = fs.readFileSync(
            new URL(`./src/viewer/characterPhysics/${name}.ts`, repo),
            'utf8',
        )
        let output = ts.transpileModule(source, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ES2022,
                verbatimModuleSyntax: true,
            },
            fileName: `${name}.ts`,
        }).outputText
        output = output
            .replaceAll("from './math'", "from './math.mjs'")
            .replaceAll("from './binding'", "from './binding.mjs'")
            .replaceAll("from './magicaWind'", "from './magicaWind.mjs'")
            .replaceAll("from './nativeColliders'", "from './nativeColliders.mjs'")
        fs.writeFileSync(new URL(`${name}.mjs`, compiledRoot), output, 'utf8')
    }
    return await import(
        `${new URL('runtime.mjs', compiledRoot).href}?claim=113601`
    )
}

async function parseFbx(characterId = 113401) {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
    const productRoot = characterId === 113601
        ? './magia-exedra-character-three/nonbattle-models'
        : './magia-exedra-character-three/models'
    const fbxUrl = new URL(
        `${productRoot}/chara_${characterId}_model/chara_${characterId}_model.fbx.gz`,
        repo,
    )
    const decoded = zlib.gunzipSync(fs.readFileSync(fbxUrl))
    const buffer = decoded.buffer.slice(
        decoded.byteOffset,
        decoded.byteOffset + decoded.byteLength,
    )
    return new FBXLoader().parse(buffer, '')
}

function fakeCharacter(root, characterId = 113401) {
    const meshes = []
    root.traverse(object => {
        if (object.isMesh) meshes.push(object)
    })
    const userData = {
        characterId,
        meshes,
        textures: [],
        outlineMeshes: [],
        animationLoops: [],
        disposeCallbacks: [],
    }
    root.userData = userData
    return {
        object: root,
        userData,
        disposed: false,
        dispose() {
            for (const callback of [...this.userData.disposeCallbacks]) callback()
            this.userData.disposeCallbacks.length = 0
            this.disposed = true
        },
    }
}

function findExactPath(root, path) {
    const parts = path.split('/').filter(Boolean)
    if (parts[0] === root.name) parts.shift()
    let current = root
    for (const name of parts) {
        current = current.children.find(child => child.name === name)
        if (!current) return undefined
    }
    return current
}

test('113401 public product keeps exact typed story identity and controller authority', () => {
    assert.equal(manifest.schema, 'magius.nonbattle-character-catalog.v1')
    assert.deepEqual(manifest.counts, {
        entries: 3,
        sourceReady: 3,
        technicalRuntimeReady: 3,
        newCandidate: 3,
        userAccepted: 0,
        failClosed: 0,
    })
    assert.equal(manifest.entries.length, 3)
    const entry = manifest.entries.find(value => value.style3dCharacterMstId === 113401)
    assert.ok(entry)
    assert.equal(
        entry.stableKey,
        'style3d-character:style3dCharacterMstId=113401|resourceName=chara_113401_model',
    )
    assert.equal(entry.identityKey, 'style3dCharacterMstId=113401|resourceName=chara_113401_model')
    assert.equal(entry.names.ja, '\u540d\u524d\u306e\u306a\u3044\u5c11\u5973')
    assert.deepEqual(
        [...entry.names.ja].map(value => `U+${value.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`),
        ['U+540D', 'U+524D', 'U+306E', 'U+306A', 'U+3044', 'U+5C11', 'U+5973'],
    )
    assert.equal(entry.sourceFamily, 'story-cutscene')
    assert.equal(entry.eligibility.ordinaryCharacterSelector, false)
    assert.equal(entry.eligibility.battle, false)
    assert.equal(entry.eligibility.tps, false)
    assert.equal(entry.eligibility.dungeon, false)
    assert.equal(entry.eligibility.magicalGirl, false)

    assert.equal(profile.schema, 'magius.nonbattle-character-profile.v1')
    assert.equal(profile.stableKey, entry.stableKey)
    assert.equal(profile.model.outerRootPath, 'chara_113401_model')
    assert.equal(profile.model.neutralRenderRootPath, 'chara_113401_model/ChOr_113401')
    assert.equal(profile.storyController.activeControllerPathId, '8103184246897463375')
    assert.equal(profile.storyController.name, 'chara_113401_model_namae')
    assert.equal(profile.storyController.defaultAction, 'Wait')
    assert.equal(profile.storyController.clipCount, 65)
    assert.equal(profile.storyController.clips.length, 65)
    assert.equal(new Set(profile.storyController.clips.map(value => value.name)).size, 65)
    assert.deepEqual(
        profile.model.renderers.map(value => [
            value.meshName,
            value.expandedIndexCount,
            value.boneCount,
            value.bindPoseCount,
        ]),
        [
            ['Body_Mesh', 20088, 46, 46],
            ['Eye_Mesh_L', 2304, 5, 5],
            ['Eye_Mesh_R', 2304, 5, 5],
        ],
    )
})

test('113501 public product keeps exact A-Q rig, skin, controller and physics identities', () => {
    const entry = manifest.entries.find(value => value.style3dCharacterMstId === 113501)
    assert.ok(entry)
    assert.equal(
        entry.stableKey,
        'style3d-character:style3dCharacterMstId=113501|resourceName=chara_113501_model',
    )
    assert.equal(entry.identityKey, 'style3dCharacterMstId=113501|resourceName=chara_113501_model')
    assert.equal(entry.names.ja, 'A-Q')
    assert.equal(entry.sourceFamily, 'story-cutscene')
    assert.deepEqual(entry.eligibility, {
        ordinaryCharacterSelector: false,
        battle: false,
        tps: false,
        dungeon: false,
        magicalGirl: false,
        storyCutscene: true,
    })

    assert.equal(aqProfile.stableKey, entry.stableKey)
    assert.equal(aqProfile.model.outerRootPath, 'chara_113501_model')
    assert.equal(aqProfile.model.neutralRenderRootPath, 'chara_113501_model/chara_113501')
    assert.deepEqual(aqProfile.model.authoredOuterPlacement.viewer.position, [
        1.2990000247955322,
        0,
        -2.2690000534057617,
    ])
    assert.deepEqual(
        aqProfile.model.renderers.map(value => [
            value.meshName,
            value.rendererPathId,
            value.meshPathId,
            value.expandedIndexCount,
            value.boneCount,
            value.bindPoseCount,
        ]),
        [
            ['Body_Mesh', '4614459510941682014', '-7841414977588179481', 10728, 53, 53],
            ['Face_Mesh', '2117280375574445152', '-364862887904314704', 11928, 82, 82],
        ],
    )
    assert.equal(aqProfile.storyController.activeControllerPathId, '-4278097510018638778')
    assert.equal(aqProfile.storyController.name, 'chara_113501_a-q')
    assert.equal(aqProfile.storyController.defaultAction, 'Wait')
    assert.equal(aqProfile.storyController.clipCount, 67)
    assert.equal(aqProfile.storyController.clips.length, 67)
    assert.equal(new Set(aqProfile.storyController.clips.map(value => value.name)).size, 67)

    const physicsProfile = JSON.parse(fs.readFileSync(
        new URL('./public/character-physics/characters/113501/profile.v1.json', repo),
        'utf8',
    ))
    assert.equal(aqProfile.physics.attachment, 'required')
    assert.equal(
        aqProfile.physics.writerPolicy,
        'existing-character-physics-single-writer',
    )
    assert.equal(aqProfile.physics.profileStableKey, physicsProfile.stableKey)
    assert.deepEqual(
        aqProfile.physics.expectedClothComponentStableKeys,
        physicsProfile.components.cloth.map(value => value.stableKey),
    )
    assert.equal(
        aqProfile.physics.expectedPlaneColliderStableKey,
        physicsProfile.components.colliders[0].stableKey,
    )
    assert.equal(aqProfile.physics.expectedClothTeams, 4)
    assert.equal(aqProfile.physics.expectedMagicaColliders, 1)
})

test('113601 product preserves exact Yodaka identity, seven renderers, Eye_R2 and wing drop authority', () => {
    const entry = manifest.entries.find(value => value.style3dCharacterMstId === 113601)
    assert.ok(entry)
    assert.equal(entry.names.ja, '\u30e8\u30c0\u30ab')
    assert.equal(entry.names.alias, '\u30e8\u30bf\u30ab')
    assert.deepEqual(
        [...entry.names.ja].map(value => `U+${value.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`),
        ['U+30E8', 'U+30C0', 'U+30AB'],
    )
    assert.deepEqual(entry.eligibility, {
        ordinaryCharacterSelector: false,
        battle: false,
        tps: false,
        dungeon: false,
        magicalGirl: false,
        storyCutscene: true,
    })
    assert.equal(yodakaProfile.model.outerRootPath, 'chara_113601_model')
    assert.equal(
        yodakaProfile.model.neutralRenderRootPath,
        'chara_113601_model/chara_113601',
    )
    assert.deepEqual(
        yodakaProfile.model.renderers.map(value => [
            value.meshName,
            value.expandedIndexCount,
            value.boneCount,
            value.bindPoseCount,
        ]),
        [
            ['Body_Mesh', 14286, 48, 48],
            ['Eye_L_Mesh', 384, 1, 1],
            ['Eye_R_Mesh', 1440, 4, 4],
            ['Head_Mesh', 12588, 60, 60],
            ['Tangue_Mesh', 708, 5, 5],
            ['WingHand_Mesh', 4776, 55, 55],
            ['Wing_Mesh', 7056, 55, 55],
        ],
    )
    assert.equal(
        yodakaProfile.model.skinBindPoseClosure.policy,
        'postmultiply-exported-inverses-by-authored-outer-viewer-matrix',
    )
    assert.equal(
        yodakaProfile.model.skinBindPoseClosure.anchorRendererPath,
        'chara_113601_model/chara_113601/chara/Body_Mesh',
    )
    assert.equal(yodakaProfile.model.skinBindPoseClosure.anchorBoneName, 'Root')
    assert.deepEqual(
        yodakaProfile.model.skinBindPoseClosure.sourceAnchorInverse.slice(12, 15),
        [0.7537211151121892, -0.11999999731779099, 7.550664018185538],
    )
    assert.deepEqual(
        yodakaProfile.model.skinBindPoseClosure.targetAnchorInverse,
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    )
    assert.equal(yodakaProfile.storyController.activeControllerPathId, '-3051724465002089795')
    assert.equal(yodakaProfile.storyController.name, 'chara_113601_yodaka')
    assert.equal(yodakaProfile.storyController.defaultAction, 'Wait')
    assert.equal(yodakaProfile.storyController.clipCount, 23)
    assert.equal(new Set(yodakaProfile.storyController.clips.map(value => value.name)).size, 23)

    const eye = yodakaProfile.model.nativeTransformClosures[0]
    assert.equal(
        eye.path,
        'chara_113601_model/chara_113601/Root/Hip/Spine/Chest/Neck/Eye_R1/Eye_R2',
    )
    assert.deepEqual(eye.target.position, [0, 0, 0])
    assert.deepEqual(eye.target.scale, [1, 1, 1])
    assert.deepEqual(eye.target.quaternion, [
        -0.16162952780723572,
        0.01979290507733822,
        -0.012852368876338005,
        0.986569344997406,
    ])
    const helper = yodakaProfile.model.nativeTransformClosures[1]
    assert.equal(helper.path, 'chara_113601_model/eff_yodaka_wing_drop/Plane Transform 1')
    assert.deepEqual(helper.aliases, [
        'chara_113601_model/eff_yodaka_wing_drop/Plane_Transform_1',
    ])

    assert.equal(yodakaEffect.schema, 'magius.nonbattle-character-effect.v1')
    assert.equal(yodakaEffect.source.particleSystemPathId, '-9172322981071545258')
    assert.equal(yodakaEffect.source.particleSystemRendererPathId, '1119551782396767777')
    assert.equal(yodakaEffect.renderer.mesh.pathId, '9065106574352593721')
    assert.equal(yodakaEffect.renderer.mesh.name, 'eff_mesh_drop')
    assert.equal(yodakaEffect.renderer.mesh.expandedVertexCount, 504)
    assert.equal(yodakaEffect.renderer.mesh.positions.length, 504 * 3)
    assert.equal(yodakaEffect.renderer.mesh.normals.length, 504 * 3)
    assert.equal(yodakaEffect.renderer.mesh.uv0.length, 504 * 2)
    assert.equal(yodakaEffect.particleSystem.shape.type, 14)
    assert.equal(yodakaEffect.particleSystem.shape.placementMode, 2)
    assert.deepEqual(yodakaEffect.particleSystem.emission.rateOverTime, {
        minMaxState: 3,
        scalar: 8,
        minScalar: 4,
    })
    assert.equal(yodakaProfile.physics.expectedClothTeams, 0)
    assert.equal(yodakaProfile.physics.expectedMagicaColliders, 0)
    assert.equal(yodakaProfile.physics.expectedNativeColliders, 1)
})

test('typed catalog excludes 113401 from the ordinary selector and exposes it separately', async () => {
    const catalog = await import(
        './magia-exedra-character-three/nonBattleCharacterCatalog.ts'
    )
    assert.deepEqual(
        catalog.listNonBattleCharacterCatalogEntries()
            .map(entry => entry.style3dCharacterMstId),
        [113401, 113501, 113601],
    )
    assert.equal(
        catalog.getNonBattleCharacterEntryByStableKey(manifest.entries[0].stableKey).resourceName,
        'chara_113401_model',
    )
    assert.equal(catalog.isNonBattleCharacterId(113401), true)
    const managerSource = fs.readFileSync(
        new URL('./magia-exedra-character-three/index.ts', repo),
        'utf8',
    )
    assert.match(managerSource, /\.filter\(id => !isNonBattleCharacterId\(id\)\)/)
})

test('113501 neutral presentation binds four official cloth teams and one plane collider', async () => {
    const { applyNonBattleCharacterProfile } = await import(
        './magia-exedra-character-three/nonBattleCharacterLoader.ts'
    )
    const { getNonBattleCharacterEntryById } = await import(
        './magia-exedra-character-three/nonBattleCharacterCatalog.ts'
    )
    const { createNativeCharacterPhysics, CharacterPhysicsWriterConflictError } =
        await importCharacterPhysicsRuntime()
    const root = await parseFbx(113501)
    const character = fakeCharacter(root, 113501)
    const entry = getNonBattleCharacterEntryById(113501)
    assert.ok(entry)
    const authored = {
        position: root.position.toArray(),
        quaternion: root.quaternion.toArray(),
        scale: root.scale.toArray(),
    }
    const nested = root.getObjectByName('chara_113501')
    assert.ok(nested)
    const metadata = applyNonBattleCharacterProfile(
        character,
        entry,
        aqProfile,
        '/nonbattle-characters/characters/113501/profile.v1.json',
    )
    assert.deepEqual(root.position.toArray(), [0, 0, 0])
    assert.deepEqual(root.quaternion.toArray(), [0, 0, 0, 1])
    assert.deepEqual(root.scale.toArray(), [1, 1, 1])
    assert.equal(metadata.presentationRoot, nested)
    assert.equal(nested.parent, root)
    assert.deepEqual(metadata.scenarioInstance.authoredOuterPlacement.viewer, authored)
    assert.equal(metadata.scenarioInstance.appliedToViewerRoot, false)
    assert.equal(metadata.physics.profileStableKey, aqProfile.physics.profileStableKey)

    const physicsProfile = JSON.parse(fs.readFileSync(
        new URL('./public/character-physics/characters/113501/profile.v1.json', repo),
        'utf8',
    ))
    const runtime = createNativeCharacterPhysics(root, physicsProfile)
    assert.equal(runtime.diagnostics.status, 'ready')
    assert.equal(runtime.diagnostics.clothTeams, 4)
    assert.equal(runtime.diagnostics.magicaColliders, 1)
    assert.equal(runtime.diagnostics.missingBindings.length, 0)
    runtime.updateAfterAnimation(1 / 60)
    assert.equal(runtime.diagnostics.nonFiniteCorrections, 0)
    assert.throws(
        () => createNativeCharacterPhysics(root, physicsProfile),
        CharacterPhysicsWriterConflictError,
    )
    runtime.dispose()
    const retry = createNativeCharacterPhysics(root, physicsProfile)
    assert.equal(retry.diagnostics.clothTeams, 4)
    assert.equal(retry.diagnostics.magicaColliders, 1)
    retry.dispose()
})

test('113601 neutral presentation restores Eye_R2, the wing helper and its native sphere collider', async () => {
    const { applyNonBattleCharacterProfile } = await import(
        './magia-exedra-character-three/nonBattleCharacterLoader.ts'
    )
    const { getNonBattleCharacterEntryById } = await import(
        './magia-exedra-character-three/nonBattleCharacterCatalog.ts'
    )
    const { createNativeCharacterPhysics } = await importCharacterPhysicsRuntime()
    const root = await parseFbx(113601)
    const character = fakeCharacter(root, 113601)
    const entry = getNonBattleCharacterEntryById(113601)
    assert.ok(entry)
    const eyeContract = yodakaProfile.model.nativeTransformClosures[0]
    const bindPoseContract = yodakaProfile.model.skinBindPoseClosure
    const eye = findExactPath(root, eyeContract.path)
    const body = findExactPath(root, bindPoseContract.anchorRendererPath)
    assert.ok(eye)
    assert.ok(body?.isSkinnedMesh)
    assert.equal(body.skeleton.bones[0].name, bindPoseContract.anchorBoneName)
    assert.ok(body.skeleton.boneInverses[0].elements.every((value, index) => (
        Math.abs(value - bindPoseContract.sourceAnchorInverse[index]) < 1e-5
    )))
    assert.ok(Math.abs(eye.scale.y - eyeContract.sourceExpected.scale[1]) < 1e-5)
    assert.ok(findExactPath(
        root,
        'chara_113601_model/eff_yodaka_wing_drop/Plane_Transform_1',
    ))

    const metadata = applyNonBattleCharacterProfile(
        character,
        entry,
        yodakaProfile,
        '/nonbattle-characters/characters/113601/profile.v1.json',
    )
    assert.equal(metadata.presentationRoot.name, 'chara_113601')
    assert.deepEqual(root.position.toArray(), [0, 0, 0])
    assert.deepEqual(root.quaternion.toArray(), [0, 0, 0, 1])
    assert.deepEqual(root.scale.toArray(), [1, 1, 1])
    assert.deepEqual(eye.position.toArray(), eyeContract.target.position)
    assert.deepEqual(eye.quaternion.toArray(), eyeContract.target.quaternion)
    assert.deepEqual(eye.scale.toArray(), eyeContract.target.scale)
    assert.equal(
        findExactPath(root, yodakaProfile.effects[0].helperPath)?.name,
        'Plane Transform 1',
    )
    assert.equal(root.getObjectByName('Plane_Transform_1'), undefined)
    assert.equal(character.userData.meshes.length, 7)
    assert.equal(character.object.animations.length, 23)
    assert.ok(body.skeleton.boneInverses[0].elements.every((value, index) => (
        Math.abs(value - bindPoseContract.targetAnchorInverse[index]) < 1e-5
    )))

    const { Box3, Vector3 } = await import('three')
    root.updateMatrixWorld(true)
    const bounds = new Box3()
    for (const renderer of yodakaProfile.model.renderers) {
        const mesh = findExactPath(root, renderer.hierarchyPath)
        assert.ok(mesh?.isSkinnedMesh)
        mesh.computeBoundingBox()
        mesh.computeBoundingSphere()
        bounds.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
    }
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    assert.ok(size.x > 0.5 && size.x < 1)
    assert.ok(size.y > 0.4 && size.y < 1)
    assert.ok(size.z > 0.2 && size.z < 0.6)
    assert.ok(Math.abs(center.x) < 0.1)
    assert.ok(center.y > 0.1 && center.y < 0.5)
    assert.ok(Math.abs(center.z) < 0.1)

    const physicsProfile = JSON.parse(fs.readFileSync(
        new URL('./public/character-physics/characters/113601/profile.v1.json', repo),
        'utf8',
    ))
    const runtime = createNativeCharacterPhysics(root, physicsProfile)
    assert.equal(runtime.diagnostics.status, 'ready')
    assert.equal(runtime.diagnostics.clothTeams, 0)
    assert.equal(runtime.diagnostics.magicaColliders, 0)
    assert.equal(runtime.diagnostics.bodyColliders, 1)
    assert.equal(runtime.diagnostics.missingBindings.length, 0)
    runtime.dispose()
})

test('113601 wrapper installs and advances the exact wing-drop product before callbacks', async () => {
    const { loadNonBattleCharacter, getNonBattleCharacterRuntimeMetadata } = await import(
        './magia-exedra-character-three/nonBattleCharacterLoader.ts'
    )
    const { getNonBattleCharacterEntryById } = await import(
        './magia-exedra-character-three/nonBattleCharacterCatalog.ts'
    )
    const entry = getNonBattleCharacterEntryById(113601)
    assert.ok(entry)
    const root = await parseFbx(113601)
    const character = fakeCharacter(root, 113601)
    const events = []
    let projectedFiles
    const result = await loadNonBattleCharacter(
        {
            '/nonbattle-models/chara_113601_model/chara_113601_model.fbx.gz': '/model.magiadata',
            '/nonbattle-models/chara_113601_model/chara_113601_head_color.png': '/head-color.png',
            '/nonbattle-models/chara_113601_model/chara_113601_head_shadow.png': '/head-shadow.png',
            '/nonbattle-models/chara_113601_model/chara_113601_head_ctrl.png': '/head-ctrl.png',
            '/nonbattle-models/chara_113601_model/wing-drop-effect.v1.json': '/wing-drop-effect.v1.json',
        },
        entry,
        {
            modelLoadedCallback(value) {
                events.push(['model', getNonBattleCharacterRuntimeMetadata(value)?.effects.length])
            },
            loadFinishCallback(value) {
                events.push(['finish', getNonBattleCharacterRuntimeMetadata(value)?.effects.length])
            },
        },
        {
            fetcher: async input => {
                const url = String(input)
                const payload = url.includes('wing-drop-effect')
                    ? yodakaEffect
                    : yodakaProfile
                return new Response(JSON.stringify(payload), { status: 200 })
            },
            baseLoader: async (files, callbacks) => {
                projectedFiles = files
                callbacks?.modelLoadedCallback?.(character)
                callbacks?.loadFinishCallback?.(character)
                return character
            },
        },
    )
    assert.equal(result, character)
    assert.equal(yodakaProfile.model.rendererTextureBindings.length, 3)
    assert.deepEqual(
        yodakaProfile.model.rendererTextureBindings.map(binding => [
            binding.meshName,
            binding.sourceMaterialPathId,
            binding.sourceMaterialName,
            binding.sourceTextureStem,
            binding.projectedTextureStem,
            binding.requiredTextureKinds,
            binding.policy,
        ]),
        [
            ['Eye_L_Mesh', '1336752404538202619', 'mt_chara_113601_head', 'head', 'eye_l', ['color', 'shadow', 'ctrl'], 'project-authority-material-texture-set'],
            ['Eye_R_Mesh', '1336752404538202619', 'mt_chara_113601_head', 'head', 'eye_r', ['color', 'shadow', 'ctrl'], 'project-authority-material-texture-set'],
            ['Tangue_Mesh', '1336752404538202619', 'mt_chara_113601_head', 'head', 'tangue', ['color', 'shadow', 'ctrl'], 'project-authority-material-texture-set'],
        ],
    )
    for (const [stem, kind, expectedUrl] of [
        ['eye_l', 'color', '/head-color.png'],
        ['eye_l', 'shadow', '/head-shadow.png'],
        ['eye_l', 'ctrl', '/head-ctrl.png'],
        ['eye_r', 'color', '/head-color.png'],
        ['eye_r', 'shadow', '/head-shadow.png'],
        ['eye_r', 'ctrl', '/head-ctrl.png'],
        ['tangue', 'color', '/head-color.png'],
        ['tangue', 'shadow', '/head-shadow.png'],
        ['tangue', 'ctrl', '/head-ctrl.png'],
    ]) {
        const projectedEntry = Object.entries(projectedFiles).find(([path]) => (
            path.includes(`_${stem}_${kind}`)
        ))
        assert.deepEqual(projectedEntry, [
            `/nonbattle-models/chara_113601_model/chara_113601_${stem}_${kind}.png`,
            expectedUrl,
        ])
    }
    assert.deepEqual(events, [['model', 1], ['finish', 1]])
    const effect = getNonBattleCharacterRuntimeMetadata(character).effects[0]
    assert.equal(effect.stableKey, yodakaEffect.stableKey)
    assert.equal(effect.object.userData.sourceMeshPathId, '9065106574352593721')
    for (let frame = 0; frame < 240; frame += 1) effect.step(1 / 60)
    assert.ok(effect.emittedParticles >= 23 && effect.emittedParticles <= 25)
    assert.ok(effect.activeParticles > 0)
    assert.equal(effect.object.count, effect.activeParticles)
    assert.ok([...effect.object.instanceMatrix.array].every(Number.isFinite))
    character.dispose()
    assert.equal(effect.object.parent, null)
    assert.equal(character.userData.animationLoops.length, 0)
})

test('113401 neutral presentation keeps the official nested rig intact', async () => {
    const { applyNonBattleCharacterProfile } = await import(
        './magia-exedra-character-three/nonBattleCharacterLoader.ts'
    )
    const root = await parseFbx()
    const character = fakeCharacter(root)
    const before = {
        position: root.position.toArray(),
        quaternion: root.quaternion.toArray(),
        scale: root.scale.toArray(),
    }
    assert.deepEqual(before, profile.model.authoredOuterPlacement.viewer)
    const nested = root.getObjectByName('ChOr_113401')
    assert.ok(nested)
    assert.equal(nested.parent, root)

    const metadata = applyNonBattleCharacterProfile(
        character,
        manifest.entries[0],
        profile,
        '/nonbattle-characters/characters/113401/profile.v1.json',
    )
    assert.deepEqual(root.position.toArray(), [0, 0, 0])
    assert.deepEqual(root.quaternion.toArray(), [0, 0, 0, 1])
    assert.deepEqual(root.scale.toArray(), [1, 1, 1])
    assert.equal(metadata.presentationRoot, nested)
    assert.equal(nested.parent, root)
    assert.equal(metadata.scenarioInstance.appliedToViewerRoot, false)
    assert.deepEqual(
        metadata.scenarioInstance.authoredOuterPlacement.viewer,
        before,
    )
    assert.equal(character.object.animations.length, 65)
    assert.equal(character.userData.meshes.length, 3)
    assert.equal(metadata.storyController.defaultAction, 'Wait')
})

test('nonbattle wrapper exposes callbacks only after neutralization and supports abort/retry', async () => {
    const {
        loadNonBattleCharacter,
    } = await import('./magia-exedra-character-three/nonBattleCharacterLoader.ts')
    const {
        getNonBattleCharacterEntryById,
    } = await import('./magia-exedra-character-three/nonBattleCharacterCatalog.ts')
    const entry = getNonBattleCharacterEntryById(113401)
    assert.ok(entry)

    const aborted = new AbortController()
    aborted.abort(new DOMException('test abort', 'AbortError'))
    await assert.rejects(
        loadNonBattleCharacter(
            { '/chara_113401_model/model.fbx.gz': '/model' },
            entry,
            { signal: aborted.signal },
            {
                fetcher: async () => new Response(JSON.stringify(profile)),
                baseLoader: async () => assert.fail('aborted request reached base loader'),
            },
        ),
        error => error?.name === 'AbortError',
    )

    const root = await parseFbx()
    const character = fakeCharacter(root)
    const events = []
    const result = await loadNonBattleCharacter(
        { '/chara_113401_model/model.fbx.gz': '/model' },
        entry,
        {
            modelLoadedCallback(value) {
                events.push(['model', ...value.object.position.toArray()])
            },
            loadFinishCallback(value) {
                events.push(['finish', ...value.object.position.toArray()])
            },
        },
        {
            fetcher: async () => new Response(JSON.stringify(profile), { status: 200 }),
            baseLoader: async (_files, callbacks) => {
                callbacks?.modelLoadedCallback?.(character)
                callbacks?.loadFinishCallback?.(character)
                return character
            },
        },
    )
    assert.equal(result, character)
    assert.deepEqual(events, [
        ['model', 0, 0, 0],
        ['finish', 0, 0, 0],
    ])
    assert.equal(character.disposed, false)
})

test('production routing is catalog-driven and leaves action, visual and UI ownership untouched', () => {
    const paths = [
        './magia-exedra-character-three/nonBattleCharacterCatalog.ts',
        './magia-exedra-character-three/nonBattleCharacterLoader.ts',
        './magia-exedra-character-three/index.ts',
        './magia-exedra-character-three/scene/index.ts',
        './src/viewer/character.ts',
    ]
    const sources = Object.fromEntries(paths.map(path => [
        path,
        fs.readFileSync(new URL(path, repo), 'utf8'),
    ]))
    assert.doesNotMatch(sources['./magia-exedra-character-three/nonBattleCharacterLoader.ts'], /113401|113501|113601/)
    assert.doesNotMatch(sources['./magia-exedra-character-three/scene/index.ts'], /113401|113501|113601/)
    assert.doesNotMatch(sources['./src/viewer/character.ts'], /113401|113501|113601/)
    assert.match(sources['./magia-exedra-character-three/index.ts'], /isNonBattleCharacterId/)
    assert.match(sources['./magia-exedra-character-three/scene/index.ts'], /addNonBattleCharacter/)
    assert.match(
        sources['./src/viewer/character.ts'],
        /typed-nonbattle-existing-character-physics/,
    )
    const viewerSource = sources['./src/viewer/character.ts']
    assert.ok(
        viewerSource.indexOf('getNonBattleCharacterRuntimeMetadata(character)')
        < viewerSource.indexOf('attachViewerCharacterPhysics(character)'),
    )
})
