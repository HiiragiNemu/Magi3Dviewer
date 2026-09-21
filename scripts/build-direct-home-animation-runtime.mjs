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

const [inputFile, metadataFile, outputFile, characterIdText] = process.argv.slice(2)
if (
    !inputFile
    || !metadataFile
    || !outputFile
    || !/^\d{6}$/.test(characterIdText ?? '')
) {
    throw new Error(
        'Usage: node scripts/build-direct-home-animation-runtime.mjs '
        + 'INPUT.fbx HOME-ACTIONS.json OUTPUT.json.gz CHARACTER_ID',
    )
}

const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
if (
    metadata.schema !== 'magius.direct-home-actions.v1'
    || metadata.runtimeSchema !== 2
    || metadata.characterId !== Number(characterIdText)
) {
    throw new Error('Direct Home action metadata does not match the requested character')
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
const names = new Set(clips.map(clip => clip.name))
const required = Array.isArray(metadata.requiredClips) ? metadata.requiredClips : []
const missingRequired = required.filter(name => !names.has(name))
if (missingRequired.length > 0) {
    throw new Error(`Converted FBX is missing required clips: ${missingRequired.join(', ')}`)
}

const boardActions = Array.isArray(metadata.boardActions) ? metadata.boardActions : []
const sourceNames = new Set(boardActions.map(action => action.name))
const missingSource = [...sourceNames].filter(name => !names.has(name))
const unexpected = [...names].filter(name => !sourceNames.has(name))
if (missingSource.length > 0 || unexpected.length > 0) {
    throw new Error(
        `Direct Home clip identity differs: missing=${missingSource.join(', ')}; `
        + `unexpected=${unexpected.join(', ')}`,
    )
}

const serializedByName = new Map(clips.map(clip => [clip.name, clip]))
const identityByName = new Map(
    (metadata.clipIdentities ?? []).map(identity => [identity.importedName, identity]),
)
for (const action of boardActions) {
    const serialized = serializedByName.get(action.name)
    const identity = identityByName.get(action.name)
    if (!serialized || !identity) {
        throw new Error(`Missing converted identity for ${action.name}`)
    }
    if (
        String(identity.sourceClipPathId) !== String(action.sourceClipPathId)
        || identity.sourceName !== action.name
        || identity.importedName !== action.name
        || !Number.isInteger(identity.transformTrackCount)
        || identity.transformTrackCount <= 0
    ) {
        throw new Error(`Converted identity mismatch for ${action.name}`)
    }
    if (Math.abs(Number(action.durationSeconds) - Number(serialized.duration)) > 1 / 30) {
        throw new Error(`Converted duration mismatch for ${action.name}`)
    }
}

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

const payload = {
    schema: 2,
    characterId: Number(characterIdText),
    unityVersion: metadata.unityVersion,
    source: metadata.source,
    defaultAction: metadata.defaultAction,
    expressionMode: metadata.expressionMode,
    activeControllerPathId: metadata.activeControllerPathId,
    boardActions,
    clipIdentities: metadata.clipIdentities,
    helpers: [],
    externalHelpers: [],
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
    clips: clips.length,
    referencedNodes: referencedNodeIds.size,
    defaultAction: payload.defaultAction,
    jsonBytes: encoded.length,
    gzipBytes: compressed.length,
    output: path.resolve(outputFile),
}, null, 2))
