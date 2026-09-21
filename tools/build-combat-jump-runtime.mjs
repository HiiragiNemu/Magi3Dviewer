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

const [inputFile, outputFile, metadataFile, rawOutputFile, summaryFile] = process.argv.slice(2)
if (!inputFile || !outputFile || !metadataFile || !rawOutputFile || !summaryFile) {
    throw new Error(
        'Usage: node build-combat-jump-runtime.mjs INPUT.fbx OUTPUT.json.gz METADATA.json RAW.json SUMMARY.json',
    )
}

const source = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
if (source.schema !== 'magius.combat-jump-export.v1') {
    throw new Error('Combat/jump export metadata schema mismatch')
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
const objectByPath = new Map()
root.traverse(object => {
    const value = objectPath(object)
    objectPaths.set(object.uuid, value)
    objectByPath.set(value, object)
})

const modelRoots = []
root.traverse(object => {
    if (object.name === source.modelRootName) modelRoots.push(object)
})
if (modelRoots.length !== 1) {
    throw new Error(`Expected exactly one model root ${source.modelRootName}; found ${modelRoots.length}`)
}
const modelRoot = modelRoots[0]
const modelRootPath = objectPath(modelRoot)

function ordinalBinding(object) {
    const reversed = []
    for (let current = object; current && current !== modelRoot; current = current.parent) {
        const parent = current.parent
        if (!parent) throw new Error(`Animation target ${object.name} is outside ${source.modelRootName}`)
        const childIndex = parent.children.indexOf(current)
        if (childIndex < 0) throw new Error(`Animation target ${object.name} has no parent child index`)
        reversed.push({ childIndex, name: current.name })
    }
    if (object !== modelRoot && !objectPath(object).startsWith(`${modelRootPath}/`)) {
        throw new Error(`Animation target ${object.name} is outside exact combat model root`)
    }
    return reversed.reverse()
}

function restoreSnapshot(snapshot) {
    for (const [object, value] of snapshot) {
        object.position.fromArray(value.position)
        object.quaternion.fromArray(value.quaternion)
        object.scale.fromArray(value.scale)
    }
    root.updateMatrixWorld(true)
}

const restSnapshot = []
root.traverse(object => {
    restSnapshot.push([
        object,
        {
            position: object.position.toArray(),
            quaternion: object.quaternion.toArray(),
            scale: object.scale.toArray(),
        },
    ])
})

function findExactSuffix(suffix) {
    const matches = []
    modelRoot.traverse(object => {
        const candidate = objectPath(object)
        if (candidate.endsWith(suffix)) matches.push(object)
    })
    return matches.length === 1 ? matches[0] : null
}

const keyBones = {
    hip: findExactSuffix('/Root/Hip'),
    footL: findExactSuffix('/Foot_L'),
    footR: findExactSuffix('/Foot_R'),
    toeL: findExactSuffix('/Toe_L'),
    toeR: findExactSuffix('/Toe_R'),
}

function sampleWorldCurves(clip) {
    if (!keyBones.hip || !keyBones.footL || !keyBones.footR) {
        return {
            status: 'typed BLANK',
            reason: 'exact Hip/Foot_L/Foot_R paths are not unique in converted rig',
            samples: [],
        }
    }
    restoreSnapshot(restSnapshot)
    const mixer = new THREE.AnimationMixer(root)
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset().play()
    const sourceRate = Number.isFinite(clip.userData?.sourceSampleRate)
        ? clip.userData.sourceSampleRate
        : 60
    const sampleCount = Math.max(3, Math.min(900, Math.ceil(clip.duration * sourceRate) + 1))
    const positions = Object.fromEntries(
        Object.entries(keyBones).map(([key]) => [key, new THREE.Vector3()]),
    )
    const samples = []
    for (let index = 0; index < sampleCount; index++) {
        const time = clip.duration * index / (sampleCount - 1)
        mixer.setTime(time)
        root.updateMatrixWorld(true)
        const row = { time }
        for (const [key, object] of Object.entries(keyBones)) {
            if (!object) continue
            object.getWorldPosition(positions[key])
            row[key] = positions[key].toArray()
        }
        samples.push(row)
    }
    action.stop()
    mixer.uncacheRoot(root)
    restoreSnapshot(restSnapshot)
    return { status: 'exact', samples }
}

function contiguousRanges(flags) {
    const ranges = []
    let start = null
    for (let index = 0; index <= flags.length; index++) {
        if (index < flags.length && flags[index]) {
            if (start === null) start = index
        } else if (start !== null) {
            ranges.push([start, index - 1])
            start = null
        }
    }
    return ranges
}

function analyzeJumpDonor(component, clip) {
    const sampled = sampleWorldCurves(clip)
    if (sampled.status !== 'exact') {
        return { grade: 'C', reason: sampled.reason, evidence: sampled }
    }
    const samples = sampled.samples
    const head = Math.max(2, Math.floor(samples.length * 0.15))
    const tail = Math.max(2, Math.floor(samples.length * 0.15))
    const endpoint = [...samples.slice(0, head), ...samples.slice(-tail)]
    const ground = Math.min(...endpoint.flatMap(row => [row.footL[1], row.footR[1]]))
    const endpointHip = endpoint.reduce((sum, row) => sum + row.hip[1], 0) / endpoint.length
    const restFoot = (samples[0].footL[1] + samples[0].footR[1]) / 2
    const legLength = Math.max(0.001, samples[0].hip[1] - restFoot)
    const liftThreshold = Math.max(0.012, legLength * 0.045)
    const contactThreshold = Math.max(0.006, legLength * 0.018)
    const bothLift = samples.map(row => Math.min(row.footL[1], row.footR[1]) - ground)
    const hipRise = samples.map(row => row.hip[1] - endpointHip)
    const flags = bothLift.map((lift, index) => lift >= liftThreshold && hipRise[index] >= legLength * 0.035)
    const minimumFrames = Math.max(3, Math.ceil(0.12 * (samples.length - 1) / Math.max(clip.duration, 1e-6)))
    const ranges = contiguousRanges(flags).filter(([start, end]) => end - start + 1 >= minimumFrames)
    const maximumBothFootLift = Math.max(...bothLift)
    const maximumHipRise = Math.max(...hipRise)
    const evidence = {
        status: 'exact',
        sampleCount: samples.length,
        legLength,
        ground,
        liftThreshold,
        contactThreshold,
        maximumBothFootLift,
        maximumHipRise,
        candidateRanges: ranges.map(([start, end]) => ({
            startSeconds: samples[start].time,
            endSeconds: samples[end].time,
        })),
    }
    if (ranges.length === 0 || maximumBothFootLift < legLength * 0.055) {
        return { grade: 'C', reason: 'no bounded simultaneous-foot airborne interval', evidence }
    }
    const [startIndex, endIndex] = ranges.reduce((best, value) => {
        const bestLift = Math.max(...bothLift.slice(best[0], best[1] + 1))
        const valueLift = Math.max(...bothLift.slice(value[0], value[1] + 1))
        return valueLift > bestLift ? value : best
    })
    const hasBeforeContact = samples
        .slice(0, startIndex + 1)
        .some(row => Math.min(row.footL[1], row.footR[1]) - ground <= contactThreshold)
    const hasAfterContact = samples
        .slice(endIndex)
        .some(row => Math.min(row.footL[1], row.footR[1]) - ground <= contactThreshold)
    const frame = clip.duration / Math.max(1, samples.length - 1)
    const airborneStart = samples[startIndex].time
    const airborneEnd = Math.min(clip.duration, samples[endIndex].time + frame)
    const takeoffStart = Math.max(0, airborneStart - Math.max(0.12, frame * 4))
    const landEnd = Math.min(clip.duration, airborneEnd + Math.max(0.12, frame * 4))
    const gradeA = hasBeforeContact
        && hasAfterContact
        && maximumHipRise >= legLength * 0.06
        && airborneStart - takeoffStart >= frame
        && landEnd - airborneEnd >= frame
    if (gradeA) {
        return {
            grade: 'A',
            reason: null,
            evidence: { ...evidence, hasBeforeContact, hasAfterContact },
            segments: [
                { phase: 'takeoff', sourceStartSeconds: takeoffStart, sourceEndSeconds: airborneStart },
                { phase: 'airborne', sourceStartSeconds: airborneStart, sourceEndSeconds: airborneEnd },
                { phase: 'land', sourceStartSeconds: airborneEnd, sourceEndSeconds: landEnd },
            ],
        }
    }
    const peakIndex = bothLift.indexOf(maximumBothFootLift)
    const peakTime = samples[peakIndex].time
    const half = Math.max(frame * 3, Math.min(0.12, clip.duration / 10))
    const starts = [
        Math.max(0, peakTime - half * 2),
        Math.max(0, peakTime - half / 2),
        Math.min(Math.max(0, clip.duration - frame), peakTime + half / 2),
    ]
    const ends = [
        Math.max(frame, peakTime - half / 2),
        Math.min(clip.duration, peakTime + half / 2),
        Math.min(clip.duration, peakTime + half * 2),
    ]
    if (ends.some((end, index) => end <= starts[index] + frame / 2)) {
        return {
            grade: 'C',
            reason: 'airborne pose exists but three positive bounded windows do not fit source clip',
            evidence: { ...evidence, hasBeforeContact, hasAfterContact },
        }
    }
    return {
        grade: 'B',
        reason: 'pose-only donor; complete takeoff/contact evidence is absent',
        evidence: { ...evidence, hasBeforeContact, hasAfterContact },
        segments: [
            { phase: 'takeoff', sourceStartSeconds: starts[0], sourceEndSeconds: ends[0] },
            { phase: 'airborne', sourceStartSeconds: starts[1], sourceEndSeconds: ends[1] },
            { phase: 'land', sourceStartSeconds: starts[2], sourceEndSeconds: ends[2] },
        ],
    }
}

const allNodePaths = {}
const allNodeBindings = {}
const runtimeClips = []
const componentRuntime = []
const jumpCandidates = []

for (const component of source.components) {
    const matches = root.animations.filter(clip => clip.name === component.importedName)
    if (matches.length !== 1) {
        throw new Error(
            `Expected exactly one converted clip ${component.importedName}; found ${matches.length}`,
        )
    }
    const converted = matches[0].clone()
    converted.name = component.runtimeName
    converted.userData = { sourceSampleRate: component.sampleRate }
    const serialized = THREE.AnimationClip.toJSON(converted)
    const referencedIds = new Set(serialized.tracks.map(track => track.name.split('.')[0]))
    for (const id of referencedIds) {
        const resolved = objectPaths.get(id)
        if (!resolved) throw new Error(`Animation target ${id} has no FBX node path`)
        const target = root.getObjectByProperty('uuid', id)
        if (!target) throw new Error(`Animation target ${id} has no FBX object`)
        allNodePaths[id] = resolved
        allNodeBindings[id] = {
            sourcePath: resolved,
            ordinalPath: ordinalBinding(target),
        }
    }
    runtimeClips.push({
        ...serialized,
        actionId: component.actionId,
        role: component.role,
        sequencePhase: component.sequencePhase,
        sourceBundleLogicalKey: component.bundleLogicalKey,
        sourceClipPathId: component.pathId,
        sourceName: component.name,
        sourceDurationSeconds: component.durationSeconds,
        sourceSampleRate: component.sampleRate,
        sourceGenericBindings: component.genericBindings,
        runtimeName: component.runtimeName,
    })
    componentRuntime.push({
        actionId: component.actionId,
        role: component.role,
        sequencePhase: component.sequencePhase,
        sourceClipPathId: component.pathId,
        runtimeName: component.runtimeName,
        serializedTrackCount: serialized.tracks.length,
    })
    if (component.role === 'body') {
        const donor = analyzeJumpDonor(component, converted)
        jumpCandidates.push({
            actionId: component.actionId,
            characterId: source.characterId,
            styleMstId: component.styleMstId,
            semantic: component.semantic,
            skillUniqueId: component.skillUniqueId,
            skillMstId: component.skillMstId,
            directionName: component.directionName,
            sourceClip: {
                name: component.runtimeName,
                sourceName: component.name,
                pathId: component.pathId,
                durationSeconds: component.durationSeconds,
                sampleRate: component.sampleRate,
            },
            sequencePhase: component.sequencePhase,
            ...donor,
        })
    }
}

const payload = {
    schema: 'magius.combat-jump-action-runtime.v1',
    characterId: source.characterId,
    characterMstId: source.characterMstId,
    modelKey: source.modelKey,
    modelRootName: source.modelRootName,
    sourceModelBundle: source.sourceModelBundle,
    rigFingerprint: source.rigFingerprint,
    rootPolicy: 'controlled-viewer-root;suppress-body-Root.position;preserve-exact-skeleton-curves',
    compatibility: {
        mode: 'exact-model-only',
        exactModelKey: source.modelKey,
        exactModelRootName: source.modelRootName,
        rigFingerprint: source.rigFingerprint,
        referencedNodePathCount: Object.keys(allNodePaths).length,
    },
    clips: runtimeClips,
    components: componentRuntime,
    jumpCandidates,
    nodePaths: allNodePaths,
    nodeBindings: allNodeBindings,
}

const encoded = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8')
const compressed = zlib.gzipSync(encoded, { level: 9 })
fs.mkdirSync(path.dirname(outputFile), { recursive: true })
fs.writeFileSync(outputFile, compressed)
fs.mkdirSync(path.dirname(rawOutputFile), { recursive: true })
fs.writeFileSync(rawOutputFile, encoded)
const summary = {
    status: 'PASS',
    characterId: source.characterId,
    modelKey: source.modelKey,
    rigFingerprint: source.rigFingerprint,
    clipCount: runtimeClips.length,
    componentCount: componentRuntime.length,
    referencedNodePathCount: payload.compatibility.referencedNodePathCount,
    jumpCandidates: jumpCandidates.map(candidate => ({
        actionId: candidate.actionId,
        sourceClip: candidate.sourceClip,
        grade: candidate.grade,
        reason: candidate.reason,
        segments: candidate.segments ?? [],
        evidence: candidate.evidence,
    })),
    jsonBytes: encoded.length,
    gzipBytes: compressed.length,
    output: path.resolve(outputFile),
    rawOutput: path.resolve(rawOutputFile),
}
fs.mkdirSync(path.dirname(summaryFile), { recursive: true })
fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(summary, null, 2))
