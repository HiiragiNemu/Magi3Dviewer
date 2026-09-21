import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import zlib from 'node:zlib'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

globalThis.document = {
    createElementNS() {
        return {
            addEventListener() {},
            removeEventListener() {},
            set src(_value) {},
        }
    },
}

const modelRoot = new URL(
    './magia-exedra-character-three/models/chara_113501_model/',
    import.meta.url,
)
const materialProfiles = JSON.parse(fs.readFileSync(new URL(
    './magia-exedra-character-three/official-material-profiles.json',
    import.meta.url,
), 'utf8'))
const controllerProfiles = JSON.parse(fs.readFileSync(new URL(
    './magia-exedra-character-three/official-character-controller-profiles.generated.json',
    import.meta.url,
), 'utf8'))
const faceProfiles = fs.readFileSync(new URL(
    './magia-exedra-character-three/faceProfile.ts',
    import.meta.url,
), 'utf8')
const submeshGroups = fs.readFileSync(new URL(
    './magia-exedra-character-three/submeshGroups.generated.ts',
    import.meta.url,
), 'utf8')

test('A-Q runtime FBX preserves official material-slot identities', () => {
    const compressed = fs.readFileSync(new URL('chara_113501_model.fbx.gz', modelRoot))
    const input = zlib.gunzipSync(compressed)
    const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
    const root = new FBXLoader().parse(buffer, '')
    const meshes = new Map()
    root.traverse(object => {
        if (!object.isMesh) return
        const materials = Array.isArray(object.material)
            ? object.material
            : [object.material]
        meshes.set(object.name, {
            materialNames: materials.map(material => material.name),
            positionCount: object.geometry.getAttribute('position').count,
            groups: object.geometry.groups,
        })
    })
    assert.deepEqual(meshes.get('Body_Mesh').materialNames, [
        'mt_chara_113501_body',
    ])
    assert.deepEqual(meshes.get('Face_Mesh').materialNames, [
        'mt_chara_113501_eye_mask',
        'mt_chara_113501_face',
    ])
    assert.equal(meshes.get('Body_Mesh').positionCount, 10728)
    assert.equal(meshes.get('Face_Mesh').positionCount, 11928)
    assert.equal(meshes.get('Face_Mesh').groups.length, 0)
})

test('A-Q official material profiles retain serialized face/body routing', () => {
    const body = materialProfiles.materials.mt_chara_113501_body
    const eye = materialProfiles.materials.mt_chara_113501_eye_mask
    const face = materialProfiles.materials.mt_chara_113501_face
    assert.equal(body.outlineWidth, 3)
    assert.equal(body.shadow.castSelfShadow, true)
    assert.equal(body.additionalLightInfluenceByLuminance, 1)
    assert.equal(eye.face.isEye, true)
    assert.equal(eye.face.shouldApplyAdditional, true)
    assert.equal(eye.shadow.castSelfShadow, false)
    assert.equal(face.face.useGradientMap, false)
    assert.equal(face.shadow.castSelfShadow, false)
    assert.equal(face.outline.faceOutlineAdjust, 0.0010000000474974513)
})

test('A-Q controller and face profiles use direct-home serialized values', () => {
    const profile = controllerProfiles.profiles.find(
        value => value.characterId === 113501,
    )
    assert.deepEqual(profile, {
        characterId: 113501,
        headOffset: 0.029999999329447746,
        faceForwardAxis: '-x',
        faceUpAxis: 'y',
        faceRightAxis: 'z',
        headBoneName: 'Head',
        characterCancelPerspective: 1,
        additionalLightInfluenceByLuminance: 0,
        angelRingEnabled: false,
        hairUvAngelRing: false,
    })
    assert.match(faceProfiles, /\[113501, \{[^\n]+useFaceGradientMap: false/)
    assert.match(faceProfiles, /\[113501, \{[^\n]+faceAreaCameraDepthTextureZWriteOffset: 0\.0399999991/)
})

test('A-Q flattened FBX geometry restores exact Unity submesh ranges', () => {
    assert.match(
        submeshGroups,
        /113501: \{\s+"Body_Mesh": \[10728\],\s+"Face_Mesh": \[840, 11088\],/,
    )
})
