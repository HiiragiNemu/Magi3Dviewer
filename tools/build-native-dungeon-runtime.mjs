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

const [inputFile, outputFile, metadataFile, rawOutputFile] = process.argv.slice(2)
if (!inputFile || !outputFile || !metadataFile || !rawOutputFile) {
    throw new Error('Usage: node build-native-dungeon-runtime.mjs INPUT.fbx OUTPUT.json.gz METADATA.json RAW.json')
}

const source = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
if (source.schema !== 'magius.native-dungeon-export.v1') {
    throw new Error('Native Dungeon export metadata schema mismatch')
}

const bytes = fs.readFileSync(inputFile)
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const root = new FBXLoader().parse(buffer, '')

function objectPath(object) {
    const parts = []
    for (let current = object; current; current = current.parent) {
        parts.unshift(current.name || '<root>')
    }
    return parts.join('/')
}

const objectPaths = new Map()
root.traverse(object => objectPaths.set(object.uuid, objectPath(object)))
const modelRoots = []
root.traverse(object => {
    if (object.name === source.modelRootName) modelRoots.push(object)
})
if (modelRoots.length !== 1) {
    throw new Error(`Expected exactly one model root ${source.modelRootName}; found ${modelRoots.length}`)
}
const modelRoot = modelRoots[0]

function ordinalBinding(object) {
    const reversed = []
    for (let current = object; current && current !== modelRoot; current = current.parent) {
        const parent = current.parent
        if (!parent) throw new Error(`Animation target ${object.name} is outside ${source.modelRootName}`)
        const childIndex = parent.children.indexOf(current)
        if (childIndex < 0) throw new Error(`Animation target ${object.name} has no parent child index`)
        reversed.push({ childIndex, name: current.name })
    }
    if (object !== modelRoot && !objectPath(object).includes(`/${source.modelRootName}/`)) {
        throw new Error(`Animation target ${object.name} is outside native model root`)
    }
    return reversed.reverse()
}

function axisSummary(values, itemSize) {
    if (!values || values.length === 0 || itemSize !== 3) return null
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let index = 0; index < values.length; index += itemSize) {
        for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], values[index + axis])
            max[axis] = Math.max(max[axis], values[index + axis])
        }
    }
    const first = values.slice(0, 3)
    const last = values.slice(values.length - 3)
    return {
        samples: values.length / itemSize,
        min,
        max,
        span: max.map((value, index) => value - min[index]),
        first,
        last,
        delta: last.map((value, index) => value - first[index]),
    }
}

function keyBoneCurveSummary(serialized, nodePaths) {
    const suffixes = {
        root: '/Root',
        hip: '/Root/Hip',
        footL: '/Foot_L',
        footR: '/Foot_R',
        toeL: '/Toe_L',
        toeR: '/Toe_R',
    }
    const result = {}
    for (const [role, suffix] of Object.entries(suffixes)) {
        const candidates = serialized.tracks.filter(track => {
            const separator = track.name.indexOf('.')
            if (separator < 1 || track.name.slice(separator) !== '.position') return false
            const nodePath = nodePaths[track.name.slice(0, separator)]
            return nodePath?.endsWith(suffix)
        })
        if (candidates.length !== 1) {
            result[role] = { status: candidates.length === 0 ? 'blank' : 'ambiguous', candidates: candidates.length }
            continue
        }
        const track = candidates[0]
        result[role] = {
            status: 'exact',
            nodePath: nodePaths[track.name.slice(0, track.name.indexOf('.'))],
            position: axisSummary(track.values, 3),
        }
    }
    return result
}

const clips = []
const allNodePaths = {}
const allNodeBindings = {}
for (const descriptor of source.clips) {
    const matches = root.animations.filter(clip => clip.name === descriptor.sourceName)
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one converted clip ${descriptor.sourceName}; found ${matches.length}`)
    }
    const converted = matches[0].clone()
    converted.name = descriptor.runtimeName
    const serialized = THREE.AnimationClip.toJSON(converted)
    const referencedIds = new Set(serialized.tracks.map(track => track.name.split('.')[0]))
    const nodePaths = Object.fromEntries([...referencedIds].map(id => {
        const resolved = objectPaths.get(id)
        if (!resolved) throw new Error(`Animation target ${id} has no FBX node path`)
        allNodePaths[id] = resolved
        const target = root.getObjectByProperty('uuid', id)
        if (!target) throw new Error(`Animation target ${id} has no FBX object`)
        allNodeBindings[id] = {
            sourcePath: resolved,
            ordinalPath: ordinalBinding(target),
        }
        return [id, resolved]
    }))
    clips.push({
        ...serialized,
        semantic: descriptor.semantic,
        actionId: descriptor.actionId,
        sourceName: descriptor.sourceName,
        sourceClipPathId: descriptor.sourceClipPathId,
        sourceDurationSeconds: descriptor.durationSeconds,
        sourceSampleRate: descriptor.sampleRate,
        sourceGenericBindings: descriptor.genericBindings,
        runtimeName: descriptor.runtimeName,
        motionReference: {
            cycleSeconds: serialized.duration,
            cadenceHz: serialized.duration > 0 ? 1 / serialized.duration : null,
            transformTrackCount: serialized.tracks.length,
            keyBoneCurves: keyBoneCurveSummary(serialized, nodePaths),
        },
    })
}

const payload = {
    schema: 'magius.native-dungeon-action-runtime.v1',
    dungeonCharacterId: source.dungeonCharacterId,
    characterMstId: source.characterMstId,
    modelKey: source.modelKey,
    modelRootName: source.modelRootName,
    sourceModelBundle: source.sourceModelBundle,
    sourceAnimationBundle: source.sourceAnimationBundle,
    controller: source.controller,
    rootPolicy: 'controlled-viewer-root;suppress-Root.position;preserve-skeleton-curves',
    attachmentPolicy: 'body-only;external-sibling-weapon-excluded',
    compatibility: {
        mode: 'native-model-only',
        exactModelKey: source.modelKey,
        exactModelRootName: source.modelRootName,
        referencedNodePathCount: Object.keys(allNodePaths).length,
    },
    clips,
    nodePaths: allNodePaths,
    nodeBindings: allNodeBindings,
}

const encoded = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8')
const compressed = zlib.gzipSync(encoded, { level: 9 })
fs.mkdirSync(path.dirname(outputFile), { recursive: true })
fs.writeFileSync(outputFile, compressed)
fs.mkdirSync(path.dirname(rawOutputFile), { recursive: true })
fs.writeFileSync(rawOutputFile, encoded)

console.log(JSON.stringify({
    status: 'PASS',
    dungeonCharacterId: payload.dungeonCharacterId,
    modelKey: payload.modelKey,
    actions: clips.map(clip => ({
        id: clip.actionId,
        semantic: clip.semantic,
        sourceClipPathId: clip.sourceClipPathId,
        runtimeName: clip.runtimeName,
        durationSeconds: clip.duration,
        trackCount: clip.tracks.length,
    })),
    referencedNodePathCount: payload.compatibility.referencedNodePathCount,
    jsonBytes: encoded.length,
    gzipBytes: compressed.length,
    output: path.resolve(outputFile),
    rawOutput: path.resolve(rawOutputFile),
}, null, 2))
