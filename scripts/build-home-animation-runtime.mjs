import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import * as THREE from 'three'
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

const [inputFile, outputFile, characterIdText, metadataFile] = process.argv.slice(2)
if (!inputFile || !outputFile || !/^\d{6}$/.test(characterIdText ?? '')) {
    throw new Error(
        'Usage: node scripts/build-home-animation-runtime.mjs INPUT.fbx OUTPUT.json.gz CHARACTER_ID',
    )
}

const input = fs.readFileSync(inputFile)
const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
const root = new FBXLoader().parse(buffer, '')

const nodePaths = new Map()
const objectPath = object => {
    const parts = []
    for (let current = object; current; current = current.parent) {
        parts.unshift(current.name || '<root>')
    }
    return parts.join('/')
}
root.traverse(object => nodePaths.set(object.uuid, objectPath(object)))

const clips = root.animations
    .filter(clip => clip.tracks.length > 0)
    .map(clip => THREE.AnimationClip.toJSON(clip))
const referencedNodeIds = new Set(
    clips.flatMap(clip => clip.tracks.map(track => track.name.split('.')[0])),
)
const referencedNodePaths = Object.fromEntries(
    [...referencedNodeIds].map(id => {
        const resolvedPath = nodePaths.get(id)
        if (!resolvedPath) throw new Error(`Animation target ${id} has no FBX node path`)
        return [id, resolvedPath]
    }),
)

const requiredClips = ['HomeWait01_L']
const names = new Set(clips.map(clip => clip.name))
const missing = requiredClips.filter(name => !names.has(name))
if (missing.length > 0) {
    throw new Error(`Converted FBX is missing required clips: ${missing.join(', ')}`)
}

const familyName = name => name
    .replace(/_weapon_[a-z0-9]+(?=_|$)/gi, '')
    .replace(/_\d+$/g, '')
const metadata = metadataFile
    ? JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
    : undefined
if (metadata) {
    if (metadata.schema !== 1 || metadata.characterId !== Number(characterIdText)) {
        throw new Error('Home action metadata does not match the converted character')
    }
    const availableFamilies = new Set(clips.map(clip => familyName(clip.name)))
    const requiredActionFamilies = [
        metadata.actions.wait01.loopFamily,
        metadata.actions.wait02.loopFamily,
        metadata.actions.unique01.startFamily,
        metadata.actions.unique01.loopFamily,
    ].map(familyName)
    const missingFamilies = requiredActionFamilies.filter(
        name => !availableFamilies.has(name),
    )
    if (missingFamilies.length > 0) {
        throw new Error(
            `Converted FBX is missing official Home action families: ${missingFamilies.join(', ')}`,
        )
    }
}

const payload = {
    schema: 1,
    characterId: Number(characterIdText),
    unityVersion: '2022.3.62f2',
    source: `home/doll_house/chara_${characterIdText}01_home`,
    actions: metadata?.actions,
    helpers: (metadata?.helpers ?? []).filter(name => (
        new Set(clips.map(clip => familyName(clip.name))).has(familyName(name))
    )),
    externalHelpers: (metadata?.helpers ?? []).filter(name => (
        !new Set(clips.map(clip => familyName(clip.name))).has(familyName(name))
    )),
    nodePaths: referencedNodePaths,
    clips,
}
const encoded = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8')
const compressed = zlib.gzipSync(encoded, { level: 9 })
fs.mkdirSync(path.dirname(outputFile), { recursive: true })
fs.writeFileSync(outputFile, compressed)

console.log(JSON.stringify({
    status: 'PASS',
    characterId: payload.characterId,
    clips: clips.map(clip => ({
        name: clip.name,
        duration: clip.duration,
        tracks: clip.tracks.length,
    })),
    referencedNodes: referencedNodeIds.size,
    jsonBytes: encoded.length,
    gzipBytes: compressed.length,
    output: path.resolve(outputFile),
}, null, 2))
