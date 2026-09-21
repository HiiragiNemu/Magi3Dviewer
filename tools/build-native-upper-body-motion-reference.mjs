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

const [outputFile, ...requestedIds] = process.argv.slice(2)
if (!outputFile || requestedIds.length === 0) {
    throw new Error(
        'Usage: node build-native-upper-body-motion-reference.mjs OUTPUT.json CHARACTER_ID [...]',
    )
}

const repoRoot = process.cwd()
const sampleRate = 60
const semanticOrder = ['walk', 'run']
const normalizedBodyReferenceFile = path.join(
    repoRoot,
    'src/viewer/normalizedHumanoidMotionReference.generated.json',
)
const normalizedBodyReference = JSON.parse(fs.readFileSync(normalizedBodyReferenceFile, 'utf8'))

function hierarchyPath(object) {
    const names = []
    for (let current = object; current; current = current.parent) names.unshift(current.name || '<root>')
    return names.join('/')
}

function canonicalRigPath(sourcePath) {
    const rootIndex = sourcePath.indexOf('/Root/')
    if (rootIndex >= 0) return sourcePath.slice(rootIndex + 1)
    if (sourcePath.endsWith('/Root')) return 'Root'
    return null
}

function isHandRotationPath(rigPath) {
    return /(?:^|\/)Hand_[LR](?:\/|$)/.test(rigPath)
        && !/(?:Weapon|Armor|Sleeve|Skirt|Hair|Ribbon|Cloth|Collider|Eff|Vfx)/i.test(rigPath)
}

function round(value) {
    return Math.round(value * 1e7) / 1e7
}

function roundedQuaternion(value) {
    return value.toArray().map(round)
}

function quaternionAngleDegrees(value) {
    return THREE.MathUtils.radToDeg(2 * Math.acos(THREE.MathUtils.clamp(Math.abs(value.w), -1, 1)))
}

function parseGzipJson(file) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'))
}

function parseGzipFbx(file) {
    const bytes = zlib.gunzipSync(fs.readFileSync(file))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    return new FBXLoader().parse(buffer, '')
}

function buildDonor(characterId) {
    const runtimeFile = path.join(
        repoRoot,
        'public/character-actions/native-dungeon',
        characterId,
        'runtime.v1.json.gz',
    )
    const modelFile = path.join(
        repoRoot,
        'magia-exedra-character-three/models',
        `chara_${characterId}_battle_unit`,
        'VisualRoot.fbx.gz',
    )
    if (!fs.existsSync(runtimeFile) || !fs.existsSync(modelFile)) {
        return {
            characterId: Number(characterId),
            status: 'source-unavailable',
            reason: !fs.existsSync(runtimeFile)
                ? 'native Dungeon runtime carrier is absent'
                : 'exact donor model carrier is absent',
        }
    }

    const runtime = parseGzipJson(runtimeFile)
    const root = parseGzipFbx(modelFile)
    const modelRoots = []
    root.traverse(object => {
        if (object.name === runtime.modelRootName) modelRoots.push(object)
    })
    if (modelRoots.length !== 1) {
        throw new Error(`Expected one ${runtime.modelRootName}; found ${modelRoots.length}`)
    }
    const modelRoot = modelRoots[0]
    const targetByRigPath = new Map()
    modelRoot.traverse(object => {
        const rigPath = canonicalRigPath(hierarchyPath(object))
        if (!rigPath) return
        if (targetByRigPath.has(rigPath)) {
            throw new Error(`Ambiguous exact donor rig path ${characterId}:${rigPath}`)
        }
        targetByRigPath.set(rigPath, object)
    })

    const clips = {}
    for (const semantic of semanticOrder) {
        const source = runtime.clips.find(candidate => candidate.semantic === semantic)
        if (!source) throw new Error(`Missing ${semantic} native clip for ${characterId}`)
        const normalizedDonor = normalizedBodyReference.donors.find(
            candidate => String(candidate.characterId) === String(characterId),
        )
        const normalizedClip = normalizedDonor?.clips?.[semantic]
        if (!normalizedClip) throw new Error(`Missing normalized ${semantic} clip for ${characterId}`)

        const quaternionTracks = new Map()
        for (const serialized of source.tracks) {
            if (serialized.type !== 'quaternion' || !serialized.name.endsWith('.quaternion')) continue
            const uuid = serialized.name.slice(0, -'.quaternion'.length)
            const rigPath = canonicalRigPath(runtime.nodePaths[uuid] ?? '')
            if (!rigPath || !isHandRotationPath(rigPath)) continue
            const target = targetByRigPath.get(rigPath)
            if (!target) throw new Error(`Exact donor rest bone missing for ${characterId}:${rigPath}`)
            quaternionTracks.set(rigPath, {
                target,
                interpolant: new THREE.QuaternionKeyframeTrack(
                    rigPath,
                    serialized.times,
                    serialized.values,
                ).createInterpolant(),
            })
        }
        const frameCount = normalizedClip.frameCount
        const maximumRotationByRigPath = Object.fromEntries(
            [...quaternionTracks.keys()].map(rigPath => [rigPath, 0]),
        )
        const maximumTemporalRotationByRigPath = Object.fromEntries(
            [...quaternionTracks.keys()].map(rigPath => [rigPath, 0]),
        )
        const firstDeltaByRigPath = new Map()
        const frames = []
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            const sourceTime = Math.min(
                source.duration - (1 / sampleRate),
                frameIndex / sampleRate,
            )
            const localRotationDeltas = {}
            for (const [rigPath, binding] of quaternionTracks) {
                const sampled = new THREE.Quaternion().fromArray(binding.interpolant.evaluate(sourceTime)).normalize()
                const delta = binding.target.quaternion.clone().invert().multiply(sampled).normalize()
                if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
                localRotationDeltas[rigPath] = roundedQuaternion(delta)
                const firstDelta = firstDeltaByRigPath.get(rigPath)
                if (firstDelta) {
                    const temporalDelta = firstDelta.clone().invert().multiply(delta).normalize()
                    maximumTemporalRotationByRigPath[rigPath] = Math.max(
                        maximumTemporalRotationByRigPath[rigPath],
                        quaternionAngleDegrees(temporalDelta),
                    )
                } else {
                    firstDeltaByRigPath.set(rigPath, delta.clone())
                }
                maximumRotationByRigPath[rigPath] = Math.max(
                    maximumRotationByRigPath[rigPath],
                    quaternionAngleDegrees(delta),
                )
            }
            frames.push({
                phase: round(frameIndex / frameCount),
                localRotationDeltas,
            })
        }
        const fingerPaths = [...quaternionTracks.keys()].filter(
            rigPath => !/\/Hand_[LR]$/.test(rigPath),
        )
        clips[semantic] = {
            sourceName: source.sourceName,
            sourceClipPathId: source.sourceClipPathId,
            durationSeconds: source.duration,
            sampleRate,
            frameCount,
            frames,
            diagnostics: {
                handRotationPaths: [...quaternionTracks.keys()].filter(
                    rigPath => /\/Hand_[LR]$/.test(rigPath),
                ).length,
                fingerRotationPaths: fingerPaths.length,
                dynamicFingerRotationPaths: fingerPaths.filter(
                    rigPath => maximumTemporalRotationByRigPath[rigPath] > 0.5,
                ).length,
                maximumFingerRestRelativeRotationDegrees: round(Math.max(
                    0,
                    ...fingerPaths.map(rigPath => maximumRotationByRigPath[rigPath]),
                )),
                maximumFingerTemporalRotationDegrees: round(Math.max(
                    0,
                    ...fingerPaths.map(rigPath => maximumTemporalRotationByRigPath[rigPath]),
                )),
                maximumRotationByRigPath: Object.fromEntries(
                    Object.entries(maximumRotationByRigPath).map(([rigPath, value]) => [rigPath, round(value)]),
                ),
                maximumTemporalRotationByRigPath: Object.fromEntries(
                    Object.entries(maximumTemporalRotationByRigPath)
                        .map(([rigPath, value]) => [rigPath, round(value)]),
                ),
            },
        }
    }
    return {
        characterId: Number(characterId),
        status: 'attached',
        modelKey: runtime.modelKey,
        modelRootName: runtime.modelRootName,
        rigCompatibility: runtime.compatibility,
        sourceAnimationBundle: runtime.sourceAnimationBundle,
        clips,
    }
}

const donors = requestedIds.map(buildDonor)
const payload = {
    schema: 'magius.native-upper-body-motion-reference.v1',
    generatedAt: new Date().toISOString(),
    sampleRate,
    coordinateConvention: 'donor local quaternion delta from exact FBX rest; target applies delta after its own inverse-bind rest quaternion',
    transferPolicy: 'rest-relative-local-rotation-retarget;target-rig-rest-axes;never-bind-donor-track-or-uuid-to-target-rig',
    profiles: {
        '101901-natural-arms-fingers-v14': {
            label: '111501 natural low arm/finger motion with 100301 dress-clearance support',
            weights: { 111501: 0.72, 100301: 0.28 },
            lowerBodyPolicy: 'preserve accepted Set A 100102+100301 leg/foot trajectory',
            clearancePolicy: 'minimum target-skirt wrist correction only',
        },
    },
    donors,
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true })
fs.writeFileSync(outputFile, `${JSON.stringify(payload)}\n`, 'utf8')
console.log(JSON.stringify({
    status: 'generated',
    output: path.resolve(outputFile),
    donors: donors.map(donor => ({
        characterId: donor.characterId,
        status: donor.status,
        walkDynamicFingers: donor.clips?.walk?.diagnostics?.dynamicFingerRotationPaths ?? 0,
        runDynamicFingers: donor.clips?.run?.diagnostics?.dynamicFingerRotationPaths ?? 0,
    })),
}, null, 2))
