import fs from 'node:fs'
import path from 'node:path'
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

const [outputFile, ...donorArguments] = process.argv.slice(2)
if (!outputFile || donorArguments.length < 4 || donorArguments.length % 2 !== 0) {
    throw new Error(
        'Usage: node build-humanoid-motion-reference.mjs OUTPUT.json DONOR.fbx DONOR-metadata.json [...]',
    )
}

const sampleRate = 60
const semanticOrder = ['idle', 'walk', 'run']
const rolePaths = {
    hip: 'Root/Hip',
    spine: 'Root/Hip/Spine',
    waist: 'Root/Hip/Spine/Waist',
    chest: 'Root/Hip/Spine/Waist/Chest',
    neck: 'Root/Hip/Spine/Waist/Chest/Neck',
    head: 'Root/Hip/Spine/Waist/Chest/Neck/Head',
    shoulderL: 'Root/Hip/Spine/Waist/Chest/Shoulder_L',
    upperArmL: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L',
    forearmL: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L',
    handL: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Hand_L',
    shoulderR: 'Root/Hip/Spine/Waist/Chest/Shoulder_R',
    upperArmR: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R',
    forearmR: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R',
    handR: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Hand_R',
    upperLegL: 'Root/Hip/UpLeg_L',
    lowerLegL: 'Root/Hip/UpLeg_L/Leg_L',
    footL: 'Root/Hip/UpLeg_L/Leg_L/Foot_L',
    toeL: 'Root/Hip/UpLeg_L/Leg_L/Foot_L/Toe_L',
    upperLegR: 'Root/Hip/UpLeg_R',
    lowerLegR: 'Root/Hip/UpLeg_R/Leg_R',
    footR: 'Root/Hip/UpLeg_R/Leg_R/Foot_R',
    toeR: 'Root/Hip/UpLeg_R/Leg_R/Foot_R/Toe_R',
}

const directionSegments = {
    spine: ['spine', 'waist'],
    waist: ['waist', 'chest'],
    chest: ['chest', 'neck'],
    neck: ['neck', 'head'],
    shoulderL: ['shoulderL', 'upperArmL'],
    upperArmL: ['upperArmL', 'forearmL'],
    forearmL: ['forearmL', 'handL'],
    shoulderR: ['shoulderR', 'upperArmR'],
    upperArmR: ['upperArmR', 'forearmR'],
    forearmR: ['forearmR', 'handR'],
    upperLegL: ['upperLegL', 'lowerLegL'],
    lowerLegL: ['lowerLegL', 'footL'],
    footL: ['footL', 'toeL'],
    upperLegR: ['upperLegR', 'lowerLegR'],
    lowerLegR: ['lowerLegR', 'footR'],
    footR: ['footR', 'toeR'],
}

function hierarchyPath(object) {
    const names = []
    for (let current = object; current; current = current.parent) names.unshift(current.name || '<root>')
    return names.join('/')
}

function round(value) {
    return Math.round(value * 1e7) / 1e7
}

function roundedVector(vector) {
    return vector.toArray().map(round)
}

function requireUniqueBySuffix(root, suffix) {
    const matches = []
    root.traverse(object => {
        if (hierarchyPath(object).endsWith(`/${suffix}`)) matches.push(object)
    })
    if (matches.length !== 1) {
        throw new Error(`Expected one donor object ending in ${suffix}; found ${matches.length}`)
    }
    return matches[0]
}

function restoreTransforms(snapshot) {
    for (const [object, transform] of snapshot) {
        object.position.copy(transform.position)
        object.quaternion.copy(transform.quaternion)
        object.scale.copy(transform.scale)
    }
}

function localPosition(object, inverseModelWorld) {
    return object.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseModelWorld)
}

function modelLocalQuaternion(object, inverseModelWorldQuaternion) {
    return inverseModelWorldQuaternion.clone()
        .multiply(object.getWorldQuaternion(new THREE.Quaternion()))
        .normalize()
}

function range(values) {
    return Math.max(...values) - Math.min(...values)
}

function buildDonor(fbxFile, metadataFile) {
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
    const bytes = fs.readFileSync(fbxFile)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const root = new FBXLoader().parse(buffer, '')
    const modelRoots = []
    root.traverse(object => {
        if (object.name === metadata.modelRootName) modelRoots.push(object)
    })
    if (modelRoots.length !== 1) {
        throw new Error(`Expected one ${metadata.modelRootName}; found ${modelRoots.length}`)
    }
    const modelRoot = modelRoots[0]
    const roles = Object.fromEntries(
        Object.entries(rolePaths).map(([role, suffix]) => [role, requireUniqueBySuffix(modelRoot, suffix)]),
    )
    const originalTransforms = new Map()
    root.traverse(object => originalTransforms.set(object, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
    }))
    root.updateMatrixWorld(true)
    const inverseModelWorld = modelRoot.matrixWorld.clone().invert()
    const inverseModelWorldQuaternion = modelRoot.getWorldQuaternion(new THREE.Quaternion()).invert()
    const segmentLength = (from, to) => localPosition(roles[to], inverseModelWorld)
        .distanceTo(localPosition(roles[from], inverseModelWorld))
    const dimensions = {
        legLengthMeters: (
            segmentLength('upperLegL', 'lowerLegL')
            + segmentLength('lowerLegL', 'footL')
            + segmentLength('upperLegR', 'lowerLegR')
            + segmentLength('lowerLegR', 'footR')
        ) / 2,
        armLengthMeters: (
            segmentLength('upperArmL', 'forearmL')
            + segmentLength('forearmL', 'handL')
            + segmentLength('upperArmR', 'forearmR')
            + segmentLength('forearmR', 'handR')
        ) / 2,
        shoulderWidthMeters: segmentLength('upperArmL', 'upperArmR'),
        hipWidthMeters: segmentLength('upperLegL', 'upperLegR'),
    }

    const neutralDescriptor = metadata.clips.find(clip => clip.semantic === 'idle')
    const neutralClip = root.animations.find(clip => clip.name === neutralDescriptor.sourceName)
    if (!neutralClip) throw new Error(`Neutral donor clip missing for ${metadata.dungeonCharacterId}`)
    restoreTransforms(originalTransforms)
    const neutralMixer = new THREE.AnimationMixer(root)
    neutralMixer.clipAction(neutralClip).play()
    neutralMixer.setTime(0)
    root.updateMatrixWorld(true)
    const neutralHipQuaternion = modelLocalQuaternion(roles.hip, inverseModelWorldQuaternion)
    neutralMixer.stopAllAction()

    const clips = {}
    for (const semantic of semanticOrder) {
        const descriptor = metadata.clips.find(clip => clip.semantic === semantic)
        if (!descriptor) throw new Error(`Missing ${semantic} descriptor for ${metadata.dungeonCharacterId}`)
        const matches = root.animations.filter(clip => clip.name === descriptor.sourceName)
        if (matches.length !== 1) {
            throw new Error(`Expected one ${descriptor.sourceName}; found ${matches.length}`)
        }
        restoreTransforms(originalTransforms)
        const mixer = new THREE.AnimationMixer(root)
        const action = mixer.clipAction(matches[0])
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.play()
        const frameCount = Math.max(1, Math.round(descriptor.durationSeconds * sampleRate))
        const frames = []
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            const timeSeconds = frameIndex / sampleRate
            mixer.setTime(timeSeconds)
            root.updateMatrixWorld(true)
            const points = Object.fromEntries(
                Object.entries(roles).map(([role, object]) => [role, localPosition(object, inverseModelWorld)]),
            )
            const hipQuaternion = modelLocalQuaternion(roles.hip, inverseModelWorldQuaternion)
            const hipDelta = hipQuaternion.clone().multiply(neutralHipQuaternion.clone().invert()).normalize()
            const hipEuler = new THREE.Euler().setFromQuaternion(hipDelta, 'YXZ')
            const directions = Object.fromEntries(Object.entries(directionSegments).map(([role, pair]) => {
                const direction = points[pair[1]].clone().sub(points[pair[0]]).normalize()
                return [role, roundedVector(direction)]
            }))
            frames.push({
                phase: round(frameIndex / frameCount),
                hip: {
                    position: roundedVector(points.hip.clone().multiplyScalar(1 / dimensions.legLengthMeters)),
                    rotationDeltaYXZ: [round(hipEuler.x), round(hipEuler.y), round(hipEuler.z)],
                },
                joints: Object.fromEntries([
                    'handL', 'handR', 'forearmL', 'forearmR',
                    'footL', 'footR', 'lowerLegL', 'lowerLegR', 'toeL', 'toeR',
                ].map(role => [role, roundedVector(points[role].clone().multiplyScalar(1 / dimensions.legLengthMeters))])),
                directions,
            })
        }
        mixer.stopAllAction()
        const meanHip = new THREE.Vector3()
        for (const frame of frames) meanHip.add(new THREE.Vector3().fromArray(frame.hip.position))
        meanHip.multiplyScalar(1 / frames.length)
        for (const frame of frames) {
            frame.hip.position = roundedVector(new THREE.Vector3().fromArray(frame.hip.position).sub(meanHip))
        }
        const footForward = ['footL', 'footR'].flatMap(role => frames.map(frame => frame.joints[role][2]))
        const handLateral = ['handL', 'handR'].flatMap(role => frames.map(frame => frame.joints[role][0]))
        clips[semantic] = {
            sourceName: descriptor.sourceName,
            sourceClipPathId: descriptor.sourceClipPathId,
            durationSeconds: descriptor.durationSeconds,
            sampleRate,
            frameCount,
            normalizedFootForwardSpan: round(range(footForward)),
            normalizedHandLateralSpan: round(range(handLateral)),
            frames,
        }
    }
    return {
        characterId: metadata.dungeonCharacterId,
        modelKey: metadata.modelKey,
        sourceModelBundle: metadata.sourceModelBundle,
        sourceAnimationBundle: metadata.sourceAnimationBundle,
        dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, round(value)])),
        neutralIdlePathId: neutralDescriptor.sourceClipPathId,
        clips,
    }
}

const donors = []
for (let index = 0; index < donorArguments.length; index += 2) {
    donors.push(buildDonor(donorArguments[index], donorArguments[index + 1]))
}
const donorIds = donors.map(donor => donor.characterId)
if (!donorIds.includes(100102) || !donorIds.includes(100301)) {
    throw new Error('Motion reference requires exact 100102 and 100301 donors')
}

const payload = {
    schema: 'magius.normalized-humanoid-motion-reference.v1',
    generatedAt: new Date().toISOString(),
    sampleRate,
    coordinateConvention: 'donor-model-local xyz; unit segment directions; hip and joint positions normalized by donor leg length',
    transferPolicy: 'normalized-trajectory-only;target-rig-segment-direction-solve;never-bind-donor-track-to-target-rig',
    blendWeights: { 100102: 0.5, 100301: 0.5 },
    dynamicEvidence: {
        madokaRootTrajectory: 'artifacts/runtime/20260824-tw-dungeon-100102-1-4-full-run/kinematic-summary.json',
        mamiRootTrajectory: 'artifacts/runtime/20260824-tw-mami-100301-dungeon-6001101-character-actions/resource-static-dynamic-authority.json',
        mamiVideo: 'C:/Users/proje/Videos/魔法少女小圓 Magia Exedra(11).mp4',
    },
    donors,
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true })
fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
    status: 'PASS',
    output: path.resolve(outputFile),
    donorIds,
    clips: Object.fromEntries(donors.map(donor => [
        donor.characterId,
        Object.fromEntries(Object.entries(donor.clips).map(([semantic, clip]) => [semantic, {
            durationSeconds: clip.durationSeconds,
            frameCount: clip.frameCount,
            normalizedFootForwardSpan: clip.normalizedFootForwardSpan,
            normalizedHandLateralSpan: clip.normalizedHandLateralSpan,
        }])),
    ])),
}, null, 2))
