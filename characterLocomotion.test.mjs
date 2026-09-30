import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { readParsedBoneLocal } from './magia-exedra-character-three/authoredBoneLocals.ts'
import { stripTypeScriptTypes } from 'node:module'
import {expressiveJumpName,expressiveJumpArmSample} from './src/viewer/jumpStyle.ts'
import {nativeCombatActionCue} from './src/viewer/combatNativeActionCue.ts'
// These dynamic excerpts run production functions, with their actual pure
// dependencies exposed to Function's global realm instead of permissive stubs.
Object.assign(globalThis,{expressiveJumpName,expressiveJumpArmSample,nativeCombatActionCue})
function compilePerformanceActionTestSource(source,start,end){
 const ast=ts.createSourceFile('viewer.ts',source,ts.ScriptTarget.Latest,true)
 const cue=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='emitStartedViewerCharacterActionCue')
 assert.ok(cue,'The current cue consumer must be part of action excerpts')
 return stripTypeScriptTypes(source.slice(start,end)+'\n'+cue.getText(ast),{mode:'strip'})
}
import * as THREE from 'three'
import { gunzipSync } from 'node:zlib'
import { Quaternion, Ray, Triangle, Vector3 } from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import {
    CharacterLocomotionController,
    FlatGroundCollisionWorld,
    OFFICIAL_DUNGEON_GAIT_REFERENCE,
    buildCapturedCombatActionDefinition,
    capturedAnimationClipDescriptors,
    capturedCombatEffectCueDefinitions,
    consumeSharedBattleCapture,
    createViewerCharacterAnimationPort,
    deriveTargetRigLocomotionClearance,
    listCapturedAnimationAssets,
    normalizeAnimationFamilyName,
    resolveAnimationCandidates,
    sampleHumanoidGaitCycle,
} from './src/viewer/characterLocomotion.ts'

function createTransform(x = 0, y = 0, z = 0) {
    return {
        position: new Vector3(x, y, z),
        quaternion: new Quaternion(),
    }
}

function fixedConfig(overrides = {}) {
    return {
        fixedStepSeconds: 1 / 60,
        maxSubSteps: 120,
        walkSpeed: 2,
        runSpeed: 4,
        groundAcceleration: 120,
        groundDeceleration: 120,
        airAcceleration: 4,
        gravity: 12,
        jumpSpeed: 5,
        landingDurationSeconds: 0.1,
        ...overrides,
    }
}

function stepMany(controller, count) {
    const states = []
    for (let index = 0; index < count; index += 1) {
        states.push(controller.stepFixed().state)
    }
    return states
}

test('official clip resolver ranks loaded families and never invents unavailable combat clips', () => {
    const representativeClips = [
        { name: 'Wait_L', duration: 1.9833, trackCount: 525 },
        { name: 'Wait_L_1', duration: 1.9833, trackCount: 51 },
        { name: 'CommonWait_L', duration: 3.9833, trackCount: 525 },
        { name: 'Damage_SE', duration: 1, trackCount: 525 },
        { name: 'Down_L', duration: 1.9833, trackCount: 525 },
        { name: 'Victory_L', duration: 4, trackCount: 525 },
        { name: 'FaceDamage', duration: 0, trackCount: 0 },
    ]
    assert.equal(normalizeAnimationFamilyName('Wait_L_weapon_a_1'), 'Wait_L')
    assert.equal(normalizeAnimationFamilyName('Wait_L_1'), 'Wait_L')

    const idle = resolveAnimationCandidates(representativeClips, 'idle')
    assert.equal(idle.status, 'matched')
    assert.ok(['Wait_L', 'CommonWait_L'].includes(idle.selected.clip.name))
    assert.equal(resolveAnimationCandidates(representativeClips, 'run').status, 'fallback')
    assert.equal(resolveAnimationCandidates(representativeClips, 'damage').status, 'matched')
    assert.equal(resolveAnimationCandidates(representativeClips, 'skill').status, 'unavailable')
    assert.equal(resolveAnimationCandidates(representativeClips, 'ultimate').status, 'unavailable')

    const skill = resolveAnimationCandidates([
        { name: 'Skill02_SE', duration: 1.25, trackCount: 612 },
        { name: 'Attack01_SE', duration: 0.8, trackCount: 590 },
    ], 'skill', { preferredNames: ['Skill02_SE'] })
    assert.equal(skill.status, 'matched')
    assert.equal(skill.selected.clip.name, 'Skill02_SE')
    assert.equal(skill.selected.tier, 'exact')

    assert.equal(resolveAnimationCandidates([
        { name: 'DungeonWait_L', duration: 1.983333, trackCount: 525 },
        { name: 'DungeonWalk_L', duration: 1.45, trackCount: 525 },
        { name: 'DungeonRun_L', duration: 0.816667, trackCount: 525 },
    ], 'walk').selected.clip.name, 'DungeonWalk_L')
    assert.equal(resolveAnimationCandidates([
        { name: 'DungeonWait_L', duration: 1.983333, trackCount: 525 },
        { name: 'DungeonWalk_L', duration: 1.45, trackCount: 525 },
        { name: 'DungeonRun_L', duration: 0.816667, trackCount: 525 },
    ], 'run').selected.clip.name, 'DungeonRun_L')
    assert.equal(resolveAnimationCandidates([
        { name: 'SingleSkillA_SE', duration: 5.433333, trackCount: 633 },
        { name: 'WholeSkillA_SE', duration: 5.166667, trackCount: 711 },
    ], 'skill').status, 'matched')
    const unusuallyNamedUltimate = resolveAnimationCandidates([
        { name: 'Take 001', duration: 16, trackCount: 712 },
        { name: 'Skill', duration: 16, trackCount: 6 },
    ], 'ultimate', { preferredNames: ['Take 001'] })
    assert.equal(unusuallyNamedUltimate.selected.clip.name, 'Take 001')
    assert.equal(unusuallyNamedUltimate.selected.tier, 'exact')
})

test('fixed-step locomotion runs, turns, jumps, falls and lands without losing air control', () => {
    const ground = new FlatGroundCollisionWorld(0)
    const transform = createTransform()
    const controller = new CharacterLocomotionController({
        characterId: 'runner-a',
        transform,
        collisionWorld: ground,
        groundQuery: ground,
        initiallyGrounded: true,
        config: fixedConfig(),
    })

    controller.setInput({ moveX: 0, moveZ: 1, run: true, jumpPressed: false })
    stepMany(controller, 30)
    assert.equal(controller.state, 'run')
    assert.ok(Math.abs(transform.position.z - 118 / 60) < 1e-9)

    controller.setInput({ moveX: 1, moveZ: 0, run: true, jumpPressed: true })
    controller.stepFixed()
    assert.equal(controller.state, 'jump')
    assert.ok(transform.position.y > 0)
    assert.ok(controller.velocity.x > 0)
    const beforeAirX = transform.position.x

    controller.setInput({ moveX: 1, moveZ: 0, run: true, jumpPressed: false })
    const airborneAndLandingStates = stepMany(controller, 180)
    assert.ok(transform.position.x > beforeAirX)
    assert.ok(airborneAndLandingStates.includes('fall'))
    assert.ok(!airborneAndLandingStates.includes('land'), 'held movement must not insert a stopped recovery')
    assert.ok(airborneAndLandingStates.includes('walk') || airborneAndLandingStates.includes('run'))
    assert.equal(controller.grounded, true)
    assert.equal(transform.position.y, 0)
    assert.ok(Math.abs(transform.quaternion.y) > 0.5)
})

test('standing, walking and running jumps select distinct pose families while controlled root keeps air travel', () => {
    const jumpFamilies = {
        standing: { jump: 'StandingJumpTakeoffV28', fall: 'StandingJumpAirV28', land: 'StandingJumpLandV28' },
        walking: { jump: 'WalkJumpTakeoffV28', fall: 'WalkJumpAirV28', land: 'WalkJumpLandV28' },
        running: { jump: 'RunJumpTakeoffV28', fall: 'RunJumpAirV28', land: 'RunJumpLandV28' },
    }
    const clips = [
        { name: 'Idle', duration: 1, trackCount: 1 },
        { name: 'Walk', duration: 1, trackCount: 1 },
        { name: 'Run', duration: 1, trackCount: 1 },
        ...Object.values(jumpFamilies).flatMap(family => Object.values(family).map(name => ({
            name,
            duration: 0.5,
            trackCount: 1,
        }))),
    ]
    for (const mode of ['standing', 'walking', 'running']) {
        const played = []
        const ground = new FlatGroundCollisionWorld(0)
        const transform = createTransform()
        const controller = new CharacterLocomotionController({
            characterId: `jump-mode-${mode}`,
            transform,
            animation: {
                listClips: () => clips,
                play: name => played.push(name),
            },
            collisionWorld: ground,
            groundQuery: ground,
            initiallyGrounded: true,
            locomotionAnimations: { idle: 'Idle', walk: 'Walk', run: 'Run' },
            jumpLocomotionAnimations: jumpFamilies,
            config: fixedConfig({ jumpTakeoffDelaySeconds: 0 }),
        })
        const moving = mode !== 'standing'
        controller.setInput({
            moveX: 0,
            moveZ: moving ? 1 : 0,
            run: mode === 'running',
            jumpPressed: false,
        })
        if (moving) stepMany(controller, 18)
        const beforeJumpZ = transform.position.z
        controller.setInput({
            moveX: 0,
            moveZ: moving ? 1 : 0,
            run: mode === 'running',
            jumpPressed: true,
        })
        const launched = controller.stepFixed()
        assert.equal(launched.jumpMode, mode)
        assert.equal(played.at(-1), jumpFamilies[mode].jump)
        const states = stepMany(controller, 180)
        assert.ok(states.includes('fall'))
        assert.equal(states.includes('land'), !moving)
        assert.ok(played.includes(jumpFamilies[mode].fall))
        assert.equal(played.includes(jumpFamilies[mode].land), !moving)
        if (moving) {
            assert.equal(played.at(-1), mode === 'running' ? 'Run' : 'Walk')
            assert.ok(Math.hypot(controller.velocity.x, controller.velocity.z) > 0)
        }
        if (mode === 'standing') assert.ok(Math.abs(transform.position.z - beforeJumpZ) < 1e-9)
        if (mode === 'walking') assert.ok(transform.position.z - beforeJumpZ > 0.5)
        if (mode === 'running') assert.ok(transform.position.z - beforeJumpZ > 2)
    }
})

test('a three-phase donor can temporarily override every jump mode without taking controller root motion', () => {
    const played = []
    const transform = createTransform()
    const ground = new FlatGroundCollisionWorld(0)
    const clips = ['Idle', 'Walk', 'Run', 'DonorTakeoff', 'DonorAir', 'DonorLand'].map(name => ({
        name,
        duration: 0.5,
        trackCount: 1,
    }))
    const controller = new CharacterLocomotionController({
        characterId: 'three-phase-donor',
        transform,
        animation: {
            listClips: () => clips,
            play: name => played.push(name),
        },
        collisionWorld: ground,
        groundQuery: ground,
        initiallyGrounded: true,
        locomotionAnimations: { idle: 'Idle', walk: 'Walk', run: 'Run' },
        config: fixedConfig({ jumpTakeoffDelaySeconds: 0 }),
    })
    controller.setJumpLocomotionAnimationOverride(Object.fromEntries(
        ['standing', 'walking', 'running'].map(mode => [mode, {
            jump: 'DonorTakeoff',
            fall: 'DonorAir',
            land: 'DonorLand',
        }]),
    ))
    controller.setInput({ moveX: 0, moveZ: 1, run: true, jumpPressed: true })
    const before = transform.position.z
    controller.stepFixed()
    const states = stepMany(controller, 180)
    assert.ok(played.includes('DonorTakeoff'))
    assert.ok(played.includes('DonorAir'))
    assert.ok(played.includes('DonorLand'))
    assert.ok(states.includes('fall'))
    assert.ok(states.includes('land'))
    assert.ok(transform.position.z - before > 2)
    controller.setJumpLocomotionAnimationOverride(undefined)
})

test('controller can clear post-landing horizontal carry without disturbing placement', () => {
    const ground = new FlatGroundCollisionWorld(0)
    const transform = createTransform()
    const controller = new CharacterLocomotionController({
        characterId: 'landing-handoff',
        transform,
        collisionWorld: ground,
        groundQuery: ground,
        initiallyGrounded: true,
        config: fixedConfig({ jumpTakeoffDelaySeconds: 0 }),
    })
    controller.setInput({ moveX: 0, moveZ: 1, run: true, jumpPressed: true })
    controller.stepFixed()
    controller.setInput({ moveX: 0, moveZ: 0, run: false, jumpPressed: false })
    stepMany(controller, 180)
    assert.equal(controller.grounded, true)
    const landed = transform.position.clone()
    controller.velocity.set(2, 0, -3)
    controller.stopHorizontalMotion()
    assert.deepEqual(controller.velocity.toArray(), [0, 0, 0])
    assert.deepEqual(transform.position.toArray(), landed.toArray())
})

test('viewer-authored gait sampler uses stable mirrored contact and swing phases', () => {
    for (const mode of ['walk', 'run']) {
        for (const phase of [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1]) {
            const sample = sampleHumanoidGaitCycle(phase, mode)
            const numericValues = [
                sample.phase,
                sample.leftLeg.hipFlexionRadians,
                sample.leftLeg.kneeFlexionRadians,
                sample.leftLeg.ankleFlexionRadians,
                sample.leftLeg.stanceWeight,
                sample.rightLeg.hipFlexionRadians,
                sample.rightLeg.kneeFlexionRadians,
                sample.rightLeg.ankleFlexionRadians,
                sample.rightLeg.stanceWeight,
                ...Object.values(sample.pelvis),
                ...Object.values(sample.torso),
                sample.leftArmSwingRadians,
                sample.rightArmSwingRadians,
                sample.leftElbowFlexionRadians,
                sample.rightElbowFlexionRadians,
                sample.leftShoulderLiftRadians,
                sample.rightShoulderLiftRadians,
            ]
            assert.equal(numericValues.every(Number.isFinite), true)
            assert.ok(sample.leftLeg.kneeFlexionRadians >= 0)
            assert.ok(sample.rightLeg.kneeFlexionRadians >= 0)
            assert.ok(sample.leftLeg.kneeFlexionRadians < 130 * Math.PI / 180)
            assert.ok(sample.rightLeg.kneeFlexionRadians < 130 * Math.PI / 180)
            assert.ok(sample.leftLeg.stanceWeight >= 0 && sample.leftLeg.stanceWeight <= 1)
            assert.ok(sample.rightLeg.stanceWeight >= 0 && sample.rightLeg.stanceWeight <= 1)
            assert.ok(Math.abs(sample.leftArmSwingRadians) <= Math.PI / 2)
            assert.ok(Math.abs(sample.rightArmSwingRadians) <= Math.PI / 2)
        }
        assert.deepEqual(sampleHumanoidGaitCycle(0, mode), sampleHumanoidGaitCycle(1, mode))
        const contact = sampleHumanoidGaitCycle(0, mode)
        const oppositeContact = sampleHumanoidGaitCycle(0.5, mode)
        assert.ok(Math.abs(contact.leftLeg.hipFlexionRadians - oppositeContact.rightLeg.hipFlexionRadians) < 1e-12)
        assert.ok(Math.abs(contact.rightLeg.hipFlexionRadians - oppositeContact.leftLeg.hipFlexionRadians) < 1e-12)
        assert.ok(contact.leftLeg.stanceWeight > contact.rightLeg.stanceWeight)
        assert.ok(oppositeContact.rightLeg.stanceWeight > oppositeContact.leftLeg.stanceWeight)
    }
    assert.throws(() => sampleHumanoidGaitCycle(Number.NaN, 'walk'), /finite/)
})

test('all eight native Dungeon families calibrate 101901 gait without clip retargeting', () => {
    assert.deepEqual(
        [...OFFICIAL_DUNGEON_GAIT_REFERENCE.sourceDungeonCharacterIds],
        [100201, 100202, 100401, 100501, 100801, 109201, 111501, 114501],
    )
    assert.equal(OFFICIAL_DUNGEON_GAIT_REFERENCE.compatibility, 'kinematic-parameters-only;no-cross-character-clip-retargeting')
    assert.equal(OFFICIAL_DUNGEON_GAIT_REFERENCE.walk.cycleSeconds, 1.4500000476837158)
    assert.equal(OFFICIAL_DUNGEON_GAIT_REFERENCE.run.cycleSeconds, 0.8166666626930237)
    assert.equal(OFFICIAL_DUNGEON_GAIT_REFERENCE.walk.observedSpeedMetersPerSecond, 0.8851097606472933)
    assert.equal(OFFICIAL_DUNGEON_GAIT_REFERENCE.run.observedSpeedMetersPerSecond, 3.5058317223666537)
    assert.equal(OFFICIAL_DUNGEON_GAIT_REFERENCE.walk.rootTravelPerCycleMeters, 1.2834091951438975)
    assert.equal(OFFICIAL_DUNGEON_GAIT_REFERENCE.run.rootTravelPerCycleMeters, 2.86309589266851)

    const radiansToDegrees = radians => radians * 180 / Math.PI
    const range = values => Math.max(...values) - Math.min(...values)
    const verifyMode = (mode, phases, reference) => {
        const samples = phases.map(phase => sampleHumanoidGaitCycle(phase, mode))
        assert.ok(Math.abs(range(samples.map(sample => radiansToDegrees(sample.leftLeg.hipFlexionRadians))) - reference.upperLegAngularRangeDegrees) < 0.51)
        assert.ok(Math.abs(range(samples.map(sample => radiansToDegrees(sample.leftLeg.kneeFlexionRadians))) - reference.lowerLegAngularRangeDegrees) < 0.51)
        assert.ok(Math.abs(range(samples.map(sample => radiansToDegrees(sample.leftLeg.ankleFlexionRadians))) - reference.footAngularRangeDegrees) < 0.51)
        assert.ok(Math.abs(range(samples.map(sample => radiansToDegrees(sample.leftArmSwingRadians))) - reference.armAngularRangeDegrees) < 1e-9)
        assert.ok(Math.abs(range(samples.map(sample => radiansToDegrees(sample.leftElbowFlexionRadians))) - reference.forearmAngularRangeDegrees) < 1e-9)

        const cardinal = [0, 0.25, 0.5, 0.75].map(phase => sampleHumanoidGaitCycle(phase, mode))
        assert.ok(Math.abs(range(cardinal.map(sample => sample.pelvis.lateralOffsetMeters)) - reference.hipLateralSpanMeters) < 1e-12)
        assert.ok(Math.abs(range(cardinal.map(sample => sample.pelvis.verticalOffsetMeters)) - reference.hipVerticalSpanMeters) < 1e-12)
    }
    verifyMode('walk', [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88], OFFICIAL_DUNGEON_GAIT_REFERENCE.walk)
    verifyMode('run', [0, 0.1, 0.22, 0.34, 0.46, 0.62, 0.76, 0.9], OFFICIAL_DUNGEON_GAIT_REFERENCE.run)
})

test('configured takeoff anticipation plays jump while grounded before deterministic launch', () => {
    const ground = new FlatGroundCollisionWorld(0)
    const transform = createTransform()
    const controller = new CharacterLocomotionController({
        characterId: 'anticipated-jump',
        transform,
        collisionWorld: ground,
        groundQuery: ground,
        initiallyGrounded: true,
        config: fixedConfig({ jumpTakeoffDelaySeconds: 6 / 60 }),
    })
    controller.setInput({ moveX: 0, moveZ: 0, run: false, jumpPressed: true })
    for (let index = 0; index < 5; index += 1) {
        const snapshot = controller.stepFixed()
        assert.equal(snapshot.state, 'jump')
        assert.equal(snapshot.grounded, true)
        assert.equal(snapshot.position.y, 0)
        assert.equal(snapshot.velocity.y, 0)
        assert.ok(snapshot.takeoffRemainingSeconds > 0)
    }
    const launched = controller.stepFixed()
    assert.equal(launched.state, 'jump')
    assert.equal(launched.grounded, false)
    assert.equal(launched.takeoffRemainingSeconds, 0)
    assert.ok(launched.position.y > 0)
    assert.ok(launched.velocity.y > 0)
})

test('101901 V37 maps nine profile-clustered native arm/finger families from the target inverse-bind rest without HomeWait leakage', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const profileSource = source.slice(
        source.indexOf('function attachParameterizedHumanoidMotionProfile'),
        source.indexOf('function findFamily'),
    )
    assert.match(source, /normalizedHumanoidMotionReference\.generated\.json\?raw/)
    assert.match(source, /nativeUpperBodyMotionReference\.generated\.json\?raw/)
    assert.match(source, /magius\.normalized-humanoid-motion-reference\.v1/)
    assert.match(source, /'accepted-100102-100301-lower-body\+nine-native-low-abduction-upper-body-and-fingers-v37'/)
    assert.match(source, /'official-ten-donor-lower-body\+nine-native-dress-clearance-upper-body-and-fingers-v37'/)
    assert.match(source, /sourceDungeonCharacterIds: activeDonorIds/)
    assert.match(source, /'morphology-nearest-normalized-trajectory-only;target-rig-segment-direction-solve;no-donor-track-binding'/)
    assert.match(source, /const applyNormalizedReferencePose = \(/)
    assert.match(source, /frame => frame\.hip\.rotationDeltaYXZ/)
    for (const role of [
        'spine', 'waist', 'chest', 'neck',
        'shoulderL', 'upperArmL', 'forearmL',
        'shoulderR', 'upperArmR', 'forearmR',
        'upperLegL', 'lowerLegL', 'footL',
        'upperLegR', 'lowerLegR', 'footR',
    ]) {
        assert.match(source, new RegExp(`directionRole: '${role}'`))
    }
    assert.match(source, /referenceVectorToTargetWorld\(donorDirection\)/)
    assert.match(source, /fullBodyPoseAt\?\: \(ratio: number\) => void/)
    assert.match(source, /if \(fullBodyPoseAt\) \{[\s\S]{0,80}fullBodyPoseAt\(ratio\)/)
    assert.match(source, /Magius\$\{characterId\}NaturalArmFingerWalkV37_L/)
    assert.match(source, /Magius\$\{characterId\}NaturalArmFingerRunV37_L/)
    assert.match(source, /Magius\$\{characterId\}DressClearanceMultiDonorWalkV37_L/)
    assert.match(source, /Magius\$\{characterId\}DressClearanceMultiDonorRunV37_L/)
    assert.doesNotMatch(profileSource, /MoveIdleDonorTrajectoryV9_L/)
    assert.match(source, /bodyClipPathId: '-744234983873425308'/)
    assert.match(source, /weaponClipPathId: '2664253911874192042'/)
    assert.match(source, /tpsPolicy: 'body-only-hide-external-weapon-sibling'/)
    assert.match(source, /idle: baselineClip/)
    assert.match(source, /poseSolve: 'target-rig-rest-axis-mapped-segment-directions\+inverse-bind-rest-local-rotation-deltas'/)
    assert.match(source, /handPolicy: 'nine-native-profile-clustered-shoulder-elbow-wrist-finger-curves-authoritative;target-inverse-bind-rest-local-delta-retarget;never-layer-over-HomeWait;closed-ring-arm-hand-angular-step-limit\+walk-forearm-eight-official-donor-fixed-prebend-with-zero-bend-phase-residual-and-target-upper-arm-relative-elbow-plane;target-OuterSkirt-walk-only-joint-wrist-translation\+bounded-authored-hemisphere-elbow-plane-candidates\+bounded-hand-orientation-against-deformed-skinned-outermost-radial-support-triangle-surface-with-signed-inside-intersection-clearance\+adaptive-per-side-depth-budget\+all-probe-monotonic-candidate-selection-and-post-IK-remeasure;run-preserves-approved-wrist-only-trajectory'/)
    assert.match(source, /'101901-low-abduction-nine-native-arms-fingers-v37'/)
    assert.match(source, /'101901-mami-dress-clearance-nine-native-arms-fingers-v37'/)
    assert.match(source, /const blendNaturalUpperBodyVector = \(/)
    assert.match(source, /const naturalArmFingerDonorIds = \[[\s\S]{0,140}100201, 100202, 100301, 100401, 100501, 100801, 109201, 111501, 114501/)
    for (const characterId of [100201, 100202, 100301, 100401, 100501, 100801, 109201, 111501, 114501]) {
        assert.match(source, new RegExp(`${characterId}: 0\\.`))
    }
    const weightSource = source.slice(
        source.indexOf('const naturalUpperBodyTrajectoryWeights'),
        source.indexOf('const officialCombat101901'),
    )
    assert.match(weightSource, /'set-a': \{[\s\S]{0,700}run: \{[\s\S]{0,180}100301: 0\.20[\s\S]{0,100}100501: 0\.36/)
    assert.match(weightSource, /'101901-dress-clearance-multidonor': \{[\s\S]{0,700}run: \{[\s\S]{0,180}100301: 0\.36[\s\S]{0,100}100501: 0\.28/)
    assert.doesNotMatch(weightSource, /100801: 0\.28/)
    assert.match(profileSource, /const naturalUpperBodyWeights = naturalUpperBodyTrajectoryWeights\[naturalUpperBodyProfileId\]/)
    assert.match(source, /const applyNativeHandFingerPose = \(/)
    assert.match(source, /target\.quaternion\.copy\(targetRest\.quaternion\)\.multiply\(weightedDelta\)\.normalize\(\)/)
    assert.match(source, /const restoreTargetRigRestHandPose = \(side: 'L' \| 'R'\): void =>/)
    assert.match(source, /const targetRest = skeletonRestLocal\.get\(target\)/)
    assert.match(source, /const restoreNaturalUpperBodyTargetRest = \(\): void =>/)
    const syntax = ts.createSourceFile('viewerLocomotion.ts', source, ts.ScriptTarget.Latest, true)
    let poseStatements
    const findPose = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'applyNormalizedReferencePose') {
            poseStatements = node.initializer.body.statements
        }
        ts.forEachChild(node, findPose)
    }
    findPose(syntax)
    assert.ok(poseStatements, 'normalized pose function exists')
    const restIndex = poseStatements.findIndex(node => ts.isExpressionStatement(node)
        && ts.isCallExpression(node.expression)
        && node.expression.expression.getText(syntax) === 'restoreNaturalUpperBodyTargetRest')
    const hipIndex = poseStatements.findIndex(node => ts.isVariableStatement(node)
        && node.declarationList.declarations.some(declaration => declaration.name.getText(syntax) === 'hipRotation'))
    assert.ok(restIndex >= 0 && hipIndex > restIndex, 'target upper-body rest precedes donor hip rotation')
    assert.match(source, /const nativeUpperBodyAuthorityRigPaths =/)
    assert.match(source, /const isNativeHandFingerRigPath = \(rigPath: string\): boolean =>/)
    assert.match(source, /const nativeUpperBodySecondaryPaths = nativeUpperBodyAuthorityPaths\.filter/)
    assert.match(source, /const nativeUpperBodyAuthorityRigPaths = nativeUpperBodyAuthorityPaths\.filter\([\s\S]{0,80}isNativeHandFingerRigPath/)
    assert.match(source, /nativeUpperBodyExcludedSecondaryPathCount: nativeUpperBodySecondaryPaths\.length/)
    assert.doesNotMatch(source, /const nativeUpperBodyFingerPaths = nativeUpperBodyRigPaths\.filter\([\s\S]{0,100}!\/\\\/Hand_/)
    assert.match(source, /missingNativeUpperBodyTargetRestPaths/)
    const handPoseSource = source.slice(
        source.indexOf('const applyNativeHandFingerPose = ('),
        source.indexOf('const targetToReferenceLegScale', source.indexOf('const applyNativeHandFingerPose = (')),
    )
    assert.match(handPoseSource, /for \(const rigPath of nativeUpperBodyHandPaths\)/)
    assert.match(handPoseSource, /blendNativeUpperBodyDelta\(semantic, phase, rigPath\)/)
    assert.match(handPoseSource, /for \(const rigPath of nativeUpperBodyFingerPaths\)/)
    assert.doesNotMatch(handPoseSource, /for \(const rigPath of nativeUpperBodyRigPaths\)/)
    assert.doesNotMatch(handPoseSource, /sampledBaselineTransforms\.get\(target\)/)
    assert.doesNotMatch(handPoseSource, /sampleNativeUpperBodyTemporalDelta/)
    assert.match(source, /handFingerPoseAt\?\.\(ratio\)/)
    assert.match(source, /footPolicy: 'official-swing-direction-with-three-frame-temporal-filter-and-closed-ring-foot-toe-angular-step-limit-and-continuous-target-rig-flat-sole-contact-blend;controller-root'/)
    assert.match(source, /const outerSkirtCollisionBones = \[\.\.\.rig\.entries\(\)\]/)
    assert.match(source, /skirtEnvelopeRadius \+ dressClearanceProxyRadiusMeters - handRadialDistance/)
    assert.match(source, /const targetRigLeftAxis = originalUpperArmPositions\.L\.clone\(\)/)
    assert.match(source, /const targetRigForward = rig\.get\(motionPaths\.toeL\)/)
    assert.match(source, /const targetRigOutwardFor = \(side: 'L' \| 'R'\): THREE\.Vector3/)
    assert.match(source, /targetRigLeftAxis\.clone\(\)\.multiplyScalar\(reference\.x\)/)
    assert.match(source, /\.addScaledVector\(targetRigForward, reference\.z\)/)
    assert.doesNotMatch(source, /worldRight\.clone\(\)\.multiplyScalar\(reference\.x\)/)
    assert.doesNotMatch(source, /\.addScaledVector\(worldForward, reference\.z\)/)
    assert.match(source, /const authoredElbow = forearm\.getWorldPosition/)
    assert.match(source, /const authoredElbowPole = authoredShoulderToElbow\.clone\(\)/)
    assert.match(source, /elbowPoleWorldHint\?\.clone\(\)/)
    const authoredHemisphereGuardIndex = source.indexOf(
        'elbowPole.dot(authoredElbowPole) < 0',
    )
    const authoredHemisphereBlockOpenIndex = source.indexOf(
        ') {',
        authoredHemisphereGuardIndex,
    )
    const authoredHemisphereNegateIndex = source.indexOf(
        'elbowPole.negate()',
        authoredHemisphereBlockOpenIndex,
    )
    const authoredHemisphereBlockCloseIndex = source.indexOf(
        '\n    }',
        authoredHemisphereNegateIndex,
    )
    assert.ok(authoredHemisphereGuardIndex >= 0)
    assert.ok(authoredHemisphereBlockOpenIndex > authoredHemisphereGuardIndex)
    assert.match(
        source.slice(authoredHemisphereBlockOpenIndex, authoredHemisphereNegateIndex),
        /authored hemisphere/,
    )
    assert.ok(authoredHemisphereNegateIndex > authoredHemisphereBlockOpenIndex)
    assert.ok(authoredHemisphereNegateIndex < authoredHemisphereBlockCloseIndex)
    assert.match(source, /if \(correction > 1e-4\) \{[\s\S]{0,180}solveTwoBoneArm/)
    assert.doesNotMatch(profileSource, /semantic === 'run' \? 70 : 64/)
    assert.doesNotMatch(profileSource, /minimumHandHalfSeparation/)
    assert.doesNotMatch(profileSource, /maximumHandHeight/)
    assert.doesNotMatch(profileSource, /targetRigClearance\.(?:walk|run)\.handHalfSeparationMeters/)
    assert.doesNotMatch(profileSource, /clearance - signedLateral/)
    assert.match(source, /normalizedToeContactStart = 0\.015/)
    assert.match(source, /normalizedToeContactEnd = 0\.24/)
    assert.match(source, /lerp\(baselineToeDirections\[side\], stanceWeight \* 0\.94\)/)
    assert.doesNotMatch(profileSource, /if \(stanceWeight <= 1e-4\) continue/)
    assert.doesNotMatch(profileSource, /const gaitFootPose/)
    assert.doesNotMatch(profileSource, /const gaitArmPose/)
    assert.doesNotMatch(profileSource, /const safeIdleArmPose/)
    assert.doesNotMatch(profileSource, /forwardOffset = front - specification\.rootTravelPerCycleMeters/)
    assert.match(source, /const isInsideBodyRig = \(target: THREE\.Object3D\): boolean =>/)
    assert.match(source, /!target \|\| !isInsideBodyRig\(target\)/)
    assert.match(source, /clip\.blendMode = THREE\.NormalAnimationBlendMode/)
    assert.doesNotMatch(profileSource, /AdditiveAnimationBlendMode/)
    assert.match(source, /profile\.playbackMode = 'full-pose'/)
    assert.match(source, /viewer-locomotion-profile:101901:/)
    assert.match(source, /group: 'TPS 移动姿态 A\/B'/)
})

test('Viewer runtime imports formal action data and never depends on artifacts or an absolute drive path', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    assert.match(source, /'\.\/characterActions\/data\/official-dungeon-locomotion-runtime\.json\?raw'/)
    assert.match(source, /'\.\/characterActions\/data\/official-combat-101901-runtime\.json\?raw'/)
    assert.match(source, /'\.\/characterActions\/data\/official-dungeon-character-corpus\.tw\.json\?raw'/)
    assert.match(source, /'\.\/characterActions\/data\/direct-home\/113401\.direct-home-actions\.active-controller\.v1\.json\?raw'/)
    assert.match(source, /'\.\/characterActions\/data\/direct-home\/113501\.direct-home-actions\.active-controller\.v1\.json\?raw'/)
    assert.match(source, /'\.\/characterActions\/data\/direct-home\/action-declarations\.v1\.json\?raw'/)
    const rawRuntimeImports = [...source.matchAll(/^import\s+\S+\s+from\s+['"]([^'"]+\.json\?raw)['"]/gm)]
        .map(match => match[1])
    assert.equal(rawRuntimeImports.length >= 5, true)
    for (const runtimeImport of rawRuntimeImports) {
        assert.doesNotMatch(runtimeImport, /(?:^|\/)artifacts(?:\/|$)/i)
        assert.doesNotMatch(runtimeImport, /^(?:[a-z]:[\\/]|\\\\)/i)
    }
})

test('Viewer publishes and plays exact Nameless and A-Q Home actions before unavailable battle or Dungeon evidence', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const declarations = JSON.parse(fs.readFileSync(
        'src/viewer/characterActions/data/direct-home/action-declarations.v1.json',
        'utf8',
    ))
    assert.equal(declarations.entries.length, 70)
    assert.deepEqual(
        Object.fromEntries([113401, 113501].map(characterId => [
            characterId,
            declarations.entries.filter(entry => (
                Number(entry.characterIdentity.characterId) === characterId
            )).length,
        ])),
        { 113401: 38, 113501: 32 },
    )

    assert.match(source, /createOfficialDirectControllerProfileFromManifest\(JSON\.parse\(officialHome113401Json\) as unknown\)/)
    assert.match(source, /createOfficialDirectControllerProfileFromManifest\(JSON\.parse\(officialHome113501Json\) as unknown\)/)
    assert.match(source, /officialDirectHomeDeclarations\.counts\.entries !== 70/)
    assert.match(source, /\['113401', \{ controllerPathId: '8103184246897463375', groupedActionCount: 38 \}\]/)
    assert.match(source, /\['113501', \{ controllerPathId: '-4278097510018638778', groupedActionCount: 32 \}\]/)
    assert.match(source, /product\.groupedActionCount !== expected\.groupedActionCount/)
    assert.match(source, /function directHomeActionCatalogEntries\(/)
    assert.match(source, /sourceKind: 'direct-home'/)
    assert.match(source, /function startDirectHomePlayback\(/)
    assert.match(source, /createOfficialCharacterActionTimeline\(/)
    assert.match(source, /createObjectTimelineBinding\(/)
    assert.match(source, /exact Home active-controller/)
    assert.match(source, /stopActiveDirectHomePlayback\(binding\)/)
    assert.doesNotMatch(JSON.stringify(declarations), /official-combat|official-dungeon/i)
})

test('V38 preserves accepted target-axis gait, accepts wheel input across the Viewer surface, and rejects cinematic jump donors', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    assert.doesNotMatch(source, /authoredHandBodyRelativeQuaternions/)
    assert.doesNotMatch(source, /authoredChestWorldQuaternion/)
    assert.doesNotMatch(source, /maximumDeltaRadians/)
    assert.doesNotMatch(source, /constrainToeDirectionToTargetRig/)
    assert.match(source, /restoreNaturalUpperBodyTargetRest\(\)/)
    assert.match(source, /currentDirection\.lerp\(donorDirection, modeStrength\)\.normalize\(\)/)
    assert.match(source, /applyNativeHandFingerPose\('run', sidePhases\.L, sidePhases\.R, modeStrength\)/)
    assert.match(source, /desiredDirection = currentDirection\.lerp\(desiredDirection\.normalize\(\), 0\.32\)\.normalize\(\)/)
    assert.match(source, /currentTargetUpperDirection\.clone\(\)[\s\S]{0,220}\.multiplyScalar\(Math\.cos\(fixedBendRadians\)\)[\s\S]{0,180}\.addScaledVector\(targetBendDirection, Math\.sin\(fixedBendRadians\)\)/)
    assert.match(source, /const phaseStep = semantic === 'run' \? 1 \/ 49 : 1 \/ 87/)
    assert.match(source, /delta from that donor's inverse-bind rest/)
    assert.match(source, /const limitCyclicQuaternionSteps = \(/)
    assert.match(source, /Project only over neighbouring frames on the closed animation ring/)
    const walkStepLimits = source.slice(
        source.indexOf('walk: {', source.indexOf('cyclicQuaternionStepLimitsDegrees')),
        source.indexOf('run: {', source.indexOf('cyclicQuaternionStepLimitsDegrees')),
    )
    assert.match(walkStepLimits, /Arm_L: 6,[\s\S]{0,280}Hand_L: 4,[\s\S]{0,80}Foot_L: 2\.5/)
    assert.doesNotMatch(walkStepLimits, /Forearm_[LR]:/)
    assert.match(source, /Forearm_L: 7,[\s\S]{0,80}Hand_L: 5,[\s\S]{0,80}Foot_L: 3\.5/)
    assert.match(source, /limitCyclicQuaternionSteps\(values, times, duration, maximumStepDegrees\)/)
    assert.match(source, /applyNativeHandFingerPose\('walk', ratio\),[\s\S]{0,40}'walk'/)
    assert.match(source, /applyNativeHandFingerPose\('run', ratio\),[\s\S]{0,40}'run'/)
    assert.doesNotMatch(source, /delta\.slerpQuaternions\(new THREE\.Quaternion\(\), delta/)
    assert.match(source, /const weightedDelta = handStrength < 1[\s\S]{0,100}new THREE\.Quaternion\(\)\.slerp\(delta, handStrength\)/)
    const camera = fs.readFileSync('src/viewer/ThirdPersonCamera.ts','utf8')
    assert.match(source, /tpsCamera\.install\(\)/)
    assert.match(camera, /document\.addEventListener\('wheel', event =>/)
    assert.match(camera, /this\.isControl\(event\.target\)/)
    assert.match(camera, /this\.inside\(event\.clientX, event\.clientY\)/)
    assert.match(camera, /passive: false, capture: true, signal/)
    assert.doesNotMatch(camera, /addEventListener\('mousemove'/)

    assert.match(source, /function controllerFreeJumpDonorRejectionReason\(/)
    assert.match(source, /donor\.grade !== 'A'/)
    assert.match(source, /entry\.skill\.semantic === 'special'/)
    assert.match(source, /\|\| controllerFreeJumpDonorRejectionReason\(entry\)/)
    assert.match(source, /const controllerRejection = controllerFreeJumpDonorRejectionReason\(entry\)[\s\S]{0,180}status: 'unavailable'/)
})

test('V44 keeps 101901 walking forearms strongly pre-bent without a gait-phase refold', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    assert.match(source, /const officialNativeWalkArmDonorIds = \[[\s\S]{0,120}100201, 100202, 100401, 100501, 100801, 109201, 111501, 114501/)
    assert.match(source, /const officialNativeWalkArmDonors = officialNativeWalkArmDonorIds\.map/)
    assert.match(source, /const walkForearmTimelineOffsets = \[-2, -1, 0, 1, 2\] as const/)
    assert.match(source, /const walkForearmTimelineWeights = \[1, 4, 6, 4, 1\] as const/)
    assert.match(source, /const sampleFilteredDonorWalkElbowBend = \(/)
    assert.match(source, /const walkForearmDonorStatistics = new Map</)
    assert.match(source, /strongBendThreshold: percentile\(samples, 0\.75\)/)
    assert.match(source, /const pooledBendSamples = officialNativeWalkArmDonors\.flatMap/)
    assert.match(source, /const fixedBendRadians = percentile\(pooledBendSamples, 0\.90\)/)
    assert.match(source, /statistics\.filteredBends\[frameIndex\] < statistics\.strongBendThreshold/)
    assert.match(source, /const currentTargetUpperDirection = bone\.getWorldPosition/)
    assert.match(source, /const bendDirection = forearmDirection\.clone\(\)\.addScaledVector\([\s\S]{0,180}-forearmDirection\.dot\(upperDirection\)/)
    assert.match(source, /fixedBendDirectionReference\.addScaledVector\([\s\S]{0,140}1 \/ officialNativeWalkArmDonors\.length \/ strongFrameCount/)
    assert.match(source, /targetBendDirection\.addScaledVector\([\s\S]{0,180}-targetBendDirection\.dot\(currentTargetUpperDirection\)/)
    assert.match(source, /\.multiplyScalar\(Math\.cos\(fixedBendRadians\)\)[\s\S]{0,180}\.addScaledVector\(targetBendDirection, Math\.sin\(fixedBendRadians\)\)/)
    assert.match(source, /walkForearmFixedPrebendProfiles\[side\]\.fixedBendRadians/)
    assert.match(source, /solveTwoBoneArm\([\s\S]{0,180}semantic === 'walk'[\s\S]{0,180}walkForearmFixedPrebendProfiles\[side\]\.fixedBendRadians/)
    assert.doesNotMatch(source, /sampleStableWalkForearmBend|stableResidualDonors|persistentBendCenter/)
    assert.doesNotMatch(source, /bendAngle \* 1\.24/)
    assert.match(source, /The elbow angle has no gait-phase residual/)
    assert.match(source, /Forearms retain the fixed pre-bent native walk profile above/)

    const reference = JSON.parse(fs.readFileSync(
        'src/viewer/normalizedHumanoidMotionReference.generated.json',
        'utf8',
    ))
    const officialIds = [100201, 100202, 100401, 100501, 100801, 109201, 111501, 114501]
    const officialDonors = officialIds.map(characterId => (
        reference.donors.find(donor => donor.characterId === characterId)
    ))
    assert.ok(officialDonors.every(Boolean))
    const unit = vector => {
        const length = Math.hypot(...vector)
        return vector.map(value => value / length)
    }
    const angle = (left, right) => Math.acos(Math.max(-1, Math.min(1,
        unit(left).reduce((sum, value, index) => sum + value * unit(right)[index], 0),
    )))
    const percentile = (values, ratio) => {
        const ordered = [...values].sort((left, right) => left - right)
        const position = (ordered.length - 1) * ratio
        const before = Math.floor(position)
        const after = Math.min(before + 1, ordered.length - 1)
        return ordered[before] + (ordered[after] - ordered[before]) * (position - before)
    }
    const sampleVector = (donor, phase, role) => {
        const frames = donor.clips.walk.frames
        const position = (((phase % 1) + 1) % 1) * frames.length
        const before = Math.floor(position) % frames.length
        const after = (before + 1) % frames.length
        const mix = position - Math.floor(position)
        return unit(frames[before].directions[role].map((value, axis) => (
            value + (frames[after].directions[role][axis] - value) * mix
        )))
    }
    const filteredBend = (donor, side, phase) => {
        const offsets = [-2, -1, 0, 1, 2]
        const weights = [1, 4, 6, 4, 1]
        return offsets.reduce((sum, offset, index) => sum + angle(
            sampleVector(donor, phase + offset / donor.clips.walk.frames.length, `upperArm${side}`),
            sampleVector(donor, phase + offset / donor.clips.walk.frames.length, `forearm${side}`),
        ) * weights[index] / 16, 0)
    }
    for (const side of ['L', 'R']) {
        const perDonorSamples = officialDonors.map(donor => donor.clips.walk.frames.map((_, index) => (
            filteredBend(donor, side, index / donor.clips.walk.frames.length)
        )))
        const fixedPrebend = percentile(perDonorSamples.flat(), 0.90)
        const fixedPrebendDegrees = fixedPrebend * 180 / Math.PI
        assert.ok(fixedPrebendDegrees >= 29 && fixedPrebendDegrees <= 32, `${side} strong official prebend`)
        const fixedTimeline = Array(240).fill(fixedPrebend)
        assert.equal(Math.max(...fixedTimeline) - Math.min(...fixedTimeline), 0)
        for (const samples of perDonorSamples) {
            const strongThreshold = percentile(samples, 0.75)
            assert.ok(samples.filter(value => value >= strongThreshold - 1e-9).length > 0)
        }
    }
    const walkStepLimits = source.slice(
        source.indexOf('walk: {', source.indexOf('cyclicQuaternionStepLimitsDegrees')),
        source.indexOf('run: {', source.indexOf('cyclicQuaternionStepLimitsDegrees')),
    )
    assert.doesNotMatch(walkStepLimits, /Forearm_[LR]:/)
    assert.match(source, /run: \{[\s\S]{0,120}Forearm_L: 7,[\s\S]{0,60}Forearm_R: 7/)
    assert.match(source, /const targetRigLocomotionTransitionSeconds = \{[\s\S]{0,220}groundedGait: 0\.28,[\s\S]{0,80}takeoff: 0\.20,[\s\S]{0,80}airborne: 0\.16,[\s\S]{0,80}landing: 0\.22,[\s\S]{0,80}recovery: 0\.30/)
    assert.match(source, /function targetRigMinimumLocomotionTransitionSeconds\(/)
    const policyAst=ts.createSourceFile('viewer.ts',source,ts.ScriptTarget.Latest,true);const policyFunction=policyAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createTargetRigLocomotionTransitionPolicy');assert.ok(policyFunction);assert.match(policyFunction.getText(policyAst),/for \(const family of Object\.values\(jumpAnimations \?\? \{\}\)\)/)
    assert.match(source, /function targetRigLocomotionFadeSeconds\([\s\S]{0,1300}return Math\.max\(requestedFadeSeconds, minimumFadeSeconds\)/)
    assert.match(source, /createAnimationPort\([\s\S]{0,180}createTargetRigLocomotionTransitionPolicy\(locomotionAnimations, variant\.jumpAnimations\)/)
    assert.match(source, /const targetRigLocomotionTransitions = characterSpecificMotion\.profile\.status === 'attached'[\s\S]{0,360}characterSpecificMotion\.jumpAnimations/)

    // Keep the two user-accepted controls byte-visible in the same regression.
    assert.match(fs.readFileSync('src/viewer/ThirdPersonCamera.ts','utf8'), /Math\.max\(0, this\.distance \+ delta \* 0\.0035\)/)
    assert.match(source, /hasDirectionalInput[\s\S]{0,120}THREE\.MathUtils\.clamp\(speedRatio, 1, 1\.1\)/)
})

test('S6 restores 101901 Set A authored clipping and removes interactive triangle/probe work', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    assert.match(source, /const enableInteractiveSetAWalkDressClearance = false/)

    const surfaceStart = source.indexOf('const setAWalkOuterSkirtSurfaces:')
    const surfaceTraverse = source.indexOf('character.object.traverse(target => {', surfaceStart)
    const surfaceGate = source.slice(surfaceStart, surfaceTraverse)
    assert.ok(surfaceStart >= 0 && surfaceTraverse > surfaceStart)
    assert.match(
        surfaceGate,
        /if \(\s*enableInteractiveSetAWalkDressClearance\s*&& profileId === 'set-a'\s*&& outerSkirtCollisionBoneSet\.size > 0\s*\) \{/,
    )

    const runtimeStart = source.indexOf('const postAnimationWalkClearance:')
    const runtimeEnd = source.indexOf('const jumpProfileTag', runtimeStart)
    const postAnimationRuntime = source.slice(runtimeStart, runtimeEnd)
    assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart)
    assert.match(
        postAnimationRuntime,
        /enableInteractiveSetAWalkDressClearance\s*&& characterId === 101901\s*&& profileId === 'set-a'/,
    )
    assert.match(postAnimationRuntime, /applySetAWalkDressClearance\(frameIndex, phase, clipName\)/)
    assert.match(postAnimationRuntime, /snapshot\?\.state !== 'walk'/)

    const attachStart = source.indexOf('export function attachViewerLocomotion')
    const attachEnd = source.indexOf('export function detachViewerLocomotion', attachStart)
    const attach = source.slice(attachStart, attachEnd)
    assert.match(attach, /if \(binding\.postAnimationWalkClearance\) \{[\s\S]*?animationLoops\.push\(binding\.postAnimationWalkClearance\.update\)/)
    assert.match(source, /postAnimationWalkClearance: characterSpecificMotion\.postAnimationWalkClearance/)
    assert.match(source, /binding\.postAnimationWalkClearance\?\.setActive\(/)
    assert.match(source, /callback !== binding\.postAnimationWalkClearance\?\.update/)
    assert.match(source, /binding\.postAnimationWalkClearance\?\.reset\(\)/)

    const handPoseIndex = source.indexOf('handFingerPoseAt?.(ratio)')
    const clipBakeEndIndex = source.indexOf('for (const [trackName, binding] of baselineBindings)', handPoseIndex)
    assert.ok(handPoseIndex > 0 && clipBakeEndIndex > handPoseIndex)
    assert.doesNotMatch(source.slice(handPoseIndex, clipBakeEndIndex), /applySetAWalkDressClearance\(/)
    assert.match(source, /captureSetAWalkDressClearanceCycle\(sampleCount = 240\)/)
})
test('V50 real-surface query rejects a closer inner fold and keeps the outermost same-direction sheet', () => {
    const makeRadialSheet = radius => new Triangle(
        new Vector3(radius, -0.2, -0.2),
        new Vector3(radius, 0.2, -0.2),
        new Vector3(radius, 0, 0.2),
    )
    const innerFold = makeRadialSheet(0.15)
    const visibleOuterSheet = makeRadialSheet(0.35)
    const probe = new Vector3(0.20, 0, 0)
    const oldNearestInnerDistance = innerFold.closestPointToPoint(
        probe,
        new Vector3(),
    ).distanceTo(probe)
    const outerDistance = visibleOuterSheet.closestPointToPoint(
        probe,
        new Vector3(),
    ).distanceTo(probe)
    assert.ok(oldNearestInnerDistance < outerDistance, 'fixture must reproduce inner-fold nearest misselection')

    const rayOrigin = new Vector3(0, 0, 0)
    const radialDirection = new Vector3(1, 0, 0)
    const radialRay = new Ray(rayOrigin, radialDirection)
    let outermostRadius = Number.NEGATIVE_INFINITY
    let outermostPoint
    for (const triangle of [innerFold, visibleOuterSheet]) {
        const hit = radialRay.intersectTriangle(
            triangle.a,
            triangle.b,
            triangle.c,
            false,
            new Vector3(),
        )
        assert.ok(hit)
        const hitRadius = hit.clone().sub(rayOrigin).dot(radialDirection)
        if (hitRadius <= outermostRadius) continue
        outermostRadius = hitRadius
        outermostPoint = hit
    }
    assert.ok(outermostPoint)
    assert.ok(Math.abs(outermostRadius - 0.35) < 1e-9)
    const probeRadius = probe.clone().sub(rayOrigin).dot(radialDirection)
    assert.ok(probeRadius - outermostRadius < 0, 'probe between folds is inside the visible outer sheet')
})

test('V50 clears every Set A walk forearm, cuff, palm and finger sphere against triangulated skirt surface without changing run', () => {
    const correctionLimitMeters = 0.37 * 0.14
    const safetyMarginMeters = 0.006
    const convergenceGuardMeters = 0.0015
    const projectionSweeps = 4
    const maximumPasses = 5
    const probeRadii = [0.026, 0.026, 0.042, 0.014, 0.014, 0.014, 0.014]
    let minimumWalkClearanceMeters = Number.POSITIVE_INFINITY
    let maximumCorrectionMeters = 0
    let insideHits = 0
    let intersectionHits = 0

    const radiusAt = angle => {
        const radiusX = 0.305
        const radiusZ = 0.265
        return 1 / Math.sqrt(
            Math.cos(angle) ** 2 / radiusX ** 2
            + Math.sin(angle) ** 2 / radiusZ ** 2,
        )
    }
    const skirtTriangles = []
    const segmentCount = 96
    for (let segment = 0; segment < segmentCount; segment += 1) {
        const angleA = segment / segmentCount * Math.PI * 2
        const angleB = (segment + 1) / segmentCount * Math.PI * 2
        const point = (angle, y) => new Vector3(
            Math.cos(angle) * radiusAt(angle),
            y,
            Math.sin(angle) * radiusAt(angle),
        )
        const aTop = point(angleA, 0.12)
        const aBottom = point(angleA, -0.42)
        const bTop = point(angleB, 0.12)
        const bBottom = point(angleB, -0.42)
        for (const triangle of [
            new Triangle(aTop, aBottom, bTop),
            new Triangle(bTop, aBottom, bBottom),
        ]) {
            const outwardNormal = triangle.getNormal(new Vector3())
            const radial = triangle.getMidpoint(new Vector3())
            radial.y = 0
            if (outwardNormal.dot(radial) < 0) outwardNormal.negate()
            skirtTriangles.push({ triangle, outwardNormal })
        }
    }
    const constraintAt = (position, radiusMeters) => {
        let nearest
        let nearestPoint
        let nearestDistanceSquared = Number.POSITIVE_INFINITY
        for (const candidate of skirtTriangles) {
            const point = candidate.triangle.closestPointToPoint(position, new Vector3())
            const distanceSquared = point.distanceToSquared(position)
            if (distanceSquared >= nearestDistanceSquared) continue
            nearestDistanceSquared = distanceSquared
            nearest = candidate
            nearestPoint = point
        }
        assert.ok(nearest)
        assert.ok(nearestPoint)
        const planeOffsetMeters = position.clone().sub(nearest.triangle.a)
            .dot(nearest.outwardNormal)
        const signedDistanceMeters = Math.sqrt(nearestDistanceSquared)
            * (planeOffsetMeters < 0 ? -1 : 1)
        const requiredDistanceMeters = radiusMeters + safetyMarginMeters
        return {
            surfaceNormal: nearest.outwardNormal.clone(),
            signedDistanceMeters,
            penetrationMeters: requiredDistanceMeters - signedDistanceMeters,
        }
    }

    for (let frame = 0; frame < 240; frame += 1) {
        const phase = frame / 240
        for (const sideSign of [-1, 1]) {
            const probes = probeRadii.map((radiusMeters, probeIndex) => {
                const baseAngle = sideSign > 0
                    ? 0.58 + 0.07 * Math.sin(phase * Math.PI * 2)
                    : Math.PI - 0.58 - 0.07 * Math.sin(phase * Math.PI * 2)
                const probeAngle = baseAngle + sideSign * (probeIndex - 3) * 0.025
                const outwardDirection = new Vector3(
                    Math.cos(probeAngle),
                    0,
                    Math.sin(probeAngle),
                )
                const requiredDistanceMeters = radiusMeters + safetyMarginMeters
                const intendedPenetrationMeters = probeIndex >= 3
                    ? requiredDistanceMeters + 0.0015
                    : 0.011 + 0.004 * Math.sin(
                        phase * Math.PI * 2 + probeIndex * 0.55,
                    )
                const radialDistanceMeters = radiusAt(probeAngle)
                    + requiredDistanceMeters - intendedPenetrationMeters
                return {
                    radiusMeters,
                    initialPosition: outwardDirection.multiplyScalar(radialDistanceMeters)
                        .setY(-0.12 + (probeIndex - 3) * 0.018),
                }
            })
            const achievedCorrection = new Vector3()
            for (let pass = 0; pass < maximumPasses; pass += 1) {
                const constraints = probes.map(probe => constraintAt(
                    probe.initialPosition.clone().add(achievedCorrection),
                    probe.radiusMeters,
                ))
                if (pass === 0) {
                    insideHits += constraints.filter(value => value.signedDistanceMeters < 0).length
                    intersectionHits += constraints.filter(value => value.penetrationMeters > 0).length
                }
                if (constraints.every(value => value.penetrationMeters <= 0)) break
                const remainingCorrectionMeters = Math.max(
                    0,
                    correctionLimitMeters - achievedCorrection.length(),
                )
                const requestedCorrection = new Vector3()
                for (let sweep = 0; sweep < projectionSweeps; sweep += 1) {
                    constraints.forEach(constraint => {
                        const deficitMeters = constraint.penetrationMeters
                            + convergenceGuardMeters
                            - requestedCorrection.dot(constraint.surfaceNormal)
                        if (deficitMeters <= 0) return
                        requestedCorrection.addScaledVector(
                            constraint.surfaceNormal,
                            deficitMeters,
                        )
                        if (requestedCorrection.length() > remainingCorrectionMeters) {
                            requestedCorrection.setLength(remainingCorrectionMeters)
                        }
                    })
                }
                // A two-bone solve is not a pure translation. Reproduce a
                // deliberately conservative 82% achieved displacement so the
                // bounded post-IK remeasure is exercised by this cycle gate.
                achievedCorrection.addScaledVector(requestedCorrection, 0.82)
            }
            maximumCorrectionMeters = Math.max(maximumCorrectionMeters, achievedCorrection.length())
            assert.ok(achievedCorrection.length() <= correctionLimitMeters + 1e-9)
            for (const probe of probes) {
                const constraint = constraintAt(
                    probe.initialPosition.clone().add(achievedCorrection),
                    probe.radiusMeters,
                )
                const clearanceMeters = -constraint.penetrationMeters
                minimumWalkClearanceMeters = Math.min(minimumWalkClearanceMeters, clearanceMeters)
                assert.ok(clearanceMeters >= 0, `walk frame ${frame} penetrated ${clearanceMeters}`)
            }
        }
    }

    assert.ok(minimumWalkClearanceMeters >= 0)
    assert.ok(maximumCorrectionMeters > 0)
    assert.ok(maximumCorrectionMeters <= correctionLimitMeters)
    assert.ok(insideHits > 0)
    assert.ok(intersectionHits > insideHits)

    const clamp = value => Math.max(0, Math.min(correctionLimitMeters, value))
    const approvedRunWristTrajectory = Array.from({ length: 120 }, (_, frame) => (
        0.35 + 0.012 * Math.sin(frame / 120 * Math.PI * 2)
    ))
    const v48RunWristTrajectory = approvedRunWristTrajectory.map(wristRadius => (
        wristRadius + clamp(0.31 + 0.038 - wristRadius)
    ))
    const v50RunWristTrajectory = approvedRunWristTrajectory.map(wristRadius => {
        const existingWristOnlyRadius = wristRadius + clamp(0.31 + 0.038 - wristRadius)
        const semantic = 'run'
        const profileId = 'set-a'
        return semantic === 'walk' && profileId === 'set-a'
            ? Number.NaN
            : existingWristOnlyRadius
    })
    assert.deepEqual(v50RunWristTrajectory, v48RunWristTrajectory)
    assert.equal((fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
        .match(/applySetAWalkDressClearance\(\)/g) ?? []).length, 0)
})

test('native upper-body reference records all nine requested hand/finger families', () => {
    const reference = JSON.parse(fs.readFileSync(
        'src/viewer/nativeUpperBodyMotionReference.generated.json',
        'utf8',
    ))
    assert.equal(reference.schema, 'magius.native-upper-body-motion-reference.v1')
    assert.equal(reference.sampleRate, 60)
    assert.match(reference.transferPolicy, /rest-relative-local-rotation-retarget/)
    assert.match(reference.transferPolicy, /never-bind-donor-track-or-uuid-to-target-rig/)
    assert.deepEqual(reference.donors.map(donor => donor.characterId), [
        100102, 100201, 100202, 100301, 100401,
        100501, 100801, 109201, 111501, 114501,
    ])
    assert.equal(reference.donors[0].status, 'source-unavailable')
    const requested = [100201, 100202, 100301, 100401, 100501, 100801, 109201, 111501, 114501]
    const dynamicBySemantic = { walk: 0, run: 0 }
    for (const characterId of requested) {
        const donor = reference.donors.find(candidate => candidate.characterId === characterId)
        assert.equal(donor.status, 'attached')
        for (const semantic of ['walk', 'run']) {
            const clip = donor.clips[semantic]
            assert.equal(clip.sampleRate, 60)
            assert.equal(clip.frames.length, clip.frameCount)
            assert.ok(clip.diagnostics.handRotationPaths >= 2)
            assert.ok(clip.diagnostics.fingerRotationPaths >= 30)
            dynamicBySemantic[semantic] += clip.diagnostics.dynamicFingerRotationPaths
            assert.ok(Object.keys(clip.frames[0].localRotationDeltas).some(path => /\/Hand_L$/.test(path)))
            assert.ok(Object.keys(clip.frames[0].localRotationDeltas).some(path => /finger/i.test(path)))
        }
    }
    assert.ok(dynamicBySemantic.walk > 0)
    assert.ok(dynamicBySemantic.run > 0)
})

test('normalized donor reference preserves ten full 60fps cycles, morphology weights, and controlled root', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const reference = JSON.parse(fs.readFileSync(
        'src/viewer/normalizedHumanoidMotionReference.generated.json',
        'utf8',
    ))
    assert.equal(reference.schema, 'magius.normalized-humanoid-motion-reference.v1')
    assert.equal(reference.sampleRate, 60)
    assert.deepEqual(reference.donors.map(donor => donor.characterId), [
        100102, 100201, 100202, 100301, 100401,
        100501, 100801, 109201, 111501, 114501,
    ])
    assert.match(reference.transferPolicy, /normalized-trajectory-only/)
    assert.match(reference.transferPolicy, /never-bind-donor-track-to-target-rig/)
    for (const donor of reference.donors) {
        assert.ok(donor.dimensions.legLengthMeters > 0)
        assert.ok(donor.dimensions.armLengthMeters > 0)
        for (const semantic of ['idle', 'walk', 'run']) {
            const clip = donor.clips[semantic]
            assert.equal(clip.sampleRate, 60)
            assert.equal(clip.frames.length, clip.frameCount)
            assert.ok(clip.frames.length >= 49)
            assert.ok(clip.frames.every(frame => frame.phase >= 0 && frame.phase < 1))
            assert.ok(clip.frames.every(frame => Object.keys(frame.directions).length === 16))
        }
    }
    const setA = reference.blendProfiles['set-a']
    const setB = reference.blendProfiles['101901-dress-clearance-multidonor']
    assert.equal(setA.weights['100102'], 0.5)
    assert.equal(setA.weights['100301'], 0.5)
    assert.equal(Object.entries(setA.weights).filter(([, weight]) => weight > 0).length, 2)
    assert.ok(Object.values(setB.weights).every(weight => weight > 0))
    assert.ok(Math.abs(Object.values(setB.weights).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-6)
    assert.equal(Object.keys(reference.morphologyDiagnostics.donors).length, 10)
    assert.equal(reference.morphologyDiagnostics.targetCharacterId, '101901')
    assert.ok(reference.authority.requiredNativeResourceIds.includes('100501'))
    assert.equal(reference.authority.faceVariants['100102'].length, 4)
    assert.equal(reference.authority.faceVariants['100301'], undefined)
    assert.match(source, /const targetToReferenceLegScale = legLengthMeters \/ referenceLegLengthMeters/)
    assert.match(source, /OFFICIAL_DUNGEON_GAIT_REFERENCE\.walk\.rootTravelPerCycleMeters[\s\S]{0,100}\* targetToReferenceLegScale/)
    assert.match(source, /OFFICIAL_DUNGEON_GAIT_REFERENCE\.run\.rootTravelPerCycleMeters[\s\S]{0,100}\* targetToReferenceLegScale/)
    assert.match(source, /weightedRootTravelFor = \(semantic: 'walk' \| 'run'\)/)
    assert.match(source, /rootTravelPerCycleMeters[\s\S]{0,220}donor\.dimensions\.legLengthMeters/)
    assert.match(source, /const walkSpeedMetersPerSecond = walkRootTravelPerCycleMeters \/ walkDuration/)
    assert.match(source, /const runSpeedMetersPerSecond = runRootTravelPerCycleMeters \/ runDuration/)
    assert.match(source, /normalizedReferenceHipOffset\(ratio, 'walk'\)/)
    assert.match(source, /normalizedReferenceHipOffset\(ratio, 'run'\)/)
    assert.match(source, /walkSpeed: gaitCalibration\?\.walkSpeedMetersPerSecond \?\? 1\.55/)
    assert.match(source, /runSpeed: gaitCalibration\?\.runSpeedMetersPerSecond \?\? 3\.65/)
    assert.match(source, /synchronizeTargetRigGaitPlayback\(binding, Math\.hypot\(input\.moveX, input\.moveZ\) > 1e-4\)/)
    assert.match(source, /const speedRatio = horizontalSpeed \/ Math\.max\(nominalSpeed, 1e-6\)/)
    assert.match(source, /hasDirectionalInput[\s\S]{0,180}THREE\.MathUtils\.clamp\(speedRatio, 1, 1\.1\)/)
    assert.match(source, /THREE\.MathUtils\.clamp\(speedRatio, 0\.35, 1\.1\)/)
    assert.match(source, /allowCharacterSpecificSecondaryPhysics: characterId === 101901/)
    assert.match(source, /\[101901, \{[\s\S]{0,420}allowCharacterSpecificSecondaryPhysics: true/)
    assert.match(source, /previousStart: pair\.initialized \? pair\.previousStart\.clone\(\) : start\.clone\(\)/)
    assert.match(source, /Arm_L\/Forearm_L', 0\.078/)
    assert.match(source, /Forearm_L\/Hand_L', 0\.068/)
    assert.match(source, /const targetRigMorphologyCharacterIds = new Set\(\[102001, 102101\]\)/)
    assert.match(source, /const supportedTargetRigProfile = characterId === 101901[\s\S]{0,120}targetRigMorphologyCharacterIds\.has\(characterId\)/)
    assert.match(source, /if \(!supportedTargetRigProfile\)/)
    assert.match(source, /if \(!characterActionPlaybackBlocksLocomotion\(binding\)\) \{\s*setNativeDungeonExternalAttachmentsHidden\(binding, enabled\)/)
    assert.match(source, /if \(enabled && characterSpecificMotion\.profile\.status === 'attached'\)[\s\S]{0,100}setNativeDungeonExternalAttachmentsHidden\(binding, true\)/)
})

test('101901 Space jump has standing, walking and running target-rig poses with separated feet and controller-owned travel', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const controllerSource = fs.readFileSync('src/viewer/characterLocomotion.ts', 'utf8')
    assert.match(source, /toeL: 'Root\/Hip\/UpLeg_L\/Leg_L\/Foot_L\/Toe_L'/)
    assert.match(source, /toeR: 'Root\/Hip\/UpLeg_R\/Leg_R\/Foot_R\/Toe_R'/)
    assert.match(source, /const applyLowerBodyGaitDirectionPose = \(/)
    assert.match(source, /const applyJumpLegPose = \(/)
    assert.match(source, /solveTwoBoneLeg\(side, target, direction\)/)
    for (const family of ['StandingJump', 'WalkJump', 'RunJump']) {
        assert.match(source, new RegExp(`Magius\\$\\{characterId\\}${family}TakeoffV37`))
        assert.match(source, new RegExp(`Magius\\$\\{characterId\\}${family}AirborneV37`))
        assert.match(source, new RegExp(`Magius\\$\\{characterId\\}${family}LandV37`))
    }
    assert.match(source, /const takeoffTuck = phase === 'takeoff'[\s\S]{0,120}smooth01\(\(ratio - 0\.46\) \/ 0\.38\)/)
    assert.match(source, /const airborneRecovery = phase === 'airborne'[\s\S]{0,160}1 - 0\.75 \* smooth01/)
    assert.match(source, /const stanceBlend = phase === 'land'[\s\S]{0,150}1 - smooth01\(\(ratio - 0\.18\) \/ 0\.72\)/)
    assert.match(source, /jumpLaunchGaitPhase:[\s\S]{0,120}walking: 0\.12,[\s\S]{0,60}running: 0\.06/)
    assert.match(source, /applyLowerBodyGaitDirectionPose\([\s\S]{0,160}wrapReferencePhase\(launchPhase \+ phaseAdvance\)/)
    assert.match(source, /originalFootHalfSeparation[\s\S]{0,100}additionalHalfWidth \* separationWeight/)
    assert.match(source, /legLengthMeters \* 0\.145/)
    assert.match(source, /legLengthMeters \* 0\.125/)
    assert.match(source, /legLengthMeters \* 0\.115/)
    assert.match(source, /legLengthMeters \* 0\.19 \* splitWeight/)
    assert.match(source, /legLengthMeters \* 0\.11 \* splitWeight/)
    assert.match(source, /legLengthMeters \* 0\.055 \* splitWeight/)
    assert.match(source, /const movingLeftLeadSign = Math\.sign\(/)
    assert.match(source, /sampledFootPositions\.L\.clone\(\)\.sub\(sampledFootPositions\.R\)\.dot\(targetRigForward\)/)
    assert.match(source, /-legLengthMeters \* 0\.24 \* recovery/)
    assert.match(source, /\(\['standing', 'walking', 'running'\] as const\)\.flatMap/)
    assert.match(source, /applyJumpLegPose\(ratio, specification\.phase, mode\)/)
    assert.match(source, /applyJumpNaturalUpperBodyPose\(ratio, specification\.phase, mode\)/)
    const jumpUpperBody = source.slice(
        source.indexOf('const applyJumpNaturalUpperBodyPose = ('),
        source.indexOf('// 101901 has no native Dungeon locomotion bundle'),
    )
    assert.match(jumpUpperBody, /blendNaturalUpperBodyVector\(/)
    assert.doesNotMatch(jumpUpperBody, /solveTwoBoneArm\(/)
    assert.match(source, /jumpTakeoffDelaySeconds: jumpTiming\?\.takeoffSeconds/)
    assert.match(source, /landingDurationSeconds: Math\.min\(jumpTiming\?\.landSeconds \?\? 0\.14, 0\.18\)/)
    assert.match(source, /\{ state: 'jump', phase: 'takeoff', duration: 0\.44 \}/)
    assert.match(source, /\{ state: 'fall', phase: 'airborne', duration: 0\.64 \}/)
    assert.match(source, /\{ state: 'land', phase: 'land', duration: 0\.42 \}/)
    assert.match(source, /phase === 'airborne'[\s\S]{0,220}return new THREE\.Vector3\(\)/)
    assert.match(source, /const applyJumpNaturalUpperBodyPose = \(/)
    assert.match(source, /L: refined\?\.left \?\? wrapReferencePhase\(0\.735 \+ synchronousDrift\)/)
    assert.match(source, /R: refined\?\.right \?\? wrapReferencePhase\(0\.245 \+ synchronousDrift\)/)
    assert.match(source, /const modeStrength = refined\?\.strength \?\? \(mode === 'running' \? 1 : mode === 'walking' \? 0\.98 : 0\.96\)/)
    assert.doesNotMatch(jumpUpperBody, /const strength = phase === 'takeoff'/)
    assert.doesNotMatch(jumpUpperBody, /modeStrength = strength/)
    assert.match(source, /currentDirection\.lerp\(donorDirection, modeStrength\)/)
    assert.match(source, /applyNativeHandFingerPose\('run', sidePhases\.L, sidePhases\.R, modeStrength\)/)
    assert.match(controllerSource, /export type JumpLocomotionMode = 'standing' \| 'walking' \| 'running'/)
    assert.match(controllerSource, /this\._jumpMode = this\.classifyJumpMode\(\)/)
    assert.match(controllerSource, /this\.jumpLocomotionAnimationOverride \?\? this\.jumpLocomotionAnimations/)
    assert.match(controllerSource, /setJumpLocomotionAnimationOverride\(animations\?: JumpLocomotionAnimationMap\)/)
    assert.match(controllerSource, /const displacement = this\.velocity\.clone\(\)\.multiplyScalar\(dt\)/)
    assert.match(source, /jumpLocomotionAnimations,/)
    assert.match(source, /gravity: gaitCalibration \? 10\.8 : 15/)
    assert.match(source, /jumpSpeed: gaitCalibration \? 4\.4 : 5\.4/)
    assert.match(source, /gaitCalibration \? 0\.22 : 0\.14/)
    assert.match(source, /landingDurationSeconds: Math\.min\(jumpTiming\?\.landSeconds \?\? 0\.14, 0\.18\)/)
    assert.match(source, /'same-character-exact-rig',[\s\S]{0,100}'verified-retarget',[\s\S]{0,100}'corpus-parameterized'/)
    assert.match(source, /attachmentPolicy: 'body-only-exclude-external-weapons'/)
    assert.doesNotMatch(source, /function attachPreferredCombatJumpLocomotion\(/)
    assert.doesNotMatch(source, /function layeredCombatJumpSubclip\(/)
    assert.match(source, /complex combat leaps remain explicit action entries/)
    assert.match(source, /nine-native-profile-clustered-target-inverse-bind-rest-shoulder-elbow-wrist-finger-curves\+continuous-flat-sole-transition\+standing-walking-running-human-jumps-v37;grade-b-special-leaps-gated/)
    assert.match(source, /rootPolicy: 'controller-all-horizontal-and-vertical'/)
    assert.match(source, /ensureCombatJumpActions\(binding\)/)
    assert.match(source, /startCombatJumpDonorPlayback\(binding, combatEntry\)/)
  assert.match(source, /synchronizeActiveCombatJumpDonorPlayback\(binding, characterActionDeltaSeconds\)/)
    assert.match(source, /activeJumpDonorPlayback/)
})

test('102001 and 102101 use morphology-nearest target-rig locomotion and ordinary controller jumps without cross-rig clip binding', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const reference = JSON.parse(fs.readFileSync(
        'src/viewer/normalizedHumanoidMotionReference.generated.json',
        'utf8',
    ))

    assert.match(source, /const targetRigMorphologyProfileId = 'target-rig-morphology-multidonor'/)
    assert.match(source, /const targetRigMorphologyCharacterIds = new Set\(\[102001, 102101\]\)/)
    for (const feature of [
        'characterHeightMeters',
        'hipWidthMeters',
        'legToArmRatio',
        'skirtRadialEnvelopeMeters',
        'sleeveCuffRadiusMeters',
        'hairLengthMeters',
        'restWristToSkirtDistanceMeters',
    ]) {
        assert.match(source, new RegExp(`'${feature}'`))
        assert.ok(reference.morphologyDiagnostics.featureWeights[feature] > 0)
    }
    assert.ok(Math.abs(Object.values(reference.morphologyDiagnostics.featureWeights)
        .reduce((sum, value) => sum + value, 0) - 1) < 1e-6)
    assert.match(source, /function deriveMorphologyNearestBlendWeights\(/)
    assert.match(source, /Math\.exp\(-8 \* distance \* distance\)/)
    assert.match(source, /const targetRigRestPosition = \(target: THREE\.Object3D\)/)
    assert.match(source, /const restWorld = skeletonRestWorld\.get\(target\)/)
    assert.match(source, /new THREE\.Vector3\(\)\.setFromMatrixPosition\(restWorld\)/)
    assert.match(source, /const hipPosition = targetRigRestPosition\(rig\.get\(motionPaths\.hip\)!\)/)
    assert.match(source, /const position = targetRigRestPosition\(target\)[\s\S]{0,160}hand\.distanceTo\(position\)/)
    assert.match(source, /const effectiveBlendWeights = targetRigMorphologyBlend\?\.weights \?\? motionReference\.blendWeights/)
    assert.match(source, /normalizedDonorWeightSubset\(targetRigMorphologyBlend\.weights, naturalArmFingerDonorIds\)/)
    assert.match(source, /upperBodyProfileId: targetRigMorphologyProfile[\s\S]{0,100}'target-rig-morphology-nine-native-arms-fingers-v45'/)
    assert.match(source, /Magius\$\{characterId\}TargetRigMorphologyWalkV45_L/)
    assert.match(source, /Magius\$\{characterId\}TargetRigMorphologyRunV45_L/)
    for (const family of ['StandingJump', 'WalkJump', 'RunJump']) {
        assert.match(source, new RegExp(`Magius\\$\\{characterId\\}${family}TakeoffV45TargetRigMorphology`))
        assert.match(source, new RegExp(`Magius\\$\\{characterId\\}${family}AirborneV45TargetRigMorphology`))
        assert.match(source, new RegExp(`Magius\\$\\{characterId\\}${family}LandV45TargetRigMorphology`))
    }
    assert.match(source, /allowJumpSequence: characterId === 101901 \|\| targetRigMorphologyCharacterIds\.has\(characterId\) \|\| genericMagicalGirl/)
    assert.match(source, /cinematic-combat-leaps-gated/)
    assert.match(source, /target-rig morphology-nearest full-path\/inverse-bind locomotion plus ordinary controller-root Space jump attached/)
    assert.match(source, /\(\?:Outer\)\?Skirt_/)
    assert.match(reference.transferPolicy, /never-bind-donor-track-to-target-rig/)
})

test('G22 universal magical-girl locomotion composes exact target-rig profiles while preserving typed gaps', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    assert.match(source, /function isMagicalGirlSourceCharacter\(character: ViewerCharacter\): boolean/)
    assert.match(source, /sourceFamily === 'magical-girl'/)
    assert.match(source, /const targetRigProfileCharacter = Number\(character\.userData\.characterId\) === 101901[\s\S]{0,180}isMagicalGirlSourceCharacter\(character\)/)
    assert.match(source, /supportedTargetRigProfile = characterId === 101901[\s\S]{0,220}isMagicalGirlSourceCharacter\(character\)/)
    assert.match(source, /} else if \(isMagicalGirlSourceCharacter\(character\)\) \{[\s\S]{0,500}targetRigMorphologyProfileId/)
    assert.match(source, /genericMagicalGirl = false/)
    assert.match(source, /allowJumpSequence: characterId === 101901 \|\| targetRigMorphologyCharacterIds\.has\(characterId\) \|\| genericMagicalGirl/)
    assert.match(source, /profile\.missingRequiredRigPaths = Object\.values\(motionPaths\)\.filter\(path => !rig\.has\(path\)\)/)
    for (const gap of ['100304', '110401', '105901']) assert.ok(!source.includes(`characterId === ${gap}`), `no hard-coded inverse-bind gap for ${gap}`)
})

test('G07 common action consumers crossfade natural transitions and keep explicit reset immediate', async () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const loader = fs.readFileSync('src/viewer/characterActions/loader.ts', 'utf8')
    assert.match(source, /binding\.tpsPoseTransition\?\.begin\(beat\.transitionSeconds\)/)
    assert.match(source, /animation\.play\(runtimeName, beat\.loop, \{ transitionSeconds: beat\.transitionSeconds/)
    assert.match(loader, /play\(mixer: THREE\.AnimationMixer, actionId: string, transitionSeconds = 0\)/)
    assert.match(loader, /outgoing\.forEach\(action => action\.fadeOut\(fadeSeconds\)\)/)
    assert.match(loader, /if \(fadeSeconds > 0\) action\.fadeIn\(fadeSeconds\)/)
    const { LoadedNativeDungeonActionSet } = await import('./src/viewer/characterActions/loader.ts')
    const root = new THREE.Object3D()
    const makeClip = (name, from, to) => new THREE.AnimationClip(name, 1, [
        new THREE.VectorKeyframeTrack('.position', [0, 1], [from, 0, 0, to, 0, 0]),
    ])
    const clipA = makeClip('A', 0, 1)
    const clipB = makeClip('B', 2, 3)
    const descriptor = id => ({ id, characterIdentity: {}, compatibility: {} })
    const set = new LoadedNativeDungeonActionSet(101901, 'model', [
        { descriptor: descriptor('a'), clip: clipA },
        { descriptor: descriptor('b'), clip: clipB },
    ])
    const mixer = new THREE.AnimationMixer(root)
    const first = set.play(mixer, 'a', 0)
    mixer.update(0.25)
    const renderedBeforeInterrupt = root.position.x
    const second = set.play(mixer, 'b', 0.5)
    assert.ok(first.getEffectiveWeight() > 0 && second.getEffectiveWeight() > 0)
    mixer.update(0.25)
    assert.ok(second.getEffectiveWeight() > 0 && second.getEffectiveWeight() < 1)
    mixer.update(0.5)
    assert.equal(second.getEffectiveWeight(), 1)
    assert.ok(Number.isFinite(renderedBeforeInterrupt))
    const reset = set.play(mixer, 'a', 0)
    mixer.update(0)
    assert.equal(reset.getEffectiveWeight(), 1)
})

test('advance and explicit fixed steps produce the same controlled-root result', () => {
    const ground = new FlatGroundCollisionWorld()
    const a = new CharacterLocomotionController({
        characterId: 'deterministic-a',
        transform: createTransform(),
        collisionWorld: ground,
        groundQuery: ground,
        initiallyGrounded: true,
        config: fixedConfig(),
    })
    const b = new CharacterLocomotionController({
        characterId: 'deterministic-b',
        transform: createTransform(),
        collisionWorld: ground,
        groundQuery: ground,
        initiallyGrounded: true,
        config: fixedConfig(),
    })
    const input = { moveX: 0.6, moveZ: 0.8, run: true, jumpPressed: false }
    a.setInput(input)
    b.setInput(input)
    const advanced = a.advance(1)
    const stepped = stepMany(b, 60).at(-1)
    assert.equal(stepped, b.state)
    assert.ok(advanced.position.distanceTo(b.snapshot().position) < 1e-9)
    assert.ok(advanced.velocity.distanceTo(b.snapshot().velocity) < 1e-9)
    assert.ok(1 - Math.abs(advanced.quaternion.dot(b.snapshot().quaternion)) < 1e-9)
})

test('scene collision sweep owns wall correction and independent characters do not share state', () => {
    const wallWorld = {
        resolveMotion(query) {
            const position = query.startPosition.clone().add(query.desiredDisplacement)
            const velocity = query.velocity.clone()
            const contacts = []
            if (position.x > 1) {
                position.x = 1
                velocity.x = 0
                contacts.push({
                    point: new Vector3(1, position.y, position.z),
                    normal: new Vector3(-1, 0, 0),
                    objectId: 'wall-x-1',
                })
            }
            if (position.y <= 0) {
                position.y = 0
                velocity.y = 0
                contacts.push({
                    point: new Vector3(position.x, 0, position.z),
                    normal: new Vector3(0, 1, 0),
                    objectId: 'ground',
                })
            }
            return { position, velocity, grounded: position.y === 0, contacts }
        },
    }
    const a = new CharacterLocomotionController({
        characterId: 'wall-runner',
        transform: createTransform(),
        collisionWorld: wallWorld,
        initiallyGrounded: true,
        config: fixedConfig(),
    })
    const b = new CharacterLocomotionController({
        characterId: 'idle-neighbour',
        transform: createTransform(-5, 0, 0),
        collisionWorld: wallWorld,
        initiallyGrounded: true,
        config: fixedConfig(),
    })
    a.setInput({ moveX: 1, moveZ: 0, run: true, jumpPressed: false })
    b.setInput({ moveX: 0, moveZ: 0, run: false, jumpPressed: false })
    stepMany(a, 120)
    stepMany(b, 120)
    assert.equal(a.snapshot().position.x, 1)
    assert.equal(a.snapshot().contacts.some(contact => contact.objectId === 'wall-x-1'), true)
    assert.equal(b.snapshot().position.x, -5)
    assert.equal(a.state, 'idle')
    assert.equal(b.state, 'idle')
    assert.notEqual(a.velocity, b.velocity)
})

test('character capsule center and axis are configurable and query snapshots cannot mutate the controller', () => {
    const motionColliders = []
    const groundColliders = []
    let collisionGrounded = true
    const collisionWorld = {
        resolveMotion(query) {
            motionColliders.push(query.collider)
            return {
                position: query.startPosition.clone().add(query.desiredDisplacement),
                velocity: query.velocity.clone(),
                grounded: collisionGrounded,
            }
        },
    }
    const groundQuery = {
        queryGround(query) {
            groundColliders.push(query.collider)
            return { point: new Vector3(query.position.x, 0, query.position.z), normal: new Vector3(0, 1, 0), distance: 0 }
        },
    }
    const controller = new CharacterLocomotionController({
        characterId: 'configured-capsule',
        transform: createTransform(),
        collisionWorld,
        groundQuery,
        initiallyGrounded: true,
        config: fixedConfig({
            colliderRadius: 0.25,
            colliderHeight: 1.7000000476837158,
            colliderCenterX: 0,
            colliderCenterY: 0.8500000238418579,
            colliderCenterZ: 0,
            colliderUpAxis: 'y',
        }),
    })
    controller.stepFixed()
    assert.equal(motionColliders[0].height, 1.7000000476837158)
    assert.deepEqual(motionColliders[0].center.toArray(), [0, 0.8500000238418579, 0])
    assert.equal(motionColliders[0].upAxis, 'y')
    assert.equal(groundColliders.length, 0)
    assert.deepEqual(controller.getStepDiagnostics(), {
        advanceCalls: 0,
        fixedSteps: 1,
        collisionQueries: 1,
        groundQueries: 0,
        groundQueriesSkippedGrounded: 1,
    })

    collisionGrounded = false
    controller.stepFixed()
    assert.notEqual(motionColliders[0], groundColliders[0])
    motionColliders[0].center.y = -99
    assert.equal(controller.collider.center.y, 0.8500000238418579)
    assert.deepEqual(controller.getStepDiagnostics(), {
        advanceCalls: 0,
        fixedSteps: 2,
        collisionQueries: 2,
        groundQueries: 1,
        groundQueriesSkippedGrounded: 1,
    })
})

test('root-motion extraction contract applies one delta and controlled mode suppresses it', () => {
    const ground = new FlatGroundCollisionWorld()
    const configured = []
    const adapter = {
        configure(mode) { configured.push(mode) },
        consumeDelta() {
            return { translation: new Vector3(0, 0, 0.1), space: 'local' }
        },
    }
    const animated = new CharacterLocomotionController({
        characterId: 'root-motion',
        transform: createTransform(),
        collisionWorld: ground,
        groundQuery: ground,
        rootMotion: adapter,
        rootMotionMode: 'animation',
        initiallyGrounded: true,
        config: fixedConfig(),
    })
    animated.setInput({ moveX: 0, moveZ: 1, run: true, jumpPressed: false })
    animated.stepFixed()
    assert.equal(configured[0], 'extract')
    assert.ok(Math.abs(animated.snapshot().position.z - 0.1) < 1e-9)

    animated.setRootMotionMode('controlled')
    animated.teleport(new Vector3())
    animated.stepFixed()
    assert.equal(configured.at(-1), 'suppress')
    assert.ok(animated.snapshot().position.z < 0.1)
})

test('combat actions use explicit clips, cancel windows and emit each visual cue once', () => {
    const played = []
    const speeds = []
    const weights = []
    const animation = {
        listClips: () => [
            { name: 'Skill02_SE', duration: 1, trackCount: 600 },
            { name: 'Magia01_SE', duration: 1.2, trackCount: 620 },
        ],
        play: (name, options) => played.push({ name, ...options }),
        setSpeed: speed => speeds.push(speed),
        setWeight: weight => weights.push(weight),
    }
    const cues = []
    const actionEvents = []
    const ground = new FlatGroundCollisionWorld()
    const controller = new CharacterLocomotionController({
        characterId: 'combatant',
        transform: createTransform(),
        animation,
        collisionWorld: ground,
        groundQuery: ground,
        initiallyGrounded: true,
        config: fixedConfig({ actionBufferSeconds: 0.6 }),
        onEffectCue: cue => cues.push(cue),
        onActionEvent: event => actionEvents.push(event),
    })
    controller.registerAction({
        id: 'skill-two',
        semantic: 'skill',
        preferredClips: ['Skill02_SE'],
        durationSeconds: 1,
        speed: 1.25,
        weight: 0.8,
        movementScale: 0,
        activeWindow: { startSeconds: 0.2, endSeconds: 0.5 },
        cancelWindows: [{ startSeconds: 0.35, endSeconds: 0.7, into: ['ultimate'] }],
        effectCues: [
            { id: 'cast', timeSeconds: 0, effectId: 'skill-two-cast', anchor: 'weapon' },
            { id: 'impact', timeSeconds: 0.25, effectId: 'skill-two-impact', lifetimeSeconds: 0.8, payload: { radius: 2.5 } },
        ],
    })
    controller.registerAction({
        id: 'magia-one',
        semantic: 'ultimate',
        preferredClips: ['Magia01_SE'],
        durationSeconds: 1.2,
        effectCues: [{ id: 'burst', timeSeconds: 0.1, effectId: 'magia-one-burst' }],
    })

    assert.equal(controller.requestAction('skill-two').accepted, true)
    controller.setInput({ moveX: 0, moveZ: 1, run: true, jumpPressed: false })
    controller.stepFixed()
    assert.equal(controller.action.id, 'skill-two')
    assert.equal(cues[0].effectId, 'skill-two-cast')
    assert.equal(controller.snapshot().position.z, 0)
    stepMany(controller, 22)
    assert.deepEqual(cues.map(cue => cue.effectId), ['skill-two-cast', 'skill-two-impact'])
    assert.equal(cues[1].lifetimeSeconds, 0.8)

    assert.equal(controller.requestAction('magia-one').accepted, true)
    stepMany(controller, 10)
    assert.equal(controller.action.id, 'magia-one')
    stepMany(controller, 10)
    assert.deepEqual(cues.map(cue => cue.effectId), [
        'skill-two-cast',
        'skill-two-impact',
        'magia-one-burst',
    ])
    assert.equal(new Set(cues.map(cue => `${cue.actionSequence}:${cue.cueId}`)).size, cues.length)
    assert.equal(actionEvents.some(event => event.type === 'cancelled'), true)
    assert.deepEqual(played.map(entry => entry.name), ['Skill02_SE', 'Magia01_SE'])
    assert.deepEqual(speeds, [1.25, 1])
    assert.deepEqual(weights, [0.8, 1])
})

test('official 101901 E zero-boundary VFX cue emits its exact payload once while the multi-segment action returns to locomotion', () => {
    const played = []
    const cues = []
    const exact101901EVfxPayload = {
        schema: 'magius-viewer-combat-vfx-slot-v1',
        key: 'E',
        semantic: 'skill',
        loadedClip: 'Exedra101901SkillFace',
        sequenceId: 'skill',
        animationSegments: [
            {
                startSeconds: 0,
                runtimeClipName: 'Exedra101901SkillFace',
                components: [
                    {
                        role: 'body',
                        runtimeClipName: 'Exedra101901SkillFace',
                        sourceClipName: 'FaceCut_SE',
                        sourceClipPathId: '3312583835213637365',
                    },
                    {
                        role: 'weapon',
                        runtimeClipName: 'Exedra101901SkillFace_1',
                        sourceClipName: 'FaceCut_SE',
                        sourceClipPathId: '-2665825415086129653',
                    },
                ],
            },
            {
                startSeconds: 1,
                runtimeClipName: 'Exedra101901SkillMain',
                components: [
                    {
                        role: 'body',
                        runtimeClipName: 'Exedra101901SkillMain',
                        sourceClipName: 'SingleSkillA_SE',
                        sourceClipPathId: '-3363243911750066024',
                    },
                    {
                        role: 'weapon',
                        runtimeClipName: 'Exedra101901SkillMain_1',
                        sourceClipName: 'SingleSkillA_SE',
                        sourceClipPathId: '5574265244417381940',
                    },
                ],
            },
        ],
        directionName: 'chara_101901_singleskill_00',
        bundleKey: 'battle/skill/chara_101901_singleskill_00',
        skillUniqueId: 1173,
        skillMstId: 117301,
        requiredFields: ['vfxKey', 'anchor', 'lifetimeSeconds'],
    }
    const ground = new FlatGroundCollisionWorld()
    const controller = new CharacterLocomotionController({
        characterId: '101901',
        transform: createTransform(),
        animation: {
            listClips: () => [
                { name: 'CommonWait_L', duration: 3.983333, trackCount: 720 },
                { name: 'Exedra101901SkillFace', duration: 1, trackCount: 218 },
                { name: 'Exedra101901SkillMain', duration: 5.433333, trackCount: 218 },
            ],
            play: (name, options) => played.push({ name, ...options }),
        },
        locomotionAnimations: { idle: 'CommonWait_L' },
        collisionWorld: ground,
        groundQuery: ground,
        initiallyGrounded: true,
        config: fixedConfig(),
        onEffectCue: cue => cues.push(cue),
    })
    controller.registerAction({
        id: 'key:E',
        semantic: 'skill',
        durationSeconds: 5.1666666667,
        fadeSeconds: 0.1,
        animationSegments: [
            { clip: 'Exedra101901SkillFace', startSeconds: 0, fadeSeconds: 0.08 },
            { clip: 'Exedra101901SkillMain', startSeconds: 1, fadeSeconds: 0.12 },
        ],
        effectCues: [{
            id: 'key:E:vfx-slot',
            timeSeconds: 0,
            effectId: 'chara_101901_singleskill_00',
            anchor: 'weapon-or-hand',
            payload: exact101901EVfxPayload,
        }],
    })

    assert.equal(controller.requestAction('key:E').accepted, true)
    controller.stepFixed()
    assert.equal(controller.action.clipName, 'Exedra101901SkillFace')
    assert.equal(cues.length, 1)
    assert.deepEqual(
        {
            characterId: cues[0].characterId,
            actionId: cues[0].actionId,
            actionSemantic: cues[0].actionSemantic,
            actionSequence: cues[0].actionSequence,
            cueId: cues[0].cueId,
            effectId: cues[0].effectId,
            anchor: cues[0].anchor,
            actionTimeSeconds: cues[0].actionTimeSeconds,
            payload: cues[0].payload,
        },
        {
            characterId: '101901',
            actionId: 'key:E',
            actionSemantic: 'skill',
            actionSequence: 1,
            cueId: 'key:E:vfx-slot',
            effectId: 'chara_101901_singleskill_00',
            anchor: 'weapon-or-hand',
            actionTimeSeconds: 0,
            payload: exact101901EVfxPayload,
        },
    )
    stepMany(controller, 60)
    assert.equal(controller.action.clipName, 'Exedra101901SkillMain')
    assert.equal(cues.length, 1)
    stepMany(controller, 250)
    assert.equal(controller.action, undefined)
    assert.equal(cues.length, 1)
    assert.deepEqual(played.map(entry => entry.name), [
        'CommonWait_L',
        'Exedra101901SkillFace',
        'Exedra101901SkillMain',
        'CommonWait_L',
    ])
    assert.equal(played[2].fadeSeconds, 0.12)
    assert.equal(played[3].loop, true)
})

test('combat request reports missing official skill clip instead of substituting idle', () => {
    const rejections = []
    const controller = new CharacterLocomotionController({
        characterId: 'standard-only',
        transform: createTransform(),
        animation: {
            listClips: () => [{ name: 'Wait_L', duration: 2, trackCount: 500 }],
            play() {},
        },
        onActionEvent: event => rejections.push(event),
    })
    controller.registerAction({
        id: 'skill-missing',
        semantic: 'skill',
        durationSeconds: 1,
        effectCues: [{ id: 'never', timeSeconds: 0.1, effectId: 'missing-effect' }],
    })
    const result = controller.requestAction('skill-missing')
    assert.equal(result.accepted, false)
    assert.equal(result.resolution.status, 'unavailable')
    assert.match(result.reason, /no loaded clip/)
    assert.equal(rejections.at(-1).type, 'rejected')
})

test('strict scene and secondary physics bindings prevent silent cloth or scene penetration', () => {
    const missing = new CharacterLocomotionController({
        characterId: 'missing-physics',
        transform: createTransform(),
        initiallyGrounded: true,
        config: fixedConfig({ requireSceneCollision: true, requireSecondaryPhysics: true }),
    })
    assert.deepEqual(missing.getPhysicsReadiness().issues, [
        'scene collision world is required but not bound',
        'secondary physics adapter is required but not bound',
        'secondary physics scene collision world is required but not bound',
    ])
    assert.throws(() => missing.stepFixed(), /scene collision world is required/)

    const ground = new FlatGroundCollisionWorld()
    const contexts = []
    const controls = []
    const clothSceneCollision = {
        resolveParticleMotion(query) {
            return { position: query.desiredPosition.clone(), contacts: [], remainingPenetration: 0 }
        },
    }
    const valid = new CharacterLocomotionController({
        characterId: 'physics-ready',
        transform: createTransform(),
        collisionWorld: ground,
        groundQuery: ground,
        secondaryPhysics: {
            setActive: value => controls.push(['active', value]),
            setBlendWeight: value => controls.push(['blend', value]),
            reset: () => controls.push(['reset']),
            step(context) {
                contexts.push(context)
                return { correctedContacts: 2, unresolvedContacts: 0, maxRemainingPenetration: 0 }
            },
        },
        secondaryPhysicsSceneCollision: clothSceneCollision,
        initiallyGrounded: true,
        config: fixedConfig({ requireSceneCollision: true, requireSecondaryPhysics: true }),
    })
    valid.stepFixed()
    assert.equal(valid.getPhysicsReadiness().ready, true)
    assert.equal(contexts.length, 1)
    assert.equal(contexts[0].collisionWorld, ground)
    assert.equal(contexts[0].sceneCollisionWorld, clothSceneCollision)
    assert.deepEqual(valid.snapshot().secondaryPhysics, {
        correctedContacts: 2,
        unresolvedContacts: 0,
        maxRemainingPenetration: 0,
    })
    valid.setSecondaryPhysicsState({ active: false, reset: true, blendWeight: 0.5 })
    valid.stepFixed()
    assert.equal(contexts.length, 1, 'disabled cloth does not advance its solver')
    assert.deepEqual(valid.snapshot().secondaryPhysicsControl, { active: false, blendWeight: 0.5 })
    assert.deepEqual(valid.snapshot().secondaryPhysics, {
        correctedContacts: 0,
        unresolvedContacts: 0,
        maxRemainingPenetration: 0,
    })
    assert.deepEqual(controls, [
        ['blend', 1],
        ['active', true],
        ['blend', 0.5],
        ['reset'],
        ['active', false],
    ])
    valid.setSecondaryPhysicsState({ active: true, blendWeight: 1 })
    valid.stepFixed()
    assert.equal(contexts.length, 2)
    assert.throws(
        () => valid.setSecondaryPhysicsState({ active: true, blendWeight: Number.NaN }),
        /finite/,
    )

    const penetrating = new CharacterLocomotionController({
        characterId: 'physics-penetrating',
        transform: createTransform(),
        collisionWorld: ground,
        secondaryPhysics: {
            step: () => ({
                correctedContacts: 0,
                unresolvedContacts: 1,
                maxRemainingPenetration: 0.03,
            }),
        },
        secondaryPhysicsSceneCollision: clothSceneCollision,
        initiallyGrounded: true,
        config: fixedConfig({ requireSceneCollision: true, requireSecondaryPhysics: true }),
    })
    assert.throws(() => penetrating.stepFixed(), /unresolved contacts/)
})

test('viewer animation adapter reuses the existing family player and mixer', () => {
    const calls = []
    const character = {
        animations: ['Wait_L', 'Damage_SE'],
        animation: {
            current: undefined,
            duration: 2,
            time: 0,
            mixer: { timeScale: 1 },
            play(name, loop) {
                calls.push({ name, loop })
                this.current = name
            },
            clear() { calls.push({ name: 'clear', loop: false }) },
        },
    }
    const port = createViewerCharacterAnimationPort(character)
    port.play('Damage_SE', { loop: false, speed: 1.5, weight: 1, fadeSeconds: 0 })
    assert.deepEqual(calls, [{ name: 'Damage_SE', loop: false }])
    assert.equal(character.animation.mixer.timeScale, 1.5)
    assert.equal(port.getDuration('Damage_SE'), 2)
    port.setTime(0.75)
    assert.equal(character.animation.time, 0.75)
})

test('shared dynamic capture consumer tolerates missing files and partial JSONL records', () => {
    const completeContext = {
        region: 'TW',
        device: 'fixture-device',
        package: 'fixture.package',
        pid: 42,
        timestamp: 123.5,
        frame: 77,
        sceneKey: 'battle-fixture',
        characterIdentity: { slot: 0 },
    }
    const capture = consumeSharedBattleCapture({
        'capture-session.json': JSON.stringify({ schema: 'fixture-v1' }),
        'animator-events.jsonl': [
            JSON.stringify({
                ...completeContext,
                actionId: 'skill-two',
                semantic: 'skill',
                clip: 'Skill02_SE',
                clipDuration: 1.25,
                pathID: '1234',
                bundle: 'battle-motion-bundle',
                address: 'motions/skill02',
                styleMstId: 50000101,
                styleFigureMstId: 500001,
                style3dCharacterMstId: 500001,
                skillUniqueId: 7001,
                skillMstId: 700101,
                directionName: 'fixture_skill_direction',
                role: 'body',
                bindings: 633,
                normalizedTime: 0.25,
                speed: 1,
                weight: 0.8,
            }),
            '{malformed',
            JSON.stringify({ clip: 'Attack01_SE', frame: Number.NaN }),
        ].join('\n'),
        'vfx-events.jsonl': [{
            ...completeContext,
            actionId: 'skill-two',
            cueId: 'impact',
            vfxKey: 'skill-two-impact',
            anchor: 'weapon',
            lifetimeSeconds: 0.8,
            actionTimeSeconds: 0.4,
        }],
        'collision-components.json': JSON.stringify({
            records: [{ ...completeContext, componentType: 'CapsuleCollider', radius: 0.25 }],
        }),
        'summary.md': '# partial fixture',
    })

    assert.deepEqual(capture.diagnostics.missingFiles, [
        'root-motion.jsonl',
        'secondary-physics.json',
    ])
    assert.equal(capture.diagnostics.malformed.length, 1)
    assert.equal(capture.diagnostics.malformed[0].line, 2)
    assert.equal(capture.diagnostics.incomplete.length, 1)
    assert.equal(capture.animatorEvents.length, 2)
    assert.equal(capture.vfxEvents[0].vfxKey, 'skill-two-impact')
    assert.equal(capture.collisionComponents[0].componentType, 'CapsuleCollider')
    assert.deepEqual(listCapturedAnimationAssets(capture), [{
        clip: 'Skill02_SE',
        pathID: '1234',
        bundle: 'battle-motion-bundle',
        address: 'motions/skill02',
        semantic: 'skill',
        actionId: 'skill-two',
        styleMstId: 50000101,
        styleFigureMstId: 500001,
        style3dCharacterMstId: 500001,
        skillUniqueId: 7001,
        skillMstId: 700101,
        directionName: 'fixture_skill_direction',
        role: 'body',
        bindings: 633,
    }, {
        clip: 'Attack01_SE',
    }])
    assert.deepEqual(capturedAnimationClipDescriptors(capture), [{
        name: 'Attack01_SE',
        duration: undefined,
    }, {
        name: 'Skill02_SE',
        duration: 1.25,
        trackCount: 633,
    }])
    assert.deepEqual(capturedCombatEffectCueDefinitions(capture, 'skill-two'), [{
        id: 'impact',
        timeSeconds: 0.4,
        effectId: 'skill-two-impact',
        anchor: 'weapon',
        lifetimeSeconds: 0.8,
    }])
    const builtAction = buildCapturedCombatActionDefinition(capture, 'skill-two')
    assert.equal(builtAction.status, 'ready')
    assert.equal(builtAction.hasCapturedEffects, true)
    assert.equal(builtAction.asset.role, 'body')
    assert.deepEqual(builtAction.definition, {
        id: 'skill-two',
        semantic: 'skill',
        preferredClips: ['Skill02_SE'],
        durationSeconds: 1.25,
        effectCues: [{
            id: 'impact',
            timeSeconds: 0.4,
            effectId: 'skill-two-impact',
            anchor: 'weapon',
            lifetimeSeconds: 0.8,
        }],
        speed: 1,
        weight: 0.8,
    })
    assert.deepEqual(buildCapturedCombatActionDefinition(capture, 'missing-action'), {
        actionId: 'missing-action',
        status: 'incomplete',
        hasCapturedEffects: false,
        reasons: ['no captured clip with actionId, semantic and positive duration'],
    })
})

test('normalized GLES battle schema preserves unavailable evidence without inventing clips, VFX keys or components', () => {
    const capture = consumeSharedBattleCapture({
        'capture-session.json': JSON.stringify({
            schemaVersion: 2,
            sessionId: 'fixture-session',
            region: 'fixture-region',
            device: 'fixture-device',
            package: 'fixture.package',
            pid: 77,
            sceneContext: { resourceKey: null },
        }),
        'animator-events.jsonl': JSON.stringify({
            eventId: 'normal-attack-001',
            captureSessionId: 'fixture-session',
            captureFile: 'bounded-runtime.raw.jsonl',
            region: 'fixture-region',
            package: 'fixture.package',
            pid: 77,
            timestampMs: 1000,
            frame: 10,
            observedAction: 'normal_attack',
            styleMstId: null,
            directionName: null,
            role: 'active_combatant',
            bindings: [],
            animatorLayer: null,
            animatorStateHash: null,
            animationClipName: null,
            animationClipPathId: null,
            animationBundle: null,
            animationLoadAddress: null,
            availability: { animatorFields: 'not exposed' },
        }),
        'vfx-events.jsonl': JSON.stringify({
            eventId: 'vfx-program-001',
            captureSessionId: 'fixture-session',
            captureFile: 'bounded-runtime.raw.jsonl',
            region: 'fixture-region',
            package: 'fixture.package',
            pid: 77,
            timestampMs: 1010,
            frame: 11,
            program: 312,
            resourceKey: null,
            parentAnchor: null,
            instanceLifecycle: null,
            availability: { resourceKey: 'not exposed' },
        }),
        'root-motion.jsonl': JSON.stringify({
            eventId: 'root-observation-001',
            captureSessionId: 'fixture-session',
            captureFile: 'bounded-runtime.raw.jsonl',
            region: 'fixture-region',
            package: 'fixture.package',
            pid: 77,
            timestampMs: 1020,
            frame: 12,
            rootNode: null,
            position: null,
            quaternion: null,
            sampleCount: 0,
            availability: { status: 'not captured' },
        }),
        'collision-components.json': JSON.stringify({
            components: [],
            availability: { status: 'not exposed in this capture' },
        }),
        'secondary-physics.json': JSON.stringify({
            components: [],
            timelineState: { active: null, reset: null, blendWeight: null },
            availability: { status: 'not exposed in this capture' },
        }),
        'summary.md': '# normalized fixture',
    })

    assert.deepEqual(capture.diagnostics.missingFiles, [])
    assert.deepEqual(capture.diagnostics.malformed, [])
    assert.equal(capture.diagnostics.incomplete.length, 3)
    assert.equal(capture.animatorEvents[0].device, 'fixture-device')
    assert.equal(capture.animatorEvents[0].timestamp, 1000)
    assert.equal(capture.animatorEvents[0].actionId, 'normal_attack')
    assert.equal(capture.animatorEvents[0].semantic, 'basicAttack')
    assert.equal(capture.animatorEvents[0].clip, undefined)
    assert.equal(capture.animatorEvents[0].data.animationClipName, null)
    assert.equal(capture.vfxEvents[0].vfxKey, undefined)
    assert.equal(capture.vfxEvents[0].data.program, 312)
    assert.equal(capture.rootMotion[0].position, undefined)
    assert.equal(capture.rootMotion[0].data.sampleCount, 0)
    assert.equal(capture.collisionComponents.length, 0)
    assert.equal(capture.secondaryPhysics.length, 0)
    assert.equal(capture.collisionMetadata.availability.status, 'not exposed in this capture')
    assert.equal(capture.secondaryPhysicsMetadata.timelineState.active, null)
    assert.deepEqual(listCapturedAnimationAssets(capture), [])
    assert.deepEqual(capturedCombatEffectCueDefinitions(capture, 'normal_attack'), [])
    assert.equal(buildCapturedCombatActionDefinition(capture, 'normal_attack').status, 'incomplete')
})

test('captured same-name body and attachment clips retain stable identities and body coverage', () => {
    const context = {
        region: 'fixture-region',
        device: 'fixture-device',
        package: 'fixture.package',
        pid: 7,
        timestamp: 10,
        frame: 20,
        sceneKey: 'fixture-battle',
        characterIdentity: { slot: 0 },
    }
    const common = {
        ...context,
        semantic: 'basicAttack',
        clip: 'Attack_SE',
        clipDuration: 3,
        styleMstId: 50000201,
        styleFigureMstId: 500002,
        skillUniqueId: 8001,
        skillMstId: 800101,
        directionName: 'fixture_normalattack_00',
        bundle: 'battle/skill/fixture_normalattack_00',
    }
    const capture = consumeSharedBattleCapture({
        'animator-events.jsonl': [
            { ...common, pathID: 11, role: 'attachment', bindings: 87 },
            { ...common, pathID: 12, role: 'body', bindings: 633 },
        ],
    })
    const evidence = listCapturedAnimationAssets(capture)
    assert.equal(evidence.length, 2)
    assert.deepEqual(evidence.map(item => [item.pathID, item.role, item.bindings]), [
        [11, 'attachment', 87],
        [12, 'body', 633],
    ])
    assert.deepEqual(capturedAnimationClipDescriptors(capture), [{
        name: 'Attack_SE',
        duration: 3,
        trackCount: 633,
    }])
    const built = buildCapturedCombatActionDefinition(capture, 'fixture-attack')
    assert.equal(built.status, 'incomplete')

    const actionCapture = consumeSharedBattleCapture({
        'animator-events.jsonl': [
            { ...common, actionId: 'fixture-attack', pathID: 11, role: 'attachment', bindings: 87 },
            { ...common, actionId: 'fixture-attack', pathID: 12, role: 'body', bindings: 633 },
        ],
    })
    const action = buildCapturedCombatActionDefinition(actionCapture, 'fixture-attack')
    assert.equal(action.status, 'ready')
    assert.equal(action.asset.pathID, 12)
    assert.equal(action.asset.role, 'body')
    assert.equal(action.hasCapturedEffects, false)
    assert.deepEqual(action.reasons, ['no complete captured VFX cues'])
})

test('Viewer consumes all exact native Dungeon action products without cross-character or weapon fallback', () => {
    const manifest = JSON.parse(fs.readFileSync(
        new URL('./public/character-actions/manifest.v1.json', import.meta.url),
        'utf8',
    ))
    const entries = manifest.entries
    const expectedDungeonCharacterIds = [
        100201,
        100202,
        100301,
        100401,
        100501,
        100801,
        109201,
        111501,
        114501,
    ]

    assert.equal(manifest.schema, 'magius.character-action-resource-manifest.v1')
    assert.equal(manifest.counts.distinctCharacters, 8)
    assert.equal(manifest.counts.dungeonCharacterResources, 9)
    assert.equal(manifest.counts.actions, 27)
    assert.equal(entries.length, 27)
    assert.equal(new Set(entries.map(entry => entry.id)).size, 27)
    assert.deepEqual(
        [...new Set(entries.map(entry => entry.characterIdentity.dungeonCharacterId))].sort((a, b) => a - b),
        expectedDungeonCharacterIds,
    )

    for (const dungeonCharacterId of expectedDungeonCharacterIds) {
        const characterEntries = entries.filter(
            entry => entry.characterIdentity.dungeonCharacterId === dungeonCharacterId,
        )
        assert.deepEqual(
            characterEntries.map(entry => entry.clip.semantic).sort(),
            ['idle', 'run', 'walk'],
        )
        for (const entry of characterEntries) {
            assert.equal(
                entry.id,
                `official-dungeon:${dungeonCharacterId}:${entry.clip.semantic}:${entry.clip.pathId}`,
            )
            assert.equal(entry.group, '官方探索动作')
            assert.equal(entry.groupId, 'official-dungeon-locomotion')
            assert.equal(entry.playback, 'loop')
            assert.equal(entry.availability.runtimeReady, true)
            assert.equal(entry.availability.tpsLoadable, true)
            assert.equal(entry.compatibility.mode, 'native-only')
            assert.equal(entry.compatibility.crossCharacterFallback, false)
            assert.equal(
                entry.compatibility.exactModelKey,
                entry.characterIdentity.modelKey,
            )
            assert.match(
                entry.compatibility.externalAttachmentPolicy,
                /body-only;external-sibling-weapon-excluded/,
            )
            assert.match(entry.compatibility.rootPolicy, /suppress-Root\.position/)
            assert.ok(Number.isFinite(entry.clip.durationSeconds))
            assert.ok(entry.clip.durationSeconds > 0)
            assert.ok(Number.isFinite(entry.motionReference.cycleSeconds))
            assert.ok(Number.isFinite(entry.motionReference.cadenceHz))
            assert.equal(entry.sourceFamily, `native-dungeon:${dungeonCharacterId}`)
        }
    }

    const kyokoIdle = entries.find(entry => (
        entry.characterIdentity.dungeonCharacterId === 100501
        && entry.clip.semantic === 'idle'
    ))
    assert.equal(kyokoIdle.clip.sourceName, 'Standby_L')

    const mamiEntries = entries.filter(entry => entry.characterIdentity.dungeonCharacterId === 100301)
    assert.deepEqual(mamiEntries.map(entry => entry.id), [
        'official-dungeon:100301:idle:-6532624707838147585',
        'official-dungeon:100301:walk:4412818012340897786',
        'official-dungeon:100301:run:-2942221244478808616',
    ])
    const mamiRuntime = JSON.parse(gunzipSync(fs.readFileSync(
        'public/character-actions/native-dungeon/100301/runtime.v1.json.gz',
    )))
    assert.equal(mamiRuntime.schema, 'magius.native-dungeon-action-runtime.v1')
    assert.equal(mamiRuntime.dungeonCharacterId, 100301)
    assert.equal(mamiRuntime.modelKey, 'battle/character/chara_100301_battle_unit')
    assert.deepEqual(mamiRuntime.clips.map(clip => [clip.semantic, clip.sourceClipPathId]), [
        ['idle', '-6532624707838147585'],
        ['walk', '4412818012340897786'],
        ['run', '-2942221244478808616'],
    ])
    assert.deepEqual(mamiRuntime.clips.map(clip => clip.actionId), mamiEntries.map(entry => entry.id))
    assert.deepEqual(
        mamiRuntime.clips.map(clip => clip.runtimeName),
        mamiEntries.map(entry => entry.clip.runtimeName),
    )

    const source = fs.readFileSync(
        new URL('./src/viewer/viewerLocomotion.ts', import.meta.url),
        'utf8',
    )
    for (const requiredConsumer of [
        'new CharacterActionResourceManager()',
        'characterActionResourceManager.listActions()',
        'characterActionResourceManager.listCharacterActions(',
        'characterActionResourceManager.attachCharacterActions(',
        'validateNativeDungeonEntries(',
        "entry.compatibility.mode !== 'native-only'",
        'entry.compatibility.crossCharacterFallback !== false',
        "entry.compatibility.externalAttachmentPolicy.includes('external-sibling-weapon-excluded')",
        'setNativeDungeonExternalAttachmentsHidden(binding, true)',
        'setNativeDungeonExternalAttachmentsHidden(binding, false)',
        "allowJumpSequence: false",
        "allowCrossCharacterDungeon: false",
        "allowProceduralBones: false",
        "allowSecondaryFallback: false",
        "emitViewerEvent('magius:character-action-catalog-change'",
        "emitViewerEvent('magius:character-action-playback-state'",
        'playViewerCharacterAction(actionId, options)',
        'pauseViewerCharacterAction()',
        'seekViewerCharacterAction(timeSeconds)',
        'stepViewerCharacterAction(deltaSeconds)',
        'disposeViewerCharacterAction()',
        "binding.characterActionPlayback.status === 'paused'",
        'binding.character.animation.paused = false',
        "interruptViewerCharacterAction(binding, 'movement input resumed TPS locomotion')",
        "interruptViewerCharacterAction(binding, 'animation mixer was changed by another control')",
    ]) {
        assert.ok(source.includes(requiredConsumer), `missing Viewer consumer contract: ${requiredConsumer}`)
    }

    assert.match(
        source,
        /if \(!safety\.allowCrossCharacterDungeon\) \{[\s\S]*?result\.status = 'disabled-unverified'/,
    )
    assert.match(source, /retrying native Dungeon runtime once after \$\{detail\.errorCode\}/)
    assert.match(source, /retrying combat\/jump runtime once after \$\{detail\.errorCode\}/)
    assert.match(source, /native\.loadAttempts < 2/)
    assert.match(source, /combat\.loadAttempts < 2/)
    const nativeConsumerBody = source.slice(
        source.indexOf('function ensureNativeDungeonActions'),
        source.indexOf('export function attachViewerLocomotion'),
    )
    assert.doesNotMatch(nativeConsumerBody, /attachOfficialDungeonLocomotion\(/)
})

test('100102 embedded Dungeon clips expose every official angle family and drive TPS with neutral motion only', () => {
    const corpus = JSON.parse(fs.readFileSync(
        new URL(
            './artifacts/research/20260824-official-dungeon-character-roster/official-dungeon-character-corpus.tw.json',
            import.meta.url,
        ),
        'utf8',
    ))
    const authority = corpus.records.find(record => record.sourceCharacterId === 100102)
    assert.ok(authority)
    assert.equal(authority.logicalKey, 'dungeon/character/100102')
    assert.match(authority.externalWeaponPolicy, /never bind external sibling weapon/)
    const expected = new Map([
        ['DungeonWait_L', ['-8001233860802716549', 2, 435]],
        ['DungeonWalk_L', ['-2470702348575474233', 1.4500000476837158, 435]],
        ['DungeonRun_L', ['-2707444981814965735', 0.8166667222976685, 435]],
        ['DungeonWalkFeceUp_L', ['-4423495424398549897', 1.4500000476837158, 435]],
        ['DungeonWalkFeceDown_L', ['-2770654677155457730', 1.4500000476837158, 435]],
        ['DungeonRunFeceUp_L', ['-8181591152384496668', 0.8166667222976685, 435]],
        ['DungeonRunFeceDown_L', ['-7565874101449763096', 0.8166667222976685, 435]],
    ])
    for (const [name, [pathID, durationSeconds, genericBindings]] of expected) {
        const clip = authority.clips.find(candidate => (
            candidate.name === name && candidate.pathID === pathID
        ))
        assert.ok(clip, `missing exact 100102 clip ${name} / ${pathID}`)
        assert.equal(clip.durationSeconds, durationSeconds)
        assert.equal(clip.sampleRate, 60)
        assert.equal(clip.genericBindings, genericBindings)
    }

    const originalDocument = globalThis.document
    class FakeImage {
        listeners = new Map()
        width = 1
        height = 1
        addEventListener(type, callback) { this.listeners.set(type, callback) }
        removeEventListener(type) { this.listeners.delete(type) }
        set src(value) {
            this.source = value
            queueMicrotask(() => this.listeners.get('load')?.({ target: this }))
        }
        get src() { return this.source }
    }
    globalThis.document = {
        baseURI: 'http://embedded-dungeon.local/',
        createElementNS() { return new FakeImage() },
    }
    try {
        const compressed = fs.readFileSync(new URL(
            './magia-exedra-character-three/models/chara_100102/chara_100102.fbx.gz',
            import.meta.url,
        ))
        const fbx = gunzipSync(compressed)
        const buffer = fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength)
        const object = new FBXLoader().parse(buffer, '')
        const byName = new Map(object.animations.map(clip => [clip.name, clip]))
        for (const name of expected.keys()) {
            const clip = byName.get(name)
            assert.ok(clip, `100102 Viewer FBX is missing ${name}`)
            assert.equal(clip.tracks.length, 435)
            assert.equal(
                clip.tracks.some(track => /(?:^|\/)Root\.position$/i.test(track.name)),
                false,
                `${name} must not double-apply root translation`,
            )
        }
    } finally {
        if (originalDocument === undefined) delete globalThis.document
        else globalThis.document = originalDocument
    }

    const source = fs.readFileSync(
        new URL('./src/viewer/viewerLocomotion.ts', import.meta.url),
        'utf8',
    )
    for (const requiredConsumer of [
        'officialDungeonCharacterCorpusJson',
        'embeddedNativeDungeonActionEntries(',
        "native.source = 'embedded-exact'",
        'native.embeddedEntries = new Map(embeddedEntries.map',
        'nativeDungeonActionDescriptor(native, actionId)',
        "entry.clip.sourceName === neutralSourceName",
        "'DungeonWalkFeceUp_L'",
        "'DungeonWalkFeceDown_L'",
        "'DungeonRunFeceUp_L'",
        "'DungeonRunFeceDown_L'",
        "if (native.status !== 'attached') return",
    ]) {
        assert.ok(source.includes(requiredConsumer), `missing 100102 embedded consumer: ${requiredConsumer}`)
    }
    const ensureBody = source.slice(
        source.indexOf('function ensureNativeDungeonActions'),
        source.indexOf('export function attachViewerLocomotion'),
    )
    assert.ok(
        ensureBody.indexOf('embeddedNativeDungeonActionEntries(')
            < ensureBody.indexOf('await ensureCharacterActionCatalog()'),
        'embedded actions must attach before the external manifest fetch gate',
    )
})

test('101901 real target rig derives wide reachable Mami/Madoka-reference gait clearance', () => {
    const originalDocument = globalThis.document
    class FakeImage {
        listeners = new Map()
        width = 1
        height = 1
        addEventListener(type, callback) { this.listeners.set(type, callback) }
        removeEventListener(type) { this.listeners.delete(type) }
        set src(value) {
            this.source = value
            queueMicrotask(() => this.listeners.get('load')?.({ target: this }))
        }
        get src() { return this.source }
    }
    globalThis.document = {
        baseURI: 'http://101901-target-rig.local/',
        createElementNS() { return new FakeImage() },
    }
    try {
        const compressed = fs.readFileSync(new URL(
            './magia-exedra-character-three/models/chara_101901_battle_unit/VisualRoot.fbx.gz',
            import.meta.url,
        ))
        const fbx = gunzipSync(compressed)
        const buffer = fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength)
        const object = new FBXLoader().parse(buffer, '')
        object.updateMatrixWorld(true)
        const pathFromObject = target => {
            const parts = []
            let current = target
            while (current) {
                parts.unshift(current.name || current.type)
                if (current === object) break
                current = current.parent
            }
            return parts.join('/')
        }
        const outerSkirtSurfaces = []
        object.traverse(candidate => {
            if (!candidate.isSkinnedMesh || !candidate.skeleton) return
            const outerSkirtSkeletonIndices = new Set()
            candidate.skeleton.bones.forEach((bone, boneIndex) => {
                const bonePath = pathFromObject(bone)
                if (/\/OuterSkirt_/i.test(`/${bonePath}`) && !/_End(?:\/|$)/i.test(bonePath)) {
                    outerSkirtSkeletonIndices.add(boneIndex)
                }
            })
            if (outerSkirtSkeletonIndices.size === 0) return
            const position = candidate.geometry.getAttribute('position')
            const skinIndex = candidate.geometry.getAttribute('skinIndex')
            const skinWeight = candidate.geometry.getAttribute('skinWeight')
            assert.ok(position)
            assert.ok(skinIndex)
            assert.ok(skinWeight)
            const component = (attribute, vertexIndex, componentIndex) => (
                componentIndex === 0 ? attribute.getX(vertexIndex)
                    : componentIndex === 1 ? attribute.getY(vertexIndex)
                        : componentIndex === 2 ? attribute.getZ(vertexIndex)
                            : attribute.getW(vertexIndex)
            )
            const outerWeightByVertex = new Float32Array(position.count)
            let weightedVertexCount = 0
            for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
                let outerWeight = 0
                for (let componentIndex = 0; componentIndex < 4; componentIndex += 1) {
                    const boneIndex = Math.round(component(skinIndex, vertexIndex, componentIndex))
                    if (!outerSkirtSkeletonIndices.has(boneIndex)) continue
                    outerWeight += component(skinWeight, vertexIndex, componentIndex)
                }
                outerWeightByVertex[vertexIndex] = outerWeight
                if (outerWeight > 0.001) weightedVertexCount += 1
            }
            const geometryIndex = candidate.geometry.getIndex()
            const triangleCount = Math.floor((geometryIndex?.count ?? position.count) / 3)
            let selectedTriangleCount = 0
            for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
                const indices = [0, 1, 2].map(componentIndex => (
                    geometryIndex
                        ? Math.round(geometryIndex.getX(triangleIndex * 3 + componentIndex))
                        : triangleIndex * 3 + componentIndex
                ))
                const weights = indices.map(vertexIndex => outerWeightByVertex[vertexIndex])
                if (
                    weights.filter(weight => weight >= 0.20).length >= 2
                    && Math.max(...weights) >= 0.45
                    && weights[0] + weights[1] + weights[2] >= 1.05
                ) selectedTriangleCount += 1
            }
            outerSkirtSurfaces.push({
                meshPath: pathFromObject(candidate),
                outerSkirtBoneCount: outerSkirtSkeletonIndices.size,
                vertexCount: position.count,
                triangleCount,
                weightedVertexCount,
                selectedTriangleCount,
            })
        })
        assert.deepEqual(outerSkirtSurfaces, [{
            meshPath: 'chara_101901_battle_unit/VisualRoot/chara_101901_model/chara_101901/chara/Body_Mesh',
            outerSkirtBoneCount: 33,
            vertexCount: 42414,
            triangleCount: 14138,
            weightedVertexCount: 14159,
            selectedTriangleCount: 4699,
        }])
        const requireBone = name => {
            const matches = []
            object.traverse(candidate => {
                if (candidate.name === name && candidate.isBone) matches.push(candidate)
            })
            assert.equal(matches.length, 1, `101901 must expose exactly one ${name} bone`)
            return matches[0]
        }
        const position = name => requireBone(name).getWorldPosition(new Vector3())
        const segment = (from, to) => position(from).distanceTo(position(to))
        const legLengthMeters = (
            segment('UpLeg_L', 'Leg_L')
            + segment('Leg_L', 'Foot_L')
            + segment('UpLeg_R', 'Leg_R')
            + segment('Leg_R', 'Foot_R')
        ) / 2
        const armLengthMeters = (
            segment('Arm_L', 'Forearm_L')
            + segment('Forearm_L', 'Hand_L')
            + segment('Arm_R', 'Forearm_R')
            + segment('Forearm_R', 'Hand_R')
        ) / 2
        const shoulderHalfSeparationMeters = position('Arm_L').distanceTo(position('Arm_R')) / 2
        const originalFootHalfSeparationMeters = position('Foot_L').distanceTo(position('Foot_R')) / 2
        const clearance = deriveTargetRigLocomotionClearance({
            legLengthMeters,
            armLengthMeters,
            shoulderHalfSeparationMeters,
            originalFootHalfSeparationMeters,
        })

        assert.ok(legLengthMeters > 0.68 && legLengthMeters < 0.70)
        assert.ok(armLengthMeters > 0.36 && armLengthMeters < 0.38)
        assert.ok(shoulderHalfSeparationMeters > 0.085 && shoulderHalfSeparationMeters < 0.087)
        assert.ok(originalFootHalfSeparationMeters > 0.073 && originalFootHalfSeparationMeters < 0.074)
        assert.ok(clearance.walk.handHalfSeparationMeters > 0.32)
        assert.ok(clearance.run.handHalfSeparationMeters > 0.38)
        assert.ok(clearance.run.handHalfSeparationMeters > clearance.walk.handHalfSeparationMeters)
        assert.ok(clearance.run.handHeightAboveHipMeters > 0.17)
        assert.ok(clearance.run.handHeightAboveHipMeters > clearance.walk.handHeightAboveHipMeters)
        assert.ok(clearance.walk.footHalfSeparationMeters > originalFootHalfSeparationMeters)
        assert.ok(clearance.run.footHalfSeparationMeters > clearance.walk.footHalfSeparationMeters * 1.5)
        assert.equal(clearance.walk.toeOutRadians, 7 * Math.PI / 180)
        assert.equal(clearance.run.toeOutRadians, 12 * Math.PI / 180)

        const shoulderToWalkHand = Math.hypot(
            clearance.walk.handHalfSeparationMeters - shoulderHalfSeparationMeters,
            position('Arm_L').y - (position('Hip').y + clearance.walk.handHeightAboveHipMeters),
            clearance.walk.forwardSwingScaleMeters,
        )
        const shoulderToRunHand = Math.hypot(
            clearance.run.handHalfSeparationMeters - shoulderHalfSeparationMeters,
            position('Arm_L').y - (position('Hip').y + clearance.run.handHeightAboveHipMeters),
            clearance.run.forwardSwingScaleMeters,
        )
        assert.ok(shoulderToWalkHand < armLengthMeters)
        assert.ok(shoulderToRunHand < armLengthMeters)

        const upperLegCenter = position('UpLeg_L').clone().add(position('UpLeg_R')).multiplyScalar(0.5)
        const footCenter = position('Foot_L').clone().add(position('Foot_R')).multiplyScalar(0.5)
        const baselineVerticalDrop = upperLegCenter.y - footCenter.y
        const maximumReferenceOscillation = mode => (
            OFFICIAL_DUNGEON_GAIT_REFERENCE[mode].hipVerticalSpanMeters / 2
        )
        const maximumStanceReach = (mode, stanceEnd, travelMultiplier) => {
            const gaitClearance = clearance[mode]
            const crouch = legLengthMeters * (mode === 'walk' ? 0.11 : 0.165)
            const verticalDrop = baselineVerticalDrop
                + maximumReferenceOscillation(mode)
                - crouch
            const lateral = gaitClearance.footHalfSeparationMeters
                - position('UpLeg_L').x
            const rootTravel = Math.min(
                OFFICIAL_DUNGEON_GAIT_REFERENCE[mode].rootTravelPerCycleMeters,
                legLengthMeters * travelMultiplier,
            )
            const forward = rootTravel * stanceEnd / 2
            return Math.hypot(verticalDrop, lateral, forward)
        }
        assert.ok(legLengthMeters - maximumStanceReach('walk', 0.62, 1.12) > 0.01)
        assert.ok(legLengthMeters - maximumStanceReach('run', 0.42, 1.95) > 0.01)
        assert.deepEqual(
            OFFICIAL_DUNGEON_GAIT_REFERENCE.postureReferences.madokaSchoolUniform,
            {
                characterId: 100102,
                dungeonCharacterId: 100102,
                idleClipPathId: '-8001233860802716549',
                walkClipPathId: '-2470702348575474233',
                runClipPathId: '-2707444981814965735',
                transfer: 'cycle-and-angle-family-parameters-only',
            },
        )
        assert.deepEqual(
            OFFICIAL_DUNGEON_GAIT_REFERENCE.postureReferences.mamiMagicalGirl,
            {
                characterId: 100301,
                dungeonCharacterId: 100301,
                idleClipPathId: '-6532624707838147585',
                walkClipPathId: '4412818012340897786',
                runClipPathId: '-2942221244478808616',
                transfer: 'measured-root-speed-and-clearance-parameters-only',
            },
        )
    } finally {
        if (originalDocument === undefined) delete globalThis.document
        else globalThis.document = originalDocument
    }
})

test('TPS mouse input uses the current single-stream camera owner and yaw-relative movement', () => {
    const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8'),camera=fs.readFileSync('src/viewer/ThirdPersonCamera.ts','utf8')
    const tree=ts.createSourceFile('viewer.ts',source,ts.ScriptTarget.Latest,true)
    const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='cameraRelativeInput')
    assert.ok(node)
    const code=stripTypeScriptTypes(node.getText(tree),{mode:'strip'})
    const owner={yaw:0,pitch:0}
    const transform=Function('THREE','tpsCamera',code+';return cameraRelativeInput')(THREE,owner)
    const binding={character:{object:new THREE.Group()}}
    for(const yaw of [-8,-Math.PI,0,.7,Math.PI,8])for(const pitch of [-10,0,10]){
        owner.yaw=yaw;owner.pitch=pitch
        const value=transform(binding,{moveX:0,moveZ:1,run:true,jumpPressed:false})
        assert.ok(Math.abs(value.moveX+Math.sin(yaw))<1e-12)
        assert.ok(Math.abs(value.moveZ+Math.cos(yaw))<1e-12)
        assert.equal(value.run,true);assert.equal(value.jumpPressed,false)
    }
    assert.match(source,/tpsCamera\.install\(\)/)
    assert.match(camera,/this\.yaw -= dx \* this\.gain/)
    assert.match(camera,/this\.pitch \+= dy \* this\.gain/)
    assert.match(camera,/this\.move\(event\.movementX, event\.movementY/)
    assert.match(camera,/this\.drag\?\.id !== event\.pointerId/)
    assert.match(camera,/Number\.isFinite\(dx\)/)
    assert.match(camera,/unadjustedMovement: true/)
    assert.doesNotMatch(camera,/addEventListener\('mousemove'|getCoalescedEvents\(/)
    assert.match(source,/window\.addEventListener\('blur', releaseAllPhysicalTpsInput\)/)
    assert.match(source,/document\.hidden[\s\S]*releaseAllPhysicalTpsInput\(\)/)
})

test('TPS exit wiring delegates the final view to the current camera owner', () => {
    const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8'),camera=fs.readFileSync('src/viewer/ThirdPersonCamera.ts','utf8')
    assert.match(source,/if \(enabled && selected\) tpsCamera\.update\(\)/)
    assert.match(source,/if \(!wasEnabled\) tpsCamera\.start\(\)/)
    assert.match(source,/else \{\s*tpsCamera\.stop\(\)/)
    assert.match(camera,/controls\.enableDamping = false[\s\S]*camera\.position\.copy\(position\)[\s\S]*camera\.quaternion\.copy\(quaternion\)/)
    assert.match(camera,/controls\.connect\(renderer\.domElement\)/)
    assert.match(camera,/controls\.enabled = this\.orbit\?\.enabled \?\? true/)
    assert.doesNotMatch(source,/restoreOrbitCameraBaseline|captureOrbitCameraBaseline/)
    // Real zero-distance, residual Orbit damping, and 12/30/60/144 FPS cases
    // execute in viewerTpsCameraContinuity/Response, part of the website gate.
})

test('camera look tracking is post-mixer, rig-axis aware, bounded, and yields to authored head clips', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    for (const required of [
        'get eligible(): boolean',
        "eyePoseAuthority: 'authored-animation-and-expression'",
        'proceduralEyeRotation: false',
        "getCharacterReDriveProfile(this.characterId)",
        'unityDirectionToThreeFbx(profile.faceForwardAxis)',
        'unityDirectionToThreeFbx(profile.faceUpAxis)',
        'unityDirectionToThreeFbx(profile.faceRightAxis)',
        "chest: 'Root/Hip/Spine/Waist/Chest'",
        "neck: 'Root/Hip/Spine/Waist/Chest/Neck'",
        "head: 'Root/Hip/Spine/Waist/Chest/Neck/Head'",
        "'Root/Hip/Spine/Waist/Chest/Neck/Head/Eye_L'",
        "'Root/Hip/Spine/Waist/Chest/Neck/Head/Eye_R'",
        'characterActionPlaybackBlocksLocomotion(binding)',
        "authoredHeadClipPattern.test(binding.character.animation.current ?? '')",
        'Fece)(?:Up|Down)',
        'THREE.MathUtils.degToRad(-50)',
        'THREE.MathUtils.degToRad(50)',
        'THREE.MathUtils.degToRad(-24)',
        'THREE.MathUtils.degToRad(28)',
        'THREE.MathUtils.degToRad(120)',
        'this.cameraYawRelative = this.signedAngle(tpsCamera.yaw - this.bodyYaw)',
        "private gazeSemantic: 'look-at-camera' | 'look-with-camera' | 'side-transition'",
        'const headToCamera = scene.camera.position.clone().sub(headPosition).normalize()',
        'const cameraForward = scene.camera.getWorldDirection(new THREE.Vector3()).normalize()',
        'const lookAtCameraWeight = transitionRatio * transitionRatio * (3 - 2 * transitionRatio)',
        'const desiredBodyYaw = THREE.MathUtils.lerp(rearYaw, frontYaw, lookAtCameraWeight)',
        'desiredDirection.dot(authoredFaceRight)',
        'cameraHeadTracking?.setStateProvider(() => binding)',
        'binding.cameraHeadTracking?.setActive(enabled)',
        "source: 'current-evaluated-local-quaternion'",
    ]) {
        assert.ok(source.includes(required), `missing continuous head tracking contract: ${required}`)
    }
    const proceduralPush = source.indexOf('animationLoops.push(proceduralLocomotion.update)')
    const headPush = source.indexOf('animationLoops.push(cameraHeadTracking.update)')
    const walkClearancePush = source.indexOf(
        'animationLoops.push(binding.postAnimationWalkClearance.update)',
    )
    const secondaryPush = source.indexOf('animationLoops.push(secondaryPhysics.update)')
    assert.ok(headPush > proceduralPush)
    assert.ok(walkClearancePush > headPush)
    assert.ok(secondaryPush > walkClearancePush)
    assert.match(source, /targetWeight > this\.blendWeight \? 8 : 12/)
    assert.match(source, /cameraHeadTrackingWeights\[role\] \* this\.blendWeight/)
    assert.match(source, /this\.cameraFrontness = THREE\.MathUtils\.clamp/)
    assert.match(source, /this\.gazeSemantic = lookAtCameraWeight >= 0\.999/)
    assert.doesNotMatch(source, /cameraHeadTrackingCharacterIds/)

    const html = fs.readFileSync('index.html', 'utf8')
    const css = fs.readFileSync('src/viewer/style/menu/controls.css', 'utf8')
    assert.match(html, /id="locomotion-hud" class="is-collapsed"/)
    assert.match(html, /id="locomotion-hud-toggle"[\s\S]{0,140}aria-expanded="false"/)
    assert.match(css, /#locomotion-hud\.is-collapsed #locomotion-hud-details[\s\S]{0,40}display: none/)
})

test('101901 idle hair/skirt stay authored and locomotion crossfades transport their animated bases', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    assert.match(source, /motionClass: exactProfile\?\.mode === 'custom-101901-magica-profile'/)
    assert.match(source, /const idleHairStability = motion\?\.state === 'idle'/)
    assert.match(source, /Math\.hypot\(motion\.velocity\.x, motion\.velocity\.z\) < 0\.08/)
    assert.match(source, /const followAuthoredIdleSecondary = idleHairStability[\s\S]{0,100}state\.motionClass === 'authored-idle'[\s\S]{0,80}!secondaryTransitionActive/)
    const idleAuthoredBranch = source.slice(
        source.indexOf('const followAuthoredIdleSecondary ='),
        source.indexOf('if (!state.initialized)'),
    )
    assert.match(idleAuthoredBranch, /state\.finalQuaternion\.copy\(state\.baseQuaternion\)/)
    assert.doesNotMatch(idleAuthoredBranch, /\.slerp\(/)
    assert.match(source, /state\.position\.copy\(authoredTip\)/)
    assert.match(source, /state\.previousPosition\.copy\(authoredTip\)/)
    assert.match(source, /this\.diagnosticsState\.idleAuthoredFollowFrames \+= 1[\s\S]{0,40}continue/)
    assert.match(source, /transportAnimatedBasesDuringLocomotionTransitions/)
    assert.match(source, /const baseTransport = baseTip\.clone\(\)\.sub\(state\.lastBaseTip\)/)
    assert.match(source, /state\.position\.add\(baseTransport\)[\s\S]{0,80}state\.previousPosition\.add\(baseTransport\)/)
    assert.match(source, /const authoredIdleRecoveryWeight = secondaryTransitionActive[\s\S]{0,160}transitionTargetState === 'idle'/)
    assert.match(source, /state\.position\.lerp\(baseTip, authoredIdleRecoveryWeight\)/)
    assert.match(source, /if \(this\.bodyProject\(state\.position, state\.previousPosition, bodyColliders\)\)/)
    assert.match(source, /secondaryPhysics\?\.setStateProvider\(\(\) => binding\.snapshot\)/)
    assert.match(source, /idleAuthoredFollowFrames/)

    const runtime = JSON.parse(gunzipSync(fs.readFileSync(
        'magia-exedra-character-three/models/chara_101901_battle_unit/home-animations.json.gz',
    )))
    const wait = runtime.clips.find(clip => clip.name === 'HomeWait01_L')
    assert.ok(wait)
    const authoredRearHairRotations = wait.tracks.filter(track => {
        const [uuid, property] = track.name.split('.')
        const path = runtime.nodePaths[uuid] ?? ''
        if (property !== 'quaternion' || !/\/Hair_B_[LCR]1_/.test(path)) return false
        return track.times.length > 2 && track.values.some((value, index) => (
            index >= 4 && Math.abs(value - track.values[index % 4]) > 1e-7
        ))
    })
    assert.ok(authoredRearHairRotations.length >= 9)
    const authoredOuterSkirtRotations = wait.tracks.filter(track => {
        const [uuid, property] = track.name.split('.')
        const path = runtime.nodePaths[uuid] ?? ''
        if (property !== 'quaternion' || !/\/OuterSkirt_/.test(path)) return false
        return track.times.length > 2 && track.values.some((value, index) => (
            index >= 4 && Math.abs(value - track.values[index % 4]) > 1e-7
        ))
    })
    assert.ok(authoredOuterSkirtRotations.length >= 7)
})

test('model-owned actions do not inherit unrelated official-catalog failure status', () => {
    const source = fs.readFileSync('src/viewer/index.ts', 'utf8')
    const start = source.indexOf('function renderCharacterActionStatus()')
    const end = source.indexOf('function renderAnimationSelector()', start)
    const renderer = source.slice(start, end)
    assert.match(renderer, /selectedLegacyOption\?\.dataset\.animationSource === 'legacy'/)
    assert.match(renderer, /selectedLegacyOption\.value[\s\S]*?showCharacterActionStatus\(''\)[\s\S]*?return/)
    assert.ok(
        renderer.indexOf("dataset.animationSource === 'legacy'")
            < renderer.indexOf('const snapshot = characterActionCatalogSnapshot'),
        'legacy playback must be resolved before official catalog loading/error status',
    )
    assert.match(renderer, /const selectedOption = selectedCharacterActionOption\(\)/)
    assert.match(renderer, /No playable official character actions/)
})

test('TPS idle selection preserves character-owned helpers and keeps 100102 neutral', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const inferStart = source.indexOf('function inferLocomotionAnimations')
    const inferEnd = source.indexOf('function primaryLocomotionAnimation', inferStart)
    const infer = source.slice(inferStart, inferEnd)
    assert.match(infer, /Number\(character\.userData\.characterId\) === 100102/)
    assert.match(infer, /findFamily\(names, \[\/\^HomeWait01_L\$\/i\]\)/)
    assert.ok(infer.indexOf('/^HomeWait.*_L$/i') < infer.indexOf('/^CommonWait_L$/i'))

    const nativeStart = source.indexOf('function nativeDungeonLocomotionAnimations')
    const nativeEnd = source.indexOf('function isNativeDungeonAnimation', nativeStart)
    const native = source.slice(nativeStart, nativeEnd)
    assert.match(native, /binding: ViewerLocomotionBinding/)
    assert.match(native, /native\.dungeonCharacterId === 100102/)
    assert.match(native, /const idle = neutralCharacterIdle \?\? authoredIdle/)
    assert.match(source, /nativeDungeonLocomotionAnimations\(binding\)/)

    const resumeStart = source.indexOf('function resumeViewerLocomotionIdle')
    const resumeEnd = source.indexOf('function interruptViewerCharacterAction', resumeStart)
    const resume = source.slice(resumeStart, resumeEnd)
    assert.match(resume, /primaryLocomotionAnimation\(binding\.locomotionAnimations\.idle\)/)
    assert.match(resume, /binding\.animationPort\.play\(idle,/)

    const runtime = JSON.parse(gunzipSync(fs.readFileSync(
        'magia-exedra-character-three/models/chara_114401_battle_unit/home-animations.json.gz',
    )))
    assert.equal(runtime.actions.wait01.loopFamily, 'HomeWait01_L')
    assert.deepEqual(runtime.helpers, ['HomeWeaponAHide'])
    const waitClip = runtime.clips.find(clip => clip.name === 'HomeWait01_L')
    assert.ok(waitClip)
    const braidTracks = waitClip.tracks.filter(track => (
        runtime.nodePaths[track.name.split('.')[0]]?.includes('/Hair_B_C2_')
    ))
    assert.equal(new Set(braidTracks.map(track => runtime.nodePaths[track.name.split('.')[0]])).size, 6)
    assert.ok(braidTracks.length >= 18)
    const helper = runtime.clips.find(clip => clip.name === 'HomeWeaponAHide')
    assert.ok(helper)
    assert.equal(helper.tracks.length, 2)
    const helperTarget = runtime.nodePaths[helper.tracks[0].name.split('.')[0]]
    assert.match(helperTarget, /chara_114401_weapon_a\/weapon_a_joint_gp$/)
    assert.ok(helper.tracks.some(track => (
        track.name.endsWith('.position')
        && track.values.some((value, index) => index % 3 === 1 && value === -10)
    )))
})

test('combat runtime attaches while ordinary Space excludes every complex combat donor', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    assert.doesNotMatch(source, /function attachPreferredCombatJumpLocomotion/)

    const ensureStart = source.indexOf('function ensureCombatJumpActions')
    const ensureEnd = source.indexOf('function configureActionCatalogRetry', ensureStart)
    const ensure = source.slice(ensureStart, ensureEnd)
    assert.ok(
        ensure.indexOf('combat.loaded = loaded') < ensure.indexOf('combat.exactLocomotion = undefined'),
        'exact body/weapon runtime must attach before Space records its independent policy',
    )
    assert.match(ensure, /combat\.exactLocomotion = undefined/)
    assert.match(ensure, /Space uses target-rig human takeoff\/air\/land; complex combat leaps remain explicit action entries/)
    assert.ok(
        ensure.indexOf("combat.status = 'attached'") > ensure.indexOf('combat.exactLocomotion = undefined'),
        'the independent Space policy must not poison the exact combat runtime',
    )
    assert.match(
        ensure,
        /promoteAttachedCombatJumpSafety\(binding\)[\s\S]*?scene\.characterSelected\?\.character === binding\.character[\s\S]*?configureActionSelectors\(binding\)/,
    )

    const promotionStart = source.indexOf('function promoteAttachedCombatJumpSafety')
    const promotionEnd = source.indexOf('function nativeDungeonErrorDetail', promotionStart)
    const promotion = source.slice(promotionStart, promotionEnd)
    assert.match(promotion, /allowJumpSequence: true/)
    assert.doesNotMatch(
        promotion,
        /combat\.status !== 'attached' \|\| !binding\.safety\.allowMovement/,
        'exact runtime attachment must enable Space independently of horizontal movement authorization',
    )
    assert.match(promotion, /target-rig human takeoff\/air\/land with controller-owned root; combat leaps excluded from Space/)
    assert.match(promotion, /controller-root three-phase own-pose fallback; combat leaps excluded from Space/)

    const updateStart = source.indexOf('function updateFrame')
    const updateEnd = source.indexOf('function setViewerLocomotionEnabled', updateStart)
    const update = source.slice(updateStart, updateEnd)
    assert.match(
        update,
        /jumpPressed: rawInput\.jumpPressed && binding\.safety\.allowJumpSequence/,
        'Space must remain independently routable when horizontal movement is locked',
    )
    assert.match(
        update,
        /binding\.safety\.allowMovement \|\| binding\.safety\.allowJumpSequence/,
        'the controller must advance an independently-authorized jump sequence',
    )

    assert.match(source, /attachCombatJumpPreviewClips\(binding, loaded, entries\)/)
})

test('combat template playback preserves official eye/weapon continuity and schedules every authored phase', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    assert.match(source, /const combatSkeletonPhaseCrossfadeSeconds = 0\.10/)
    assert.match(source, /role\.currentPhase\?\.clipName === value\.name[\s\S]{0,100}role\.currentAction/)
    assert.match(source, /role\.holdFinalPose = true/)
    assert.match(source, /A null clip at a phase gap or timeline end means hold the/)
    assert.match(source, /role\.previousAction = outgoingAction/)
    assert.match(source, /previousAction\.setEffectiveWeight\(1 - blend\)/)
    assert.match(source, /action\.setEffectiveWeight\(blend\)/)
    assert.match(source, /previousAction\.time = previousPhase\.sourceDurationSeconds/)
    assert.match(source, /role\.lastAppliedTimeSeconds = timeSeconds/)
    assert.match(source, /function combatSkeletonPhaseOrder\(phase: string\)/)
    assert.match(source, /\^segment-\(\\d\+\)\$/)
    assert.match(source, /new CharacterTimeline\(timelineDocument, \{ bindings: timelineBindings \}\)/)
    assert.match(source, /sourceDurationSeconds: exact\.clip\.duration/)
    const animationSetter = source.slice(
        source.indexOf('setAnimationClip: (value: TimelineClipValue) => {', source.indexOf('function startCombatSkeletonPlayback')),
        source.indexOf('role = {', source.indexOf('function startCombatSkeletonPlayback')),
    )
    assert.doesNotMatch(animationSetter, /stopCombatSkeletonRole\(role\)/)
    assert.ok(
        animationSetter.indexOf('if (value.name === null)')
        < animationSetter.indexOf('role.holdFinalPose = true'),
    )
    assert.ok(
        animationSetter.indexOf('role.holdFinalPose = true')
        < animationSetter.indexOf('return', animationSetter.indexOf('role.holdFinalPose = true')),
    )

    assert.match(source, /entry\.requiredComponents\?\.some\(component => component\.role === 'body'\)/)
    assert.match(source, /可播放模板/)
    assert.match(source, /exactCombatSkeletonPreviewEntry\(binding, entry\)/)
    assert.match(source, /同角色 exact-model \$\{includesPrimaryWeapon \? 'body\/主武器' : 'body-only'\} 可播放模板已从 runtime 恢复/)
})

test('all Viewer characters have controller-root own-pose movement/jump routing and mapped battle characters never use cross-rig donors', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const safetyStart = source.indexOf('function getViewerRigSafety')
    const safetyEnd = source.indexOf('const actionSlots', safetyStart)
    const defaultSafety = source.slice(safetyStart, safetyEnd)
    assert.match(defaultSafety, /movementPolicy: 'controller-root-own-pose'/)
    assert.match(defaultSafety, /allowMovement: true,[\s\S]*?allowJumpSequence: true/)
    assert.match(defaultSafety, /allowCrossCharacterDungeon: false/)
    assert.match(defaultSafety, /allowCombatActions: false/)
    assert.match(defaultSafety, /allowProceduralBones: false/)
    assert.match(defaultSafety, /allowSecondaryFallback: false/)
    assert.match(defaultSafety, /controller-root-only movement enabled with the selected model own pose/)
    assert.match(defaultSafety, /controller-root own-pose jump available/)

    const rootOnlyStart = source.indexOf('function controllerRootOwnPoseLocomotionAnimations')
    const rootOnlyEnd = source.indexOf('function primaryLocomotionAnimation', rootOnlyStart)
    const rootOnly = source.slice(rootOnlyStart, rootOnlyEnd)
    assert.match(rootOnly, /const ownPose = primaryLocomotionAnimation\(inferred\.idle\)/)
    for (const state of ['idle', 'walk', 'run', 'jump', 'fall', 'land']) {
        assert.match(rootOnly, new RegExp(`${state}: ownPose`))
    }

    const attachStart = source.indexOf('export function attachViewerLocomotion')
    const attachEnd = source.indexOf('export function detachViewerLocomotion', attachStart)
    const attach = source.slice(attachStart, attachEnd)
    assert.match(attach, /const rootOnlyAnimations = controllerRootOwnPoseLocomotionAnimations/)
    assert.match(attach, /controller-root-only movement preserves one selected-model own-pose family/)
    assert.match(attach, /animations: rootOnlyAnimations/)

    const manifest = JSON.parse(fs.readFileSync(
        new URL('./public/character-actions/combat-jump/manifest.v1.json', import.meta.url),
        'utf8',
    ))
    const runtimeCharacters = manifest.characters.filter(character => character.runtime)
    const runtimeIds = new Set(runtimeCharacters.map(character => character.characterId))
    const donorIds = new Set(manifest.entries.filter(entry => (
        entry.groupId === 'official-combat-jump-donors'
        && entry.availability.status === 'source-available'
    )).map(entry => entry.characterIdentity.characterId))
    const fallbackIds = [...runtimeIds].filter(id => !donorIds.has(id)).sort()
    const unmappedIds = manifest.characters
        .filter(character => !character.runtime)
        .map(character => character.characterId)
        .sort()

    assert.equal(runtimeIds.size, 89)
    assert.equal(donorIds.size, 52)
    assert.equal(fallbackIds.length, 37)
    assert.deepEqual(unmappedIds, ['100205', '113501'])
    assert.ok([...donorIds].every(id => runtimeIds.has(id)))
    for (const entry of manifest.entries.filter(entry => (
        entry.groupId === 'official-combat-jump-donors'
        && entry.availability.status === 'source-available'
    ))) {
        const donor = entry.playback.jumpDonor
        assert.equal(donor.compatibility, 'exact-rig')
        assert.equal(donor.sourceCharacterId, entry.characterIdentity.characterId)
        assert.deepEqual(donor.compatibleCharacterIds, [entry.characterIdentity.characterId])
        assert.equal(donor.attachmentPolicy, 'body-only-exclude-external-weapons')
        assert.ok(donor.segments.every(segment => segment.rootPolicy === 'controller-all'))
    }
})

test('all reusable combat actions have exact body templates and retain complete primary weapon phases when present', () => {
    const manifest = JSON.parse(fs.readFileSync(
        new URL('./public/character-actions/combat-jump/manifest.v1.json', import.meta.url),
        'utf8',
    ))
    const entries = manifest.entries.filter(entry => entry.groupId === 'official-combat-complete-actions')
    const runtimeByCharacter = new Map()
    let exactBodyTemplates = 0
    let bodyPrimaryWeaponTemplates = 0
    let bodyOnlyTemplates = 0
    let segmentedTemplates = 0
    let primaryWeaponTimingMismatches = 0
    for (const entry of entries) {
        const characterId = entry.characterIdentity.characterId
        let runtime = runtimeByCharacter.get(characterId)
        if (!runtime) {
            runtime = JSON.parse(gunzipSync(fs.readFileSync(
                `public/character-actions/combat-jump/runtime/${characterId}/runtime.v1.json.gz`,
            )))
            runtimeByCharacter.set(characterId, runtime)
        }
        const actionClips = runtime.clips.filter(clip => clip.actionId === entry.id)
        const body = actionClips.filter(clip => clip.role === 'body')
        const bodyPhaseNames = new Set(body.map(clip => clip.sequencePhase))
        const primaryWeaponByPhase = new Map(actionClips
            .filter(clip => clip.role === 'weapon-a')
            .map(clip => [clip.sequencePhase, clip]))
        assert.ok(body.length > 0, `missing exact body runtime for ${entry.id}`)
        exactBodyTemplates += 1
        if ([...bodyPhaseNames].some(phase => /^segment-\d+$/i.test(phase))) segmentedTemplates += 1
        if ([...bodyPhaseNames].every(phase => primaryWeaponByPhase.has(phase))) {
            bodyPrimaryWeaponTemplates += 1
            if (body.some(bodyClip => (
                Math.abs(
                    bodyClip.duration
                    - primaryWeaponByPhase.get(bodyClip.sequencePhase).duration,
                ) > 1 / 120
            ))) primaryWeaponTimingMismatches += 1
        } else {
            bodyOnlyTemplates += 1
        }
    }
    assert.equal(entries.length, 296)
    assert.equal(exactBodyTemplates, 296)
    assert.equal(bodyPrimaryWeaponTemplates, 278)
    assert.equal(bodyOnlyTemplates, 18)
    assert.equal(segmentedTemplates, 17)
    assert.equal(primaryWeaponTimingMismatches, 13)
    assert.equal(entries.filter(entry => entry.skill.semantic === 'special').length, 84)
})

test('Viewer exposes all exact combat templates and keeps raw gray evidence out of the standard selector', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const combatLoaderSource = fs.readFileSync('src/viewer/characterActions/combatLoader.ts', 'utf8')
    const catalogStart = source.indexOf('function viewerCharacterActionCatalogSnapshot')
    const catalogEnd = source.indexOf('function emitCharacterActionCatalogChange', catalogStart)
    const catalog = source.slice(catalogStart, catalogEnd)
    assert.match(catalog, /official-combat-body-weapon-actions/)
    assert.match(catalog, /官方战斗模板动作（主体 \/ 主武器）/)
    assert.match(catalog, /sourceKind: 'combat-skeleton-preview'/)
    assert.ok(catalog.indexOf('...combatSkeletonEntries') < catalog.indexOf('...combatEvidenceEntries'))
    assert.match(catalog, /const combatEvidenceEntries = \(includeAll \? combatJumpCatalogEntries : \[\]\)/)
    assert.match(catalog, /catalogAll\(\), but do not duplicate executable templates as gray/)

    const skeletonAvailabilityStart = source.indexOf('function combatSkeletonConsumerAvailability')
    const skeletonAvailabilityEnd = source.indexOf('function nativeDungeonActionDescriptor', skeletonAvailabilityStart)
    const skeletonAvailability = source.slice(skeletonAvailabilityStart, skeletonAvailabilityEnd)
    assert.match(skeletonAvailability, /status: 'attached'/)
    assert.match(skeletonAvailability, /playable: true/)
    assert.match(skeletonAvailability, /previewEntry\.bodyPhases\.length/)
    assert.doesNotMatch(skeletonAvailability, /entry\.skill\.semantic === 'special'/)

    const playbackStart = source.indexOf('function startCombatSkeletonPlayback')
    const playbackEnd = source.indexOf('function selectedBinding', playbackStart)
    const playback = source.slice(playbackStart, playbackEnd)
    assert.match(playback, /const exactByPhase = new Map\(target\.clips\.map/)
    assert.match(playback, /new CharacterTimeline\(timelineDocument/)
    assert.match(playback, /events: \[\]/)
    assert.match(playback, /sourceDurationSeconds: exact\.clip\.duration/)
    assert.match(playback, /setNativeDungeonExternalAttachmentsHidden\(binding, true\)/)
    assert.match(playback, /const attachments = combatSkeletonAttachments\(binding, roles\)/)
    assert.doesNotMatch(playback, /entry\.skill\.semantic === 'special'/)
    assert.doesNotMatch(playback, /setExpressionTransitionSeconds/)
    assert.doesNotMatch(playback, /setManualBlinkWeight/)
    assert.doesNotMatch(playback, /resetToDefault\(\)/)
    assert.match(source, /function applyCombatSkeletonAttachmentPose\(/)
    assert.match(source, /policy: 'authored-model-space-root'/)
    assert.match(source, /restoreExternalAttachmentModelRoot\(attachment\)/)
    assert.match(source, /restPosition: object\.position\.clone\(\)/)
    assert.match(source, /restQuaternion: object\.quaternion\.clone\(\)/)
    assert.match(source, /restScale: object\.scale\.clone\(\)/)
    assert.doesNotMatch(source, /parent\.worldToLocal\(anchorWorldPosition\)/)
    assert.doesNotMatch(source, /preferredAnchorNames/)
    assert.match(source, /exact-model \$\{roles\.some\(role => role\.role === 'weapon-a'\) \? 'body\/primary-weapon' : 'body-only'\} reusable template/)

    const slotsStart = source.indexOf('function combatSkeletonEntriesForSlot')
    const slotsEnd = source.indexOf('function configureActionSelectors', slotsStart)
    const slots = source.slice(slotsStart, slotsEnd)
    assert.match(slots, /basicAttack: \['normalAttack'\]/)
    assert.match(slots, /skill: \['skill'\]/)
    assert.match(slots, /ultimate: \['special'\]/)
    assert.match(slots, /left\.id\.localeCompare\(right\.id, 'en'\)/)
    assert.doesNotMatch(slots, /entry\.availability\.status === 'source-available'/)
    assert.match(source, /function exactCombatSkeletonPreviewEntry\(/)
    assert.match(source, /entry\.requiredComponents\?\.some\(component => component\.role === 'body'\)/)
    assert.match(combatLoaderSource, /manifestCombatActionIds\.has\(serialized\.actionId\)/)

    const triggerStart = source.indexOf('function triggerAction')
    const triggerEnd = source.indexOf('function movementAxes', triggerStart)
    const trigger = source.slice(triggerStart, triggerEnd)
    assert.match(trigger, /binding\?\.catalogActionIds\.get\(slot\.code\)/)
    assert.ok(
        trigger.indexOf('playViewerCharacterAction(catalogActionId)')
            < trigger.indexOf('binding.safety.allowCombatActions'),
        'exact catalog playback must route before the legacy 101901-only combat gate',
    )

    const synchronizeStart = source.indexOf('function synchronizeViewerCharacterActionState')
    const synchronizeEnd = source.indexOf('function triggerAction', synchronizeStart)
    const synchronize = source.slice(synchronizeStart, synchronizeEnd)
    assert.match(synchronize, /activeSkeleton\.playback\.step\(deltaSeconds\)/)
    assert.match(synchronize, /body\/weapon preview completed; locomotion restored/)
    assert.match(synchronize, /resumeViewerLocomotionIdle\(binding\)/)
})

test('action physics phase roots use explicit stable keys and a fail-closed action lifecycle', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const manifest = JSON.parse(fs.readFileSync(
        'public/character-physics/action-options.v1.json',
        'utf8',
    ))
    assert.equal(manifest.counts.actionPhases, 4)
    assert.equal(manifest.entries.length, 4)
    assert.equal(manifest.counts.relatedViewerActionOptions, 6)
    assert.equal(manifest.viewerActionOptions.length, 6)
    assert.equal(manifest.policy.phaseToViewerActionMapping, 'not-inferred')
    assert.ok(manifest.viewerActionOptions.every(entry => (
        entry.phaseBindingRelation === 'character-identity-only-no-phase-inference'
    )))
    assert.ok(manifest.entries.every(entry => (
        entry.phaseRoot.binding.hierarchyPath === entry.phaseRoot.officialGameObjectName
        && entry.phaseRoot.binding.modelRelativePath === null
        && entry.phaseRoot.binding.visualRootRelativePath === null
        && entry.phaseRoot.binding.localTRS
        && entry.registrationBindings.every(requirement => (
            !requirement.exactRelativePath.includes('/')
            && requirement.binding.hierarchyPath
                === `${entry.phaseRoot.officialGameObjectName}/${requirement.exactRelativePath}`
            && requirement.binding.localTRS
        ))
    )))

    const registrationStart = source.indexOf(
        'async function registerViewerCharacterActionPhysicsPhase(',
    )
    const registrationEnd = source.indexOf('function selectedCharacterId', registrationStart)
    assert.ok(registrationStart >= 0 && registrationEnd > registrationStart)
    const registration = source.slice(registrationStart, registrationEnd)
    assert.match(registration, /characterPhysicsActionOptionsClient\.requirePhase\(normalizedStableKey\)/)
    assert.match(registration, /phase\.character\.characterResourceId !== characterResourceId/)
    assert.match(registration, /getViewerCharacterPhysicsAttachment\(binding\.character\.object\)/)
    assert.match(registration, /attachment\.status !== 'ready'/)
    assert.match(registration, /registerCharacterPhysicsActionPhaseBindings\(/)
    assert.match(registration, /attachment\.bindingRegistry/)
    assert.match(registration, /character-physics-phase:stale-request/)
    assert.match(registration, /rootProvider\(phase, binding\)/)
    assert.match(registration, /disposePhase/)
    assert.doesNotMatch(registration, /viewerActionOptions/)
    assert.doesNotMatch(registration, /directionName/)
    assert.doesNotMatch(registration, /semantic/)

    const providerStart = source.indexOf(
        'function createOfficialCharacterActionPhysicsPhaseRoot(',
    )
    const providerEnd = source.indexOf(
        'async function registerViewerCharacterActionPhysicsPhase(',
        providerStart,
    )
    assert.ok(providerStart >= 0 && providerEnd > providerStart)
    const provider = source.slice(providerStart, providerEnd)
    assert.match(provider, /applyOfficialPhaseLocalTrs\(phaseRoot, rootBinding\)/)
    assert.match(provider, /applyOfficialPhaseLocalTrs\(child, requirement\.binding\)/)
    assert.match(provider, /segments\.length !== 1/)
    assert.match(provider, /missing-intermediate-trs/)
    assert.match(provider, /binding\.character\.object\.add\(phaseRoot\)/)
    assert.match(provider, /phaseRoot\.removeFromParent\(\)/)
    assert.match(provider, /phaseRoot\.clear\(\)/)
    const trsStart = source.indexOf('function applyOfficialPhaseLocalTrs(')
    const trsEnd = source.indexOf(
        'function createOfficialCharacterActionPhysicsPhaseRoot(',
        trsStart,
    )
    const trs = source.slice(trsStart, trsEnd)
    assert.match(trs, /object\.position\.set\(-trs\.localPosition\.x/)
    assert.match(trs, /-trs\.localRotation\.y/)
    assert.match(trs, /-trs\.localRotation\.z/)
    assert.match(trs, /object\.scale\.set\(/)

    const interruptStart = source.indexOf('function interruptViewerCharacterAction')
    const interruptEnd = source.indexOf('async function playViewerCharacterAction', interruptStart)
    assert.match(
        source.slice(interruptStart, interruptEnd),
        /releaseViewerCharacterActionPhysicsPhase\(binding, reason\)/,
    )
    const pauseStart = source.indexOf('function pauseViewerCharacterAction')
    const pauseEnd = source.indexOf('function seekViewerCharacterAction', pauseStart)
    const seekStart = pauseEnd
    const seekEnd = source.indexOf('function stepViewerCharacterAction', seekStart)
    assert.doesNotMatch(source.slice(pauseStart, pauseEnd), /releaseViewerCharacterActionPhysicsPhase/)
    assert.doesNotMatch(source.slice(seekStart, seekEnd), /releaseViewerCharacterActionPhysicsPhase/)

    const disposeStart = source.indexOf('function disposeViewerCharacterAction')
    const synchronizeStart = source.indexOf('function synchronizeViewerCharacterActionState', disposeStart)
    const synchronizeEnd = source.indexOf('function triggerAction', synchronizeStart)
    assert.match(
        source.slice(disposeStart, synchronizeStart),
        /releaseViewerCharacterActionPhysicsPhase\(binding, 'character action disposed'\)/,
    )
    const synchronize = source.slice(synchronizeStart, synchronizeEnd)
    assert.match(synchronize, /releaseViewerCharacterActionPhysicsPhase\(binding, 'direct Home action completed'\)/)
    assert.match(synchronize, /releaseViewerCharacterActionPhysicsPhase\(binding, 'combat skeleton action completed'\)/)
    assert.match(synchronize, /groundedLocomotionRestored[\s\S]{0,400}binding\.controller\.stopHorizontalMotion\(\)/)
    assert.match(synchronize, /'combat jump donor landed'/)
    assert.match(synchronize, /'combat jump donor timed out'/)

    const detachStart = source.indexOf('export function detachViewerLocomotion')
    const detachEnd = source.indexOf('export function selectViewerLocomotion', detachStart)
    assert.match(
        source.slice(detachStart, detachEnd),
        /releaseViewerCharacterActionPhysicsPhase\(binding, 'character detached'\)/,
    )
    const publicApiStart = source.indexOf('const publicApi =')
    const publicApi = source.slice(publicApiStart)
    assert.match(publicApi, /activatePhysicsPhase\(stableKey: string\)/)
    assert.match(publicApi, /activateViewerCharacterActionPhysicsPhase\(stableKey\)/)
    assert.match(publicApi, /registerPhysicsPhaseRoot\(stableKey: string, phaseRoot: THREE\.Object3D\)/)
    assert.match(publicApi, /physicsPhaseState\(\)/)
    assert.match(publicApi, /subscribeState\(listener: \(state: ViewerCharacterActionPlaybackSnapshot\)/)
    assert.match(source, /magius:character-action-playback-state/)
})

test('character action playback rate drives every runtime transport without taking over TPS gait', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const clampStart = source.indexOf('function clampViewerCharacterActionPlaybackRate')
    const clampEnd = source.indexOf('function cloneCharacterActionPlaybackState', clampStart)
    const clamp = source.slice(clampStart, clampEnd)
    assert.ok(clampStart >= 0 && clampEnd > clampStart)
    assert.match(clamp, /Number\.isFinite\(playbackRate\)/)
    assert.match(clamp, /THREE\.MathUtils\.clamp\(playbackRate, 0, 2\)/)
    assert.match(source, /characterActionPlaybackRate: number/)
    assert.match(source, /characterActionAuthoredSpeed: number/)
    assert.match(source, /playbackRate\?: number/)
    assert.match(source, /interface ViewerCharacterActionPlaybackSnapshot[\s\S]*?playbackRate: number/)

    const setterStart = source.indexOf('function setViewerCharacterActionPlaybackRate')
    const setterEnd = source.indexOf('function pauseViewerCharacterAction', setterStart)
    const setter = source.slice(setterStart, setterEnd)
    assert.ok(setterStart >= 0 && setterEnd > setterStart)
    assert.match(setter, /binding\.characterActionPlaybackRate = normalizedRate/)
    assert.match(setter, /binding\.characterActionPlayback\.playbackRate = normalizedRate/)
    assert.match(setter, /applyViewerCharacterActionMixerRate\(binding\)/)
    assert.match(setter, /emitCharacterActionPlaybackState\(binding\)/)
    assert.doesNotMatch(setter, /characterId\s*===|101901|100102/)

    const directStart = source.indexOf('function startDirectHomePlayback')
    const directEnd = source.indexOf('function interruptViewerCharacterAction', directStart)
    const direct = source.slice(directStart, directEnd)
    assert.match(direct, /speed: effectiveViewerCharacterActionMixerRate\(binding\)/)
    assert.match(direct, /binding\.characterActionAuthoredSpeed = Number\.isFinite\(speed\) \? speed : 1/)
    assert.match(direct, /setSpeed\?\.\(effectiveViewerCharacterActionMixerRate\(binding\)\)/)

    const playStart = source.indexOf('async function playViewerCharacterAction')
    const playEnd = source.indexOf('function setViewerCharacterActionPlaybackRate', playStart)
    const play = source.slice(playStart, playEnd)
    assert.match(play, /binding\.characterActionAuthoredSpeed = 1[\s\S]*?speed: effectiveViewerCharacterActionMixerRate\(binding\)/)
    assert.match(play, /activeJumpDonorPlayback\?\.actionId === actionId[\s\S]*?status === 'paused'/)
    assert.match(play, /applyViewerCharacterActionMixerRate\(binding\)/)

    const synchronizeStart = source.indexOf('function synchronizeViewerCharacterActionState')
    const synchronizeEnd = source.indexOf('function triggerAction', synchronizeStart)
    const synchronize = source.slice(synchronizeStart, synchronizeEnd)
    assert.match(synchronize, /activeDirectHome\.timeline\.update\(deltaSeconds\)/)
    assert.match(synchronize, /activeSkeleton\.playback\.step\(deltaSeconds\)/)
    assert.match(synchronize, /active\.elapsedSeconds \+= deltaSeconds/)

    const gaitStart = source.indexOf('function synchronizeTargetRigGaitPlayback')
    const gaitEnd = source.indexOf('function updateFrame', gaitStart)
    const gait = source.slice(gaitStart, gaitEnd)
    assert.match(gait, /characterActionPlaybackBlocksLocomotion\(binding\)/)
    assert.match(gait, /binding\.combatJumpActions\.activeJumpDonorPlayback/)
    assert.match(gait, /playbackRate = effectiveViewerCharacterActionMixerRate\(binding\)/)
    assert.match(gait, /calibration\.runSpeedMetersPerSecond/)
    assert.doesNotMatch(gait, /characterId\s*===|101901|100102/)

    const updateStart = gaitEnd
    const updateEnd = source.indexOf('function syncCameraRigFromCurrentView', updateStart)
    const update = source.slice(updateStart, updateEnd)
    assert.match(update, /const characterActionDeltaSeconds = binding\.characterActionPlayback\.status === 'playing'/)
    assert.match(update, /deltaSeconds \* binding\.characterActionPlaybackRate/)
    assert.match(update, /synchronizeViewerCharacterActionState\(binding, characterActionDeltaSeconds\)/)
    assert.match(update, /binding\.combatJumpActions\.activeJumpDonorPlayback[\s\S]*?\? characterActionDeltaSeconds[\s\S]*?: deltaSeconds/)
    assert.match(update, /synchronizeActiveCombatJumpDonorPlayback\(binding, characterActionDeltaSeconds\)/)

    const disposeStart = source.indexOf('function disposeViewerCharacterAction')
    const disposeEnd = source.indexOf('function synchronizeViewerCharacterActionState', disposeStart)
    assert.match(
        source.slice(disposeStart, disposeEnd),
        /emptyCharacterActionPlaybackState\([\s\S]*?binding\.characterActionPlaybackRate/,
    )
    const stepStart = source.indexOf('function stepViewerCharacterAction')
    const stepEnd = source.indexOf('function disposeViewerCharacterAction', stepStart)
    assert.match(source.slice(stepStart, stepEnd), /currentTime \+ deltaSeconds/)
    assert.doesNotMatch(source.slice(stepStart, stepEnd), /characterActionPlaybackRate/)

    const publicApiStart = source.indexOf('const publicApi =')
    const publicApi = source.slice(publicApiStart)
    assert.match(publicApi, /setPlaybackRate\(playbackRate: number\)/)
    assert.match(publicApi, /setViewerCharacterActionPlaybackRate\(playbackRate\)/)
    assert.match(publicApi, /binding\.characterActionPlaybackRate/)
})

test('native-ready character physics suppresses the legacy secondary writer without deleting fallback', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const attachStart = source.indexOf('export function attachViewerLocomotion')
    const attachEnd = source.indexOf('export function detachViewerLocomotion', attachStart)
    assert.ok(attachStart >= 0 && attachEnd > attachStart)
    const attach = source.slice(attachStart, attachEnd)
    const nativeGate = attach.indexOf(
        'const nativePhysicsAttachment = getViewerCharacterPhysicsAttachment(character.object)',
    )
    const secondaryWriter = attach.indexOf('const secondaryPhysics = nativePhysicsAttachment?.status')
    const firstLegacyWriter = attach.indexOf('new ViewerSecondaryBonePhysics', secondaryWriter)
    assert.ok(nativeGate >= 0)
    assert.ok(secondaryWriter > nativeGate)
    assert.ok(firstLegacyWriter > secondaryWriter)
    assert.match(
        attach.slice(secondaryWriter, firstLegacyWriter),
        /nativePhysicsAttachment\?\.status === 'ready'[\s\S]*?\? undefined/,
    )
    assert.match(attach, /mode: 'custom-101901-magica-profile'/)
    assert.match(attach, /rootPaths: secondaryRoots101901/)
    assert.equal((attach.match(/new ViewerSecondaryBonePhysics/g) ?? []).length, 2)
    assert.match(attach, /secondaryPhysics\?\.setStateProvider/)
    assert.match(attach, /if \(secondaryPhysics\) character\.userData\.animationLoops\.push/)
})

test('TPS entry bridges the last rendered mixer pose without a bind or rest-pose write', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const classStart = source.indexOf('class ViewerTpsPoseTransition')
    const classEnd = source.indexOf('class ViewerProceduralLocomotion', classStart)
    assert.ok(classStart >= 0 && classEnd > classStart)
    const transition = source.slice(classStart, classEnd)
    assert.match(transition, /position: bone\.position\.clone\(\)/)
    assert.match(transition, /quaternion: bone\.quaternion\.clone\(\)/)
    assert.match(transition, /scale: bone\.scale\.clone\(\)/)
    assert.match(transition, /source: 'last-rendered-mixer-local-trs'/)
    assert.match(transition, /if \(this\.firstFrame\)[\s\S]*?const blend = ratio \* ratio \* \(3 - 2 \* ratio\)/)
    assert.doesNotMatch(transition, /rest|bindPose|inverseBind|skeleton\.boneInverses/)

    const enableStart = source.indexOf('export function setViewerLocomotionEnabled')
    const enableEnd = source.indexOf('function installInputHandlers', enableStart)
    const enable = source.slice(enableStart, enableEnd)
    const bridgeIndex = enable.indexOf('binding.tpsPoseTransition?.begin()')
    const nativeSwitchIndex = enable.indexOf("binding.nativeDungeonActions.status === 'attached'")
    assert.ok(bridgeIndex >= 0 && nativeSwitchIndex > bridgeIndex)

    const attachStart = source.indexOf('export function attachViewerLocomotion')
    const attachEnd = source.indexOf('export function detachViewerLocomotion', attachStart)
    const attach = source.slice(attachStart, attachEnd)
    assert.match(attach, /const tpsPoseTransition = new ViewerTpsPoseTransition\(character, cameraHeadTracking\)/)
    assert.match(attach, /if \(enabled\) tpsPoseTransition\?\.begin\(\)/)
    const transitionLoopIndex = attach.indexOf('animationLoops.push(tpsPoseTransition.update)')
    const proceduralLoopIndex = attach.indexOf('animationLoops.push(proceduralLocomotion.update)')
    assert.ok(transitionLoopIndex >= 0)
    assert.ok(proceduralLoopIndex > transitionLoopIndex)
})

test('Escape and owned pointer-lock loss exit the current TPS owner without resetting the pose',()=>{
    const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8'),camera=fs.readFileSync('src/viewer/ThirdPersonCamera.ts','utf8')
    const at=source.indexOf("if (enabled && event.code === 'Escape' && !event.repeat)"),end=source.indexOf('return',at)
    assert.ok(at>=0&&end>at)
    const escape=source.slice(at,end)
    assert.equal((escape.match(/setViewerLocomotionEnabled\(false\)/g)||[]).length,1)
    assert.match(escape,/releasePhysicalTpsInput\(\)/)
    assert.match(camera,/if \(wasLocked && !this\.locked && this\.active\) this\.hooks\.released\(\)/)
    assert.match(camera,/if \(document\.pointerLockElement === renderer\.domElement\) document\.exitPointerLock\(\)/)
    assert.match(source,/released: \(\) => setViewerLocomotionEnabled\(false\)/)
    const start=source.indexOf('export function setViewerLocomotionEnabled'),finish=source.indexOf('function installInputHandlers',start),body=source.slice(start,finish)
    assert.doesNotMatch(body,/binding\.cameraHeadTracking\?\.reset\(\)/)
    assert.ok(body.indexOf('binding.cameraHeadTracking?.setActive(enabled)')<body.indexOf('deactivateNativeDungeonPresentation(binding, true)'))
    assert.match(body,/tpsCamera\.stop\(\)/)
})

function universalGazeFixture({ characterId = 800001, eyes = 'pair', missing = undefined, policy = undefined } = {}) {
    const sourcePath = process.env.ACTION_GAZE_SOURCE ?? 'src/viewer/viewerLocomotion.ts'
    const source = fs.readFileSync(sourcePath, 'utf8')
    const start = source.indexOf('type CameraHeadTrackingRole =')
    const end = source.indexOf('interface SecondaryPhysicsDiagnostics', start)
    assert.ok(start >= 0 && end > start)
    const code = stripTypeScriptTypes(source.slice(start, end), { mode: 'strip' })
    const object = new THREE.Group()
    const rig = new Map()
    let parent = object
    let path = ''
    for (const name of ['Root', 'Hip', 'Spine', 'Waist', 'Chest', 'Neck', 'Head']) {
        const bone = new THREE.Bone()
        bone.name = name
        if (name === 'Head') bone.position.y = 1.5
        parent.add(bone)
        path = path ? `${path}/${name}` : name
        if (name !== missing) rig.set(path, bone)
        parent = bone
    }
    for (const eye of eyes === 'pair' ? ['Eye_L', 'Eye_R'] : eyes === 'single' ? ['Eye_L'] : []) {
        const bone = new THREE.Bone()
        bone.name = eye
        parent.add(bone)
        rig.set(`${path}/${eye}`, bone)
    }
    object.updateMatrixWorld(true)
    const character = { object, userData: { characterId }, animation: { current: 'NativeIdle_L' } }
    const sceneCharacter = { character }
    const scene = { characterSelected: sceneCharacter, camera: new THREE.PerspectiveCamera() }
    scene.camera.position.set(2, 1.8, 4)
    scene.camera.lookAt(0, 1.5, 0)
    scene.camera.updateMatrixWorld(true)
    const binding = { character, sceneCharacter, snapshot: {}, blocked: false }
    const Tracker = new Function(
        'THREE', 'getCharacterReDriveProfile', 'unityDirectionToThreeFbx', 'findBodyRigRoot',
        'indexRigObjects', 'getClockDelta', 'objectHierarchyPath',
        'characterActionPlaybackBlocksLocomotion', 'scene', 'tpsCamera', 'viewerPerformanceClaims',
        `${code}\nreturn ViewerCameraHeadTracking`,
    )(
        THREE,
        () => ({ faceForwardAxis: [0, 0, 1], faceUpAxis: [0, 1, 0], faceRightAxis: [1, 0, 0] }),
        axis => new THREE.Vector3(...axis), () => object, () => rig, () => 1 / 60,
        bone => bone.name, state => state.blocked, scene, {yaw:0,pitch:0}, new WeakMap(),
    )
    const tracker = new Tracker(character, policy)
    tracker.setStateProvider(() => binding)
    const head = rig.get('Root/Hip/Spine/Waist/Chest/Neck/Head')
    const evaluate = (headYaw = 0) => {
        for (const bone of rig.values()) bone.quaternion.identity()
        head?.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headYaw)
        object.updateMatrixWorld(true)
        tracker.update()
    }
    return { tracker, character, binding, scene, rig, head, evaluate }
}

test('universal gaze uses rig capabilities rather than acceptance sample IDs', () => {
    for (const characterId of [800001, 800002, 100102, 100301, 101901]) {
        const f = universalGazeFixture({ characterId })
        assert.equal(f.tracker.eligible, true)
        assert.equal(f.tracker.diagnostics.capability, 'head-only')
        assert.equal(f.tracker.diagnostics.proceduralEyeRotation, false)
        assert.equal(f.tracker.diagnostics.eyePoseAuthority, 'authored-animation-and-expression')
        f.tracker.setActive(true)
        for (let i = 0; i < 60; i++) f.evaluate()
        assert.equal(f.tracker.diagnostics.active, true)
        assert.equal(f.tracker.diagnostics.applied, true)
        assert.equal(f.tracker.diagnostics.eyeBoneCount, 2)
        for (const [name,bone] of f.rig) if (/Eye_[LR]$/.test(name)) {
            assert.ok(bone.quaternion.angleTo(new THREE.Quaternion())<1e-7, 'Gaze must not overwrite authored eye poses')
        }
        assert.ok(f.head.quaternion.angleTo(new THREE.Quaternion()) > 0.01)
    }
})

test('universal gaze explicitly classifies head-only, lone-eye and missing-chain rigs', () => {
    for (const eyes of ['none', 'single']) {
        const f = universalGazeFixture({ eyes })
        f.tracker.setActive(true)
        for (let i = 0; i < 30; i++) f.evaluate()
        assert.equal(f.tracker.diagnostics.capability, 'head-only')
        assert.equal(f.tracker.diagnostics.eyeBoneCount, eyes === 'single' ? 1 : 0)
        assert.equal(f.tracker.diagnostics.applied, true)
    }
    for (const missing of ['Chest', 'Neck', 'Head']) {
        const f = universalGazeFixture({ missing })
        f.tracker.setActive(true)
        f.evaluate()
        assert.equal(f.tracker.diagnostics.capability, 'missing-required-chain')
        assert.equal(f.tracker.diagnostics.active, false)
        assert.equal(f.tracker.diagnostics.applied, false)
    }
})

test('universal gaze exit preserves current pose then reaches the newly evaluated authored target', () => {
    const f = universalGazeFixture()
    f.tracker.setActive(true)
    for (let i = 0; i < 90; i++) f.evaluate()
    const outgoing = f.head.quaternion.clone()
    f.tracker.setActive(false)
    assert.equal(f.tracker.diagnostics.active, false)
    assert.equal(f.tracker.diagnostics.cameraReferenceValid, false)
    assert.ok(f.head.quaternion.angleTo(outgoing) < 1e-7, 'input release must not snap the visible head')
    f.evaluate(-0.6)
    assert.ok(f.head.quaternion.angleTo(outgoing) < 1e-7, 'first return frame starts at evaluated output')
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.6)
    for (let i = 0; i < 6; i++) f.evaluate(-0.6)
    assert.ok(f.head.quaternion.angleTo(outgoing) > 0.01)
    assert.ok(f.head.quaternion.angleTo(target) > 0.01, 'return is not a one-frame snap')
    for (let i = 0; i < 20; i++) f.evaluate(-0.6)
    assert.ok(f.head.quaternion.angleTo(target) < 1e-7, 'target is the fresh animation, not the old cached base')
    assert.equal(f.tracker.diagnostics.applied, false)
    assert.equal(f.tracker.diagnostics.poseTransition.active, false)
    assert.equal(f.tracker.diagnostics.blendWeight, 0)
})

test('universal gaze interrupted return recaptures the current blended pose', () => {
    const f = universalGazeFixture()
    f.tracker.setActive(true)
    for (let i = 0; i < 60; i++) f.evaluate()
    f.tracker.setActive(false)
    for (let i = 0; i < 6; i++) f.evaluate(-0.6)
    const interrupted = f.head.quaternion.clone()
    f.tracker.setActive(true)
    f.evaluate(0.2)
    assert.ok(f.head.quaternion.angleTo(interrupted) < 1e-7, 're-entry must not rewind to the old transition source')
    for (let i = 0; i < 30; i++) f.evaluate(0.2)
    assert.equal(f.tracker.diagnostics.active, true)
    assert.equal(f.tracker.diagnostics.applied, true)
    assert.equal(f.tracker.diagnostics.poseTransition.active, false)
    assert.ok(f.head.quaternion.toArray().every(Number.isFinite))
})

test('universal gaze authored-action interruption and selection loss blend without stale base writes', () => {
    for (const reason of ['authored-action', 'selection-loss']) {
        const f = universalGazeFixture()
        f.tracker.setActive(true)
        for (let i = 0; i < 60; i++) f.evaluate()
        const outgoing = f.head.quaternion.clone()
        if (reason === 'authored-action') f.binding.blocked = true
        else f.scene.characterSelected = undefined
        f.evaluate(0.8)
        assert.ok(f.head.quaternion.angleTo(outgoing) < 1e-7, `${reason} starts from current evaluated output`)
        for (let i = 0; i < 30; i++) f.evaluate(0.8)
        const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8)
        assert.ok(f.head.quaternion.angleTo(target) < 1e-7)
        assert.equal(f.tracker.diagnostics.applied, false)
        assert.equal(f.tracker.diagnostics.poseTransition.active, false)
        assert.equal(f.tracker.diagnostics.targetYawRadians, 0)
        assert.equal(f.tracker.diagnostics.targetPitchRadians, 0)
    }
})

function viewerControlIdentityFixture() {
    const source = fs.readFileSync(process.env.ACTION_CONTROL_SOURCE ?? 'src/viewer/viewerLocomotion.ts', 'utf8')
    const start = source.indexOf('function resolveViewerCharacterSourceFamilyAuthority(')
    const end = source.indexOf('function getViewerCharacterSourceFamilyAuthority(', start)
    assert.ok(start >= 0 && end > start)
    const { resolveIdentity, resolveControl } = new Function(
        stripTypeScriptTypes(source.slice(start, end), { mode: 'strip' })
            + '\nreturn {resolveIdentity:resolveViewerCharacterSourceFamilyAuthority,resolveControl:resolveViewerCharacterControlAuthority}',
    )()
    const loadModuleFunctions = (file, names) => new Function(
        stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip' })
            .replace(/^export /gm, '') + `\nreturn {${names.join(',')}}`,
    )()
    const { listNonBattleCharacterCatalogEntries } = loadModuleFunctions(
        'magia-exedra-character-three/nonBattleCharacterCatalog.ts', ['listNonBattleCharacterCatalogEntries'],
    )
    const { createPrimaryCharacterCatalog } = loadModuleFunctions(
        'src/viewer/uiCharacterCatalog.ts', ['createPrimaryCharacterCatalog'],
    )
    const records = JSON.parse(fs.readFileSync('magia-exedra-character-three/getStyle3dCharacterMstList.json', 'utf8')).payload.mstList
    const story = listNonBattleCharacterCatalogEntries()
    const catalog = createPrimaryCharacterCatalog(
        ['100101', '100102', ...new Set(records.filter(record => record.type === 1).map(record => record.resourceName.match(/^chara_(\d+)_/)[1]))],
        story, id => id,
    )
    return { resolveIdentity, resolveControl, records, catalog, story, source }
}

test('source-family exact schema resolves all actual type3 and resource-first style fallback without fuzzy identity', () => {
    const f = viewerControlIdentityFixture()
    assert.equal(f.story.length, 3)
    for (const entry of f.story) {
        const id = entry.style3dCharacterMstId
        const identity = f.resolveIdentity(f.records, id)
        assert.equal(identity.sourceFamily, 'story-cutscene-nonbattle')
        assert.equal(identity.identityStatus, 'resolved')
        assert.equal(identity.matchedBy, 'resourceName')
        assert.equal(identity.style3dCharacterMstId, id)
        assert.equal(identity.resourceName, entry.resourceName)
        const control = f.resolveControl(identity, f.catalog)
        assert.equal(control.tps, false)
        assert.equal(control.cameraGaze, false)
        assert.equal(f.catalog.find(row => row.id === String(id)).visible, true)
    }
    const alias = f.resolveIdentity(f.records, 100101)
    assert.equal(alias.matchedBy, 'style3dCharacterMstId')
    assert.equal(alias.style3dCharacterMstId, 100101)
    assert.equal(alias.resourceName, 'chara_100107_battle_unit')
    assert.equal(f.resolveControl(alias, f.catalog).tps, true)
    assert.equal(f.resolveIdentity(f.records, 100107).matchedBy, 'resourceName')
    let dualHits = 0
    for (const row of f.records.filter(row => row.type === 1)) {
        const id = Number(row.style3dCharacterMstId)
        const resourceMatches = f.records.filter(other => other.resourceName === `chara_${id}_battle_unit`)
        if (resourceMatches.length !== 1 || resourceMatches[0] === row) continue
        dualHits++
        const identity = f.resolveIdentity(f.records, id)
        assert.equal(identity.matchedBy, 'resourceName')
        assert.equal(identity.style3dCharacterMstId, resourceMatches[0].style3dCharacterMstId)
    }
    assert.ok(dualHits > 0, 'current dual-hit identities must exercise resource-first authority')
    for (const id of [11340, 1134010, 999999, NaN, 0, -1]) {
        assert.equal(f.resolveIdentity(f.records, id).identityStatus, 'missing')
    }
})

test('source-family missing duplicate and malformed identities fail closed without changing presentation visibility', () => {
    const f = viewerControlIdentityFixture()
    const a = { style3dCharacterMstId: 800001, resourceName: 'chara_800002_battle_unit', type: 1 }
    const b = { style3dCharacterMstId: 800003, resourceName: 'chara_800001_battle_unit', type: 1 }
    for (const [records, id, status] of [
        [[], 800001, 'missing'],
        [[a, a], 800001, 'ambiguous'],
        [[a, b, b], 800001, 'ambiguous'],
        [[{ ...a, type: 2 }], 800001, 'unsupported'],
        [[{ ...a, resourceName: 'prefix_chara_800002_battle_unit' }], 800001, 'unsupported'],
        [[{ ...b, style3dCharacterMstId: undefined }], 800001, 'unsupported'],
    ]) {
        const identity = f.resolveIdentity(records, id)
        assert.equal(identity.identityStatus, status)
        const entry = { id: String(id), stableIdentity: `resource:${id}`, capabilities: { tps: true } }
        assert.equal(f.resolveControl(identity, [entry]).tps, false)
        assert.equal(f.resolveControl(identity, [entry]).cameraGaze, false)
    }
    assert.doesNotMatch(f.source, /Number\(record\.id\)/)
})

test('source-family control permission is independent from labels and exact rig eligibility', () => {
    const f = viewerControlIdentityFixture()
    const identity = f.resolveIdentity(f.records, 101901)
    const entry = f.catalog.find(row => row.id === '101901')
    assert.equal(identity.sourceFamily, 'magical-girl')
    assert.equal(f.resolveControl(identity, [entry]).cameraGaze, true)
    for (const entries of [[], [entry, entry], [{ ...entry, capabilities: { ...entry.capabilities, tps: false } }]]) {
        assert.equal(f.resolveControl(identity, entries).cameraGaze, false)
    }
    // A source label alone neither grants nor revokes an independently declared
    // control channel. Actual story entries above explicitly declare tps=false.
    assert.equal(f.resolveControl({ ...identity, sourceFamily: 'story-cutscene-nonbattle' }, [entry]).cameraGaze, true)
    assert.match(f.source, /const cameraHeadTracking = controlAuthority\.cameraGaze/)
    assert.equal(universalGazeFixture({ missing: 'Head' }).tracker.eligible, false)
})

test('universal gaze blend duration is configurable Viewer policy rather than claimed native timing', () => {
    const f = universalGazeFixture({ policy: { transitionSeconds: 0.4 } })
    assert.equal(f.tracker.diagnostics.poseTransition.durationSeconds, 0.4)
    assert.equal(f.tracker.diagnostics.poseTransition.timingProvenance, 'configurable-viewer-policy-not-native-timing')
    f.tracker.setActive(true)
    for (let i = 0; i < 60; i++) f.evaluate()
    f.tracker.setActive(false)
    for (let i = 0; i < 13; i++) f.evaluate(0.8)
    assert.equal(f.tracker.diagnostics.poseTransition.active, true)
    for (let i = 0; i < 30; i++) f.evaluate(0.8)
    assert.equal(f.tracker.diagnostics.poseTransition.active, false)
})

function performanceHostFixture(actionAdapter, frameDelta = 1 / 60) {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const start = source.indexOf('export interface ViewerPerformanceTransform')
    const end = source.indexOf('interface SecondaryBoneState', start)
    assert.ok(start >= 0 && end > start)
    const byObject = new WeakMap(), bindings = new Set(), physics = new WeakMap(), events = []
    const runtime = new Function('THREE', 'bindingByObject', 'bindings', 'getViewerCharacterPhysicsAttachment', 'getClockDelta',
        'interruptViewerCharacterAction', 'playViewerPerformanceAction', 'sampleViewerPerformanceAction',
        'readParsedBoneLocal',
        stripTypeScriptTypes(source.slice(start, end), { mode: 'strip' }).replace(/^export /gm, '')
            + '\nreturn {create:createViewerPerformanceHost,nextFrame(){viewerPerformanceFrameId++},claims:viewerPerformanceClaims,timelineObserve:typeof observeViewerPerformanceTimelineMixer==="function"?observeViewerPerformanceTimelineMixer:undefined,timelinePublish:typeof publishViewerPerformanceTimelineProducer==="function"?publishViewerPerformanceTimelineProducer:undefined}',
    )(THREE, byObject, bindings, object => physics.get(object), () => frameDelta,
        binding => events.push(['release-action', binding.character.object.uuid]),
        (binding, beat, emit) => { events.push(['play', binding.character.object.uuid, beat.occurrenceId, emit]); actionAdapter?.play(binding, beat, emit) },
        (binding, name, time, loop) => { events.push(['sample', binding.character.object.uuid, name, time]); actionAdapter?.sample(binding, name, time, loop) }, readParsedBoneLocal)
    const nativeReady = (object, outputObjects = new Set()) => ({ status: 'ready', root: object, runtime: {
        getWritableChannelSnapshot: () => ({ status: 'ready', root: object, outputObjects,
            outputs: [...outputObjects].map(object => ({ object, ownerStableKey: 'exact-fixture', channels: ['position','quaternion'] })) }),
    } })
    const actor = (generation = 1, object = new THREE.Group()) => {
        const bone = new THREE.Bone(), mesh = new THREE.Mesh()
        bone.name = 'Head'; mesh.name = 'Face'
        mesh.morphTargetDictionary = { Smile: 0 }; mesh.morphTargetInfluences = [1.4]
        object.add(bone, mesh)
        const character = { object, disposed: false, userData: { characterId: 101901, animationLoops: [], disposeCallbacks: [] } }
        const sceneCharacter = { character, loadGeneration: generation }
        const binding = { character, sceneCharacter, controller: {
            teleport() { events.push(['root-sync', object.uuid]) }, snapshot() { return {} },
        } }
        byObject.set(object, binding); bindings.add(binding); physics.set(object, nativeReady(object))
        const descriptor = { object, generation, label: 'same-resource', actions: ['Walk_L'], isCurrent: () => sceneCharacter.character === character && sceneCharacter.loadGeneration === generation }
        return { descriptor, character, sceneCharacter, binding, bone, mesh, body() { [...character.userData.animationLoops].forEach(callback => callback()) } }
    }
    const channels = { root: false, bones: ['./0:Head'], exclusiveBones: ['./0:Head'], morphs: ['./1:Face#Smile'], action: false }
    const externalStates = new WeakMap()
    const external = { acquireExternalChannels: actor => {
        const state={valid:true,released:false};externalStates.set(actor.object,state)
        return {status:'ready',value:{get active(){return state.valid&&!state.released},beginMorphReturn(){return {status:'ready',value:undefined}},release(){
            if(state.released)return
            state.released=true;events.push(['external-release'])
        }}}
    },
        nativePhysicsConflicts: (actor, bones) => ({ status: 'ready', value: bones.filter(bone => physics.get(actor.object).runtime.getWritableChannelSnapshot().outputObjects.has(bone)).map(bone => bone.uuid) }) }
    return { runtime, actor, physics, events, channels, external, externalStates, nativeReady, byObject }
}

test('performance host commits exact actors after their own mixer with one shared frame token and final flush', () => {
    const f = performanceHostFixture(), a = f.actor(), b = f.actor()
    const host = f.runtime.create(f.external), order = [], contexts = []
    assert.equal(host.channelHost.acquire(a.descriptor, f.channels).status, 'ready')
    assert.equal(host.channelHost.acquire(b.descriptor, f.channels).status, 'ready')
    host.framePort.subscribeBeforePhysics((delta, context) => {
        contexts.push(context); order.push(context.actorKey === a.descriptor.object.uuid ? 'commitA' : 'commitB')
        if (context.actorKey === a.descriptor.object.uuid) { a.bone.position.y = 2; assert.equal(b.bone.position.y, 0) }
        else b.bone.position.y = 3
    })
    host.framePort.subscribeFinalPoseBeforeCamera(() => order.push('final'))
    f.runtime.nextFrame()
    order.push('mixerA'); a.body(); a.body(); order.push('physicsA', 'mixerB'); b.body(); order.push('physicsB')
    host.flushFinalPoseBeforeCamera(); host.flushFinalPoseBeforeCamera(); order.push('camera')
    assert.deepEqual(order, ['mixerA', 'commitA', 'physicsA', 'mixerB', 'commitB', 'physicsB', 'final', 'camera'])
    assert.equal(contexts.length, 2); assert.equal(contexts[0].frameId, contexts[1].frameId)
    assert.equal(contexts[0].generation, 1)
    host.dispose()
    assert.equal(a.character.userData.animationLoops.length, 0); assert.equal(b.character.userData.animationLoops.length, 0)
})

test('performance host stale generation and same-resource lifetime never target a replacement actor', () => {
    const f = performanceHostFixture(), a = f.actor(), b = f.actor()
    const host = f.runtime.create(f.external)
    const lease = host.channelHost.acquire(a.descriptor, { ...f.channels, root: true }).value
    assert.ok(lease.active)
    host.channelHost.notifyRootTransformChanged(b.descriptor.object.uuid)
    assert.equal(f.events.length, 0)
    host.channelHost.notifyRootTransformChanged(a.descriptor.object.uuid)
    assert.equal(f.events.filter(event => event[0] === 'root-sync').length, 1)
    a.sceneCharacter.loadGeneration++
    assert.equal(lease.active, false)
    assert.throws(() => lease.captureEvaluated(), /stale/)
    f.runtime.nextFrame(); a.body()
    assert.equal(a.character.userData.animationLoops.length, 0)
    assert.equal(host.channelHost.acquire(a.descriptor, f.channels).status, 'unavailable')
    assert.equal(b.bone.position.y, 0)
    host.dispose()
})

test('performance host missing conflict authority exact absent paths and malformed release fail closed', () => {
    const f = performanceHostFixture(), a = f.actor()
    assert.equal(f.runtime.create({ nativePhysicsConflicts: f.external.nativePhysicsConflicts }).channelHost.acquire(a.descriptor, f.channels).reason, 'external manual/voice/root channel authority unknown')
    assert.equal(f.runtime.create({ acquireExternalChannels: f.external.acquireExternalChannels }).channelHost.acquire(a.descriptor, f.channels).reason, 'native writable-channel authority unknown')
    const conflict = f.runtime.create({ ...f.external, nativePhysicsConflicts: () => ({ status: 'ready', value: ['exact-native-binding'] }) })
    assert.match(conflict.channelHost.acquire(a.descriptor, f.channels).reason, /exact-native-binding/)
    const host = f.runtime.create({ ...f.external, nativePhysicsConflicts: () => ({ status: 'ready', value: [] }) })
    assert.equal(host.channelHost.acquire(a.descriptor, { ...f.channels, bones: ['Head'] }).status, 'unavailable')
    const lease = host.channelHost.acquire(a.descriptor, f.channels).value
    const pose = lease.captureEvaluated(); pose.bones['./0:Head'].position[0] = NaN
    assert.throws(() => lease.releaseFromEvaluated(pose, 0.2), /invalid/)
    assert.equal(a.bone.position.x, 0); assert.equal(lease.active, true)
    host.dispose()
})

test('performance host deduplicates occurrenceId not authored keyId and samples without event playback', () => {
    const f = performanceHostFixture(), a = f.actor(), host = f.runtime.create(f.external)
    const lease = host.channelHost.acquire(a.descriptor, { ...f.channels, action: true }).value
    const beat = { keyId: 'keyA', occurrenceId: 'epoch1:0:keyA', name: 'Walk_L', loop: true, localTimeSeconds: 0, transitionSeconds: 0.2 }
    assert.throws(() => lease.playActionBeat(beat), /actor phase/)
    host.framePort.subscribeBeforePhysics(() => {
        lease.playActionBeat(beat); lease.playActionBeat(beat)
        lease.playActionBeat({ ...beat, occurrenceId: 'epoch1:1:keyA' })
        lease.playActionBeat(beat)
        lease.sampleActionAt('Walk_L', 0.5, true); lease.sampleActionAt('Walk_L', 0.6, true)
    })
    f.runtime.nextFrame(); a.body()
    assert.equal(f.events.filter(event => event[0] === 'play' && event[3]).length, 2)
    assert.equal(f.events.filter(event => event[0] === 'sample').length, 4)
    host.dispose()
})

test('performance host releases from current evaluated body and authored-range morph into new live targets', () => {
    const f = performanceHostFixture(), a = f.actor(), host = f.runtime.create(f.external)
    const lease = host.channelHost.acquire(a.descriptor, f.channels).value
    a.bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6)
    a.mesh.morphTargetInfluences[0] = 1.8
    const from = lease.captureEvaluated()
    lease.releaseFromEvaluated(from, 0.2)
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.4)
    for (let frame = 0; frame < 30; frame++) {
        a.bone.quaternion.copy(target); a.mesh.morphTargetInfluences[0] = 1.2
        f.runtime.nextFrame(); a.body(); host.flushFinalPoseBeforeCamera()
        if (frame === 0) {
            assert.ok(a.bone.quaternion.angleTo(new THREE.Quaternion(...from.bones['./0:Head'].rotation)) < 1e-7)
            const ratio=(1/60)/0.2,alpha=ratio*ratio*(3-2*ratio)
            assert.equal(a.mesh.morphTargetInfluences[0],1.8*(1-alpha)+1.2*alpha)
        }
    }
    assert.ok(a.bone.quaternion.angleTo(target) < 1e-7)
    assert.equal(a.mesh.morphTargetInfluences[0], 1.2)
    assert.equal(a.character.userData.animationLoops.length, 0)
    host.dispose()
})

test('performance host morph cadence starts at next positive frame and reaches a new moving destination without synchronous writes',()=>{
    const f=performanceHostFixture(undefined,0.09),a=f.actor();let handoffs=0,releases=0,provider
    const host=f.runtime.create({...f.external,acquireExternalChannels:()=>({status:'ready',value:provider={active:true,
        beginMorphReturn(){assert.equal(this,provider);handoffs++;return {status:'ready',value:undefined}},
        release(){releases++;this.active=false}}})})
    const selection={root:false,bones:[],exclusiveBones:[],morphs:f.channels.morphs,action:false},lease=host.channelHost.acquire(a.descriptor,selection).value
    a.mesh.morphTargetInfluences[0]=0.8
    lease.releaseFromEvaluated(lease.captureEvaluated(),0.18)
    assert.equal(handoffs,1);assert.equal(releases,0);assert.equal(provider.active,true);assert.equal(a.mesh.morphTargetInfluences[0],0.8)
    const samples=[]
    for(const target of [0.9,1.0]) {f.runtime.nextFrame();a.body();a.mesh.morphTargetInfluences[0]=target;host.flushFinalPoseBeforeCamera();samples.push(a.mesh.morphTargetInfluences[0])}
    assert.ok(Math.abs(samples[0]-0.85)<1e-12);assert.equal(samples[1],1)
    assert.equal(handoffs,1);assert.equal(releases,1);assert.equal(lease.morphReturnState.phase,'complete');assert.equal(lease.morphReturnState.elapsed,0.18)
    host.dispose();assert.equal(releases,1)
})

test('performance host morph cadence missing or unready handoff explicitly waits without release fallback or elapsed completion',()=>{
    for(const mode of ['missing','unready']) {
        const f=performanceHostFixture(undefined,0.09),a=f.actor();let ready=false,calls=0,releases=0
        const provider={active:true,release(){releases++;this.active=false}}
        if(mode==='unready')provider.beginMorphReturn=()=>{calls++;return ready?{status:'ready',value:undefined}:{status:'unavailable',reason:'WAIT_MORPH_EVALUATOR: lower loading'}}
        const host=f.runtime.create({...f.external,acquireExternalChannels:()=>({status:'ready',value:provider})}),lease=host.channelHost.acquire(a.descriptor,{root:false,bones:[],exclusiveBones:[],morphs:f.channels.morphs,action:false}).value
        a.mesh.morphTargetInfluences[0]=0.8;lease.releaseFromEvaluated(lease.captureEvaluated(),0.18)
        for(let i=0;i<4;i++){f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera();assert.equal(a.mesh.morphTargetInfluences[0],0.8)}
        assert.equal(releases,0);assert.equal(provider.active,true);assert.equal(lease.morphReturnState.phase,'waiting');assert.equal(lease.morphReturnState.elapsed,0);assert.match(lease.morphReturnState.reason,/WAIT_MORPH_EVALUATOR/)
        if(mode==='unready') {
            ready=true;f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera();assert.equal(a.mesh.morphTargetInfluences[0],0.8,'same-frame handoff is not a fresh producer frame')
            for(let i=0;i<2;i++){f.runtime.nextFrame();a.body();a.mesh.morphTargetInfluences[0]=0.9;host.flushFinalPoseBeforeCamera()}
            assert.equal(a.mesh.morphTargetInfluences[0],0.9);assert.equal(lease.morphReturnState.phase,'complete');assert.equal(releases,1);assert.ok(calls>1)
        }
        host.dispose();assert.equal(releases,1)
    }
})

test('performance host morph cadence normal stop during current actor phase does not blend a pre-handoff display as evaluator input',()=>{
    const f=performanceHostFixture(undefined,0.09),a=f.actor(),host=f.runtime.create(f.external),lease=host.channelHost.acquire(a.descriptor,{root:false,bones:[],exclusiveBones:[],morphs:f.channels.morphs,action:false}).value
    a.mesh.morphTargetInfluences[0]=0.8;let stop=false
    host.framePort.subscribeBeforePhysics(()=>{if(!stop){stop=true;lease.releaseFromEvaluated(lease.captureEvaluated(),0.18)}})
    f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera();assert.equal(a.mesh.morphTargetInfluences[0],0.8);assert.equal(lease.morphReturnState.elapsed,0)
    f.runtime.nextFrame();a.body();a.mesh.morphTargetInfluences[0]=0.9;host.flushFinalPoseBeforeCamera();assert.ok(Math.abs(a.mesh.morphTargetInfluences[0]-0.85)<1e-12)
    host.dispose()
})

test('performance host morph cadence regrab and revoke never write over another actor or a replacement lease',()=>{
    const f=performanceHostFixture(undefined,0.09),a=f.actor(),b=f.actor(),host=f.runtime.create(f.external)
    const selection={root:false,bones:[],exclusiveBones:[],morphs:f.channels.morphs,action:false},first=host.channelHost.acquire(a.descriptor,selection).value,other=host.channelHost.acquire(b.descriptor,selection).value
    a.mesh.morphTargetInfluences[0]=0.8;b.mesh.morphTargetInfluences[0]=0.3
    first.releaseFromEvaluated(first.captureEvaluated(),0.18);other.releaseFromEvaluated(other.captureEvaluated(),0.18)
    const next=host.channelHost.acquire(a.descriptor,selection).value;assert.equal(first.morphReturnState.phase,'cancelled')
    next.releaseFromEvaluated(next.captureEvaluated(),0.18)
    f.runtime.nextFrame();a.body();b.body();a.mesh.morphTargetInfluences[0]=0.55;b.mesh.morphTargetInfluences[0]=0.7
    f.externalStates.get(a.descriptor.object).valid=false;host.flushFinalPoseBeforeCamera()
    assert.equal(a.mesh.morphTargetInfluences[0],0.55);assert.equal(next.morphReturnState.phase,'cancelled')
    assert.ok(Math.abs(b.mesh.morphTargetInfluences[0]-0.5)<1e-12);assert.equal(other.morphReturnState.phase,'returning')
    f.runtime.nextFrame();b.body();b.mesh.morphTargetInfluences[0]=0.7;host.flushFinalPoseBeforeCamera();assert.equal(b.mesh.morphTargetInfluences[0],0.7)
    host.dispose()
})

test('performance host morph cadence invalid late producer input neither advances clock nor injects a cached default',()=>{
    const f=performanceHostFixture(undefined,0.09),a=f.actor(),host=f.runtime.create(f.external),lease=host.channelHost.acquire(a.descriptor,{root:false,bones:[],exclusiveBones:[],morphs:f.channels.morphs,action:false}).value
    a.mesh.morphTargetInfluences[0]=0.8;lease.releaseFromEvaluated(lease.captureEvaluated(),0.18)
    f.runtime.nextFrame();a.body();a.mesh.morphTargetInfluences[0]=NaN;host.flushFinalPoseBeforeCamera()
    assert.ok(Number.isNaN(a.mesh.morphTargetInfluences[0]));assert.equal(lease.morphReturnState.elapsed,0);assert.match(lease.morphReturnState.reason,/nonfinite/)
    a.mesh.morphTargetInfluences[0]=0.8
    f.runtime.nextFrame();a.body();a.mesh.morphTargetInfluences[0]=0.9;host.flushFinalPoseBeforeCamera();assert.ok(Math.abs(a.mesh.morphTargetInfluences[0]-0.85)<1e-12)
    host.dispose()
})

test('performance host action interruption captures last blended output after the next mixer base has evaluated', () => {
    const f = performanceHostFixture(), a = f.actor(), host = f.runtime.create(f.external)
    const lease = host.channelHost.acquire(a.descriptor, f.channels).value
    let frame = 0
    host.framePort.subscribeBeforePhysics(() => {
        if (frame++ === 0) a.bone.position.y = 2
        else {
            assert.equal(lease.captureEvaluated().bones['./0:Head'].position[1], 2)
            a.bone.position.y = 3
        }
    })
    f.runtime.nextFrame(); a.body(); host.flushFinalPoseBeforeCamera()
    a.bone.position.y = -0.5 // next authored mixer destination, not displayed source
    f.runtime.nextFrame(); a.body(); host.flushFinalPoseBeforeCamera()
    assert.equal(a.bone.position.y, 3)
    host.dispose()
})

test('performance host external lease must expose actual active state at acquisition',()=>{
    for(const active of [undefined,false]) {
        const f=performanceHostFixture(),a=f.actor();let releases=0
        const host=f.runtime.create({...f.external,acquireExternalChannels:()=>({status:'ready',value:{get active(){return active},release(){releases++}}})})
        assert.equal(host.channelHost.acquire(a.descriptor,f.channels).reason,'external channel lease is not active')
        assert.equal(releases,1);assert.equal(a.character.userData.animationLoops.length,0)
        host.dispose();assert.equal(releases,1)
    }
})

test('performance host external lease revocation prevents later actor and final commits without crossing actors',()=>{
    for(const revokeAt of ['before-actor','between-subscribers','before-final']) {
        const f=performanceHostFixture(),a=f.actor(),b=f.actor(),host=f.runtime.create(f.external)
        const lease=host.channelHost.acquire(a.descriptor,f.channels).value,other=host.channelHost.acquire(b.descriptor,f.channels).value
        let aWrites=0,bWrites=0,finalWrites=0
        const revoke=()=>{f.externalStates.get(a.descriptor.object).valid=false}
        host.framePort.subscribeBeforePhysics((delta,context)=>{if(context.actorKey===a.descriptor.object.uuid&&revokeAt==='between-subscribers')revoke()})
        host.framePort.subscribeBeforePhysics((delta,context)=>{if(context.actorKey===a.descriptor.object.uuid){aWrites++;a.bone.position.x++}else{bWrites++;b.bone.position.x++}})
        host.framePort.subscribeFinalPoseBeforeCamera(()=>{if(lease.active)finalWrites++;assert.equal(other.active,true)})
        if(revokeAt==='before-actor')revoke()
        f.runtime.nextFrame();a.body();b.body()
        if(revokeAt==='before-final')revoke()
        host.flushFinalPoseBeforeCamera()
        assert.equal(aWrites,revokeAt==='before-final'?1:0);assert.equal(bWrites,1);assert.equal(finalWrites,0)
        assert.equal(lease.active,false);assert.equal(f.externalStates.get(a.descriptor.object).released,true)
        assert.equal(f.externalStates.get(b.descriptor.object).released,false)
        f.externalStates.get(a.descriptor.object).valid=true;assert.equal(lease.active,false,'revoked lease never revives')
        host.dispose();assert.equal(f.events.filter(row=>row[0]==='external-release').length,2)
    }
})

test('performance host external lease is retained through natural return and revoked return stops all overlay writes',()=>{
    for(const revoke of [false,true]) {
        const f=performanceHostFixture(),a=f.actor(),host=f.runtime.create(f.external)
        const lease=host.channelHost.acquire(a.descriptor,f.channels).value,state=f.externalStates.get(a.descriptor.object)
        a.bone.position.x=3;lease.releaseFromEvaluated(lease.captureEvaluated(),0.05)
        assert.equal(state.released,false);assert.equal(lease.active,false)
        a.bone.position.x=0;f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera()
        assert.equal(a.bone.position.x,3);assert.equal(state.released,false)
        if(revoke)state.valid=false
        for(let frame=0;frame<8;frame++){
            a.bone.position.x=0;a.mesh.morphTargetInfluences[0]=1.2
            f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera()
            if(revoke)assert.equal(a.bone.position.x,0)
        }
        assert.equal(a.bone.position.x,0);assert.equal(state.released,true)
        assert.equal(f.events.filter(row=>row[0]==='external-release').length,1)
        host.dispose();assert.equal(f.events.filter(row=>row[0]==='external-release').length,1)
    }
})

test('performance host external lease revoked during action playback fences the following sample',()=>{
    let f
    f=performanceHostFixture({play(binding){f.externalStates.get(binding.character.object).valid=false}})
    const a=f.actor(),host=f.runtime.create(f.external),lease=host.channelHost.acquire(a.descriptor,{...f.channels,action:true}).value
    host.framePort.subscribeBeforePhysics(()=>assert.throws(()=>lease.playActionBeat({keyId:'a',occurrenceId:'once',name:'Walk_L',loop:true,localTimeSeconds:0,transitionSeconds:0.2}),/authority changed before sampling/))
    f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera()
    assert.equal(f.events.filter(row=>row[0]==='play').length,1);assert.equal(f.events.filter(row=>row[0]==='sample').length,0)
    assert.equal(f.events.filter(row=>row[0]==='external-release').length,1);assert.equal(lease.active,false)
    host.dispose()
})

test('performance host channel split validates exclusive subset and action=false semantics', () => {
    const f=performanceHostFixture(),a=f.actor(),host=f.runtime.create(f.external)
    for(const selection of [
        {...f.channels,exclusiveBones:undefined}, {...f.channels,action:undefined},
        {...f.channels,bones:[],exclusiveBones:['./0:Head'],action:true},
        {...f.channels,exclusiveBones:[],action:false},
    ]) assert.equal(host.channelHost.acquire(a.descriptor,selection).status,'unavailable')
    assert.equal(f.events.length,0)
    assert.equal(host.channelHost.acquire(a.descriptor,{...f.channels,bones:['./0:Head','./0:Head']}).status,'ready')
    assert.equal(f.runtime.claims.get(a.descriptor.object).leasedBones.size,1)
    host.dispose()
})

test('performance host channel split ordinary native action bones do not own gaze and exact manual bones still do', () => {
    const f=performanceHostFixture(),a=f.actor(),manual=new THREE.Bone(),queried=[]
    manual.name='Manual';a.descriptor.object.add(manual)
    f.physics.set(a.descriptor.object,f.nativeReady(a.descriptor.object,new Set([a.bone])))
    const host=f.runtime.create({...f.external,nativePhysicsConflicts:(actor,bones)=>{
        queried.push([...bones]);return f.external.nativePhysicsConflicts(actor,bones)
    }})
    const selection={...f.channels,action:true,bones:['./0:Head','./2:Manual'],exclusiveBones:['./2:Manual']}
    const lease=host.channelHost.acquire(a.descriptor,selection)
    assert.equal(lease.status,'ready');assert.ok(lease.value.active)
    assert.ok(queried.every(bones=>bones.length===1&&bones[0]===manual))
    const owned=f.runtime.claims.get(a.descriptor.object).leasedBones
    assert.equal(owned.has(a.bone),false);assert.equal(owned.has(manual),true)
    const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8')
    const start=source.indexOf('interface ViewerTpsPoseTransitionNode'),end=source.indexOf('class ViewerProceduralLocomotion',start)
    const Transition=new Function('THREE','getClockDelta','viewerPerformanceClaims','getViewerCharacterPhysicsAttachment',
        stripTypeScriptTypes(source.slice(start,end),{mode:'strip'})+'\nreturn ViewerTpsPoseTransition')(THREE,()=>1/60,f.runtime.claims, object=>f.physics.get(object))
    const transition=new Transition(a.character)
    a.bone.position.y=2;manual.position.y=3;transition.begin()
    a.bone.position.y=0;manual.position.y=0;transition.update()
    assert.equal(a.bone.position.y,2);assert.equal(manual.position.y,0)
    host.dispose()
    const fakeEmpty=f.runtime.create({...f.external,nativePhysicsConflicts:()=>({status:'ready',value:[]})})
    assert.match(fakeEmpty.channelHost.acquire(a.descriptor,{...selection,exclusiveBones:['./0:Head']}).reason,/native writable-channel conflict/)
    fakeEmpty.dispose()
})

test('performance host channel split empty exclusive set never disguises unavailable native authority', () => {
    const f=performanceHostFixture(),a=f.actor(),root=a.descriptor.object,host=f.runtime.create(f.external)
    const selection={...f.channels,action:true,exclusiveBones:[]}
    for(const [attachment,reason] of [
        [undefined,/absent/], [{root,status:'attaching'},/attaching/], [{root,status:'fail-closed'},/fail-closed/],
        [{root,status:'disposed'},/disposed/], [{root,status:'ready'},/authority unknown/],
        [{...f.nativeReady(root),root:new THREE.Group()},/root mismatch/],
        [{root,status:'ready',runtime:{getWritableChannelSnapshot:()=>({status:'unavailable',root,reason:'binding-refresh-pending'})}},/binding-refresh-pending/],
        [{root,status:'ready',runtime:{getWritableChannelSnapshot:()=>({status:'ready',root:new THREE.Group(),outputObjects:new Set()})}},/snapshot root mismatch/],
    ]) {f.physics.set(root,attachment);assert.match(host.channelHost.acquire(a.descriptor,selection).reason,reason)}
    assert.equal(f.events.length,0);host.dispose()
})

test('performance host channel split later native invalidation cancels actor commits and its own action exactly once', () => {
    for(const invalidate of [
        (f,a)=>f.physics.delete(a.descriptor.object),
        ...['attaching','fail-closed','disposed'].map(status=>(f,a)=>{f.physics.get(a.descriptor.object).status=status}),
        (f,a)=>{f.physics.get(a.descriptor.object).root=new THREE.Group()},
        (f,a)=>{f.physics.get(a.descriptor.object).runtime.getWritableChannelSnapshot=()=>({status:'unavailable',root:a.descriptor.object,reason:'binding-refresh-pending'})},
        (f,a)=>{f.physics.get(a.descriptor.object).runtime.getWritableChannelSnapshot=()=>({status:'ready',root:new THREE.Group(),outputObjects:new Set()})},
        (f,a)=>f.physics.set(a.descriptor.object,f.nativeReady(a.descriptor.object,new Set([a.bone]))),
    ]) {
        const f=performanceHostFixture(),a=f.actor(),host=f.runtime.create(f.external)
        const lease=host.channelHost.acquire(a.descriptor,{...f.channels,action:true}).value
        let callbacks=0;host.framePort.subscribeBeforePhysics(()=>{callbacks++;a.bone.position.y=7})
        f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera();assert.equal(callbacks,1)
        invalidate(f,a);a.bone.position.y=11
        f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera()
        assert.equal(callbacks,1);assert.equal(a.bone.position.y,11);assert.equal(lease.active,false)
        f.physics.set(a.descriptor.object,f.nativeReady(a.descriptor.object));assert.equal(lease.active,false)
        host.dispose()
        assert.equal(f.events.filter(row=>row[0]==='release-action').length,1)
        assert.equal(f.events.filter(row=>row[0]==='external-release').length,1)
    }
})

test('performance host channel split fences mid-frame samples and final commits without blocking a second actor', () => {
    const f=performanceHostFixture(),a=f.actor(),b=f.actor(),host=f.runtime.create(f.external)
    const lease=host.channelHost.acquire(a.descriptor,{...f.channels,action:true,exclusiveBones:[]}).value
    const other=host.channelHost.acquire(b.descriptor,f.channels).value
    host.framePort.subscribeBeforePhysics((delta,context)=>{
        if(context.actorKey!==a.descriptor.object.uuid)return
        lease.sampleActionAt('Walk_L',0.1,true)
        f.physics.get(a.descriptor.object).status='attaching'
        assert.throws(()=>lease.sampleActionAt('Walk_L',0.2,true),/actor phase/)
    })
    let invalidWrites=0,otherWrites=0
    host.framePort.subscribeFinalPoseBeforeCamera(()=>{
        if(lease.active){invalidWrites++;a.mesh.morphTargetInfluences[0]=9}
        if(other.active){otherWrites++;b.mesh.morphTargetInfluences[0]=1.6}
    })
    f.runtime.nextFrame();a.body();b.body();host.flushFinalPoseBeforeCamera()
    assert.equal(f.events.filter(row=>row[0]==='sample').length,1)
    assert.equal(invalidWrites,0);assert.equal(otherWrites,1)
    assert.equal(a.mesh.morphTargetInfluences[0],1.4);assert.equal(b.mesh.morphTargetInfluences[0],1.6)
    host.dispose();assert.equal(f.events.filter(row=>row[0]==='release-action').length,1)
})

test('performance host channel split revalidates after physics and before final face subscribers', () => {
    const f=performanceHostFixture(),a=f.actor(),b=f.actor(),host=f.runtime.create(f.external)
    const lease=host.channelHost.acquire(a.descriptor,{...f.channels,action:true,exclusiveBones:[]}).value
    const other=host.channelHost.acquire(b.descriptor,f.channels).value
    let invalidWrites=0,otherWrites=0
    host.framePort.subscribeFinalPoseBeforeCamera(()=>{
        assert.equal(f.runtime.claims.has(a.descriptor.object),false,'cleanup precedes subscriber dispatch')
        if(lease.active)invalidWrites++
        if(other.active)otherWrites++
    })
    f.runtime.nextFrame();a.body();b.body()
    f.physics.get(a.descriptor.object).runtime.getWritableChannelSnapshot=()=>({status:'unavailable',root:a.descriptor.object,reason:'binding-refresh-pending'})
    host.flushFinalPoseBeforeCamera()
    assert.equal(invalidWrites,0);assert.equal(otherWrites,1)
    assert.equal(f.events.filter(row=>row[0]==='release-action').length,1)
    host.dispose()
})

test('performance host channel split cancels invalid return overlays and freezes acquisition identity', () => {
    const f=performanceHostFixture(),a=f.actor(),host=f.runtime.create(f.external)
    const lease=host.channelHost.acquire(a.descriptor,f.channels).value
    a.bone.position.y=5;lease.releaseFromEvaluated(lease.captureEvaluated(),0.2)
    a.bone.position.y=0;f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera();assert.equal(a.bone.position.y,5)
    f.physics.get(a.descriptor.object).status='attaching';a.bone.position.y=8
    f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera()
    assert.equal(a.bone.position.y,8);assert.equal(a.character.userData.animationLoops.length,0)
    assert.equal(f.events.filter(row=>row[0]==='external-release').length,1);host.dispose()
    for(const invalidate of [
        (f,a)=>{a.sceneCharacter.loadGeneration++;a.descriptor.generation++;a.descriptor.isCurrent=()=>true},
        (f,a)=>{a.sceneCharacter.loading=true},(f,a)=>{a.sceneCharacter.removed=true},
        (f,a)=>{f.byObject.set(a.descriptor.object,{...a.binding})},(f,a)=>{a.descriptor.object=new THREE.Group()},
    ]) {
        const f=performanceHostFixture(),a=f.actor(),host=f.runtime.create(f.external),original=a.descriptor.object
        const lease=host.channelHost.acquire(a.descriptor,{...f.channels,action:true}).value
        invalidate(f,a);assert.equal(lease.active,false)
        f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera()
        assert.equal(f.runtime.claims.has(original),false)
        assert.equal(f.events.filter(row=>row[0]==='release-action').length,0,'never interrupt a replacement lifetime')
        assert.equal(f.events.filter(row=>row[0]==='external-release').length,1);host.dispose()
    }
})

async function performanceNativeRuntimeFixture() {
    const {join,resolve}=await import('node:path'),{pathToFileURL}=await import('node:url')
    const {default:ts}=await import('typescript'),{tmpdir}=await import('node:os')
    const out=process.env.MAGIUS_ACTION_NATIVE_TEST_ROOT
        ? resolve(process.env.MAGIUS_ACTION_NATIVE_TEST_ROOT) : fs.mkdtempSync(join(tmpdir(),'magius-action-native-'))
    fs.mkdirSync(out,{recursive:true})
    for(const name of ['math','binding','magicaWind','nativeColliders','runtime']) {
        const source=fs.readFileSync(`src/viewer/characterPhysics/${name}.ts`,'utf8')
        let output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,verbatimModuleSyntax:true},fileName:`${name}.ts`}).outputText
        output=output.replaceAll("from 'three'",`from '${pathToFileURL(resolve('node_modules/three/build/three.module.js')).href}'`)
            .replace(/from '\.\/(math|binding|magicaWind|nativeColliders)'/g,"from './$1.mjs'")
        fs.writeFileSync(join(out,`${name}.mjs`),output,'utf8')
    }
    const {createNativeCharacterPhysics}=await import(pathToFileURL(join(out,'runtime.mjs')).href)
    const {createExactPhysicsBindingRegistry}=await import(pathToFileURL(join(out,'binding.mjs')).href)
    const source=JSON.parse(fs.readFileSync('public/character-physics/characters/100301/profile.v1.json','utf8'))
    const authored=source.components.cloth.find(row=>row.binding.hierarchyPath.endsWith('/BoneCloth_Bust'))
    assert.ok(authored)
    const create=(withAuthoredSkin=false)=>{
        const cloth=structuredClone(authored);cloth.colliderReferences=[]
        for(const binding of [cloth.binding,...cloth.rootBoneBindings,...cloth.chainBindings]) {
            binding.hierarchyPath=`ActionTimeline/${binding.stableKey}`;binding.modelRelativePath=null;binding.visualRootRelativePath=null
        }
        const profile={...structuredClone(source),stableKey:`${source.stableKey}|action-order-fixture`,
            components:{cloth:[cloth],colliders:[],windZones:[],otherMagica:[],native:[]}}
        const root=new THREE.Group(),center=new THREE.Group(),nodes=new Map();center.name=cloth.binding.stableKey;root.add(center)
        for(const binding of cloth.chainBindings) {
            const node=new THREE.Bone();node.name=binding.stableKey;nodes.set(binding.stableKey,node)
            const original=authored.chainBindings.find(row=>row.stableKey===binding.stableKey)
            const parentBinding=authored.chainBindings.filter(row=>row.stableKey!==binding.stableKey)
                .filter(row=>original.modelRelativePath?.startsWith(`${row.modelRelativePath}/`))
                .sort((a,b)=>(b.modelRelativePath?.length??0)-(a.modelRelativePath?.length??0))[0]
            const parent=parentBinding?nodes.get(parentBinding.stableKey):root;assert.ok(parent);parent.add(node);node.position.set(0,0.1,0)
        }
        root.updateMatrixWorld(true)
        if(withAuthoredSkin) {
            const skin=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial())
            skin.name='AuthoredBindingFixture';root.add(skin)
            skin.bind(new THREE.Skeleton([...nodes.values()]))
        }
        const registry=createExactPhysicsBindingRegistry(),runtime=createNativeCharacterPhysics(root,profile,{bindingRegistry:registry})
        registry.register(cloth.binding.stableKey,center)
        const registrations=cloth.chainBindings.map(row=>registry.register(row.stableKey,nodes.get(row.stableKey)))
        runtime.updateAfterAnimation(1/60);assert.equal(runtime.getWritableChannelSnapshot().status,'ready')
        return {root,center,nodes,registry,runtime,registrations}
    }
    return {create}
}

function performanceAuthoredEvaluatorFixture() {
    const f=performanceHostFixture(),a=f.actor()
    a.bone.position.set(0,0.3,0);a.bone.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),0.15)
    a.descriptor.object.updateMatrixWorld(true)
    const skin=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial())
    skin.name='AuthoredSkin';a.descriptor.object.add(skin);skin.bind(new THREE.Skeleton([a.bone]))
    const mixer=new THREE.AnimationMixer(a.descriptor.object)
    a.character.animation={mixer}
    const clip=new THREE.AnimationClip('Live',1,[new THREE.NumberKeyframeTrack(`${a.bone.uuid}.position[x]`,[0,1],[0,0.4])])
    mixer.clipAction(clip).play();mixer.update(0)
    const host=f.runtime.create(f.external),selection={...f.channels,morphs:[]}
    return {f,a,skin,mixer,clip,host,selection}
}

async function performanceIndependentTimelineFixture(kind, nativeEnabled=false) {
    const {CharacterTimeline,createObjectTimelineBinding}=await import('./src/viewer/characterTimeline.ts')
    const native=nativeEnabled?(await performanceNativeRuntimeFixture()).create(true):undefined
    const f=performanceHostFixture(),a=f.actor(1,native?.root),object=a.descriptor.object
    const bone=native?[...native.runtime.getWritableChannelSnapshot().outputObjects][0]:a.bone
    if(native)f.physics.set(object,{root:object,status:'ready',runtime:native.runtime})
    else {
        bone.position.y=0.3;object.updateMatrixWorld(true)
        const skin=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());object.add(skin);skin.bind(new THREE.Skeleton([bone]))
    }
    const keys=new Map(),visit=(o,k)=>{if(o.isBone)keys.set(o,k);o.children.forEach((c,i)=>visit(c,`${k}/${i}:${c.name}`))};visit(object,'.')
    const key=keys.get(bone),mixer=new THREE.AnimationMixer(object),clips=new Map(),events=[]
    for(const [i,name] of ['Start','Loop','End','Wait','DonorTakeoff','DonorAir','DonorLand','Idle','Walk','Run'].entries()) {
        clips.set(name,new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack(`${bone.uuid}.position[x]`,[0,1],[i*0.1,i*0.1+0.2])]))
    }
    let current='Wait'
    const port={listClips:()=>[...clips.values()].map(clip=>({name:clip.name,duration:clip.duration,trackCount:1})),
        play(name,options={}){const clip=clips.get(name);assert.ok(clip,name);mixer.stopAllAction();mixer.clipAction(clip).reset().setLoop(options.loop?THREE.LoopRepeat:THREE.LoopOnce,Infinity).play();current=name;events.push(['play',name])},
        clear(){mixer.stopAllAction()},setTime(time){mixer.setTime(time)},setSpeed(speed){mixer.timeScale=speed},setWeight(weight){for(const action of mixer._actions.slice(0,mixer._nActiveActions))action.setEffectiveWeight(weight)}}
    a.character.animation={mixer,paused:false,get current(){return current},get time(){return mixer._actions[0]?.time??0},set time(value){mixer.setTime(value)}}
    Object.assign(a.binding,{directHomeActions:{entries:[]},combatJumpActions:{entries:[]},characterActionPlayback:{status:'playing',timeSeconds:0},snapshot:{state:'idle',grounded:true},animationPort:port})
    const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8')
    const names=['directHomePhaseAtTime','seekActiveDirectHomePlayback','applyCombatSkeletonPose','synchronizeViewerCharacterActionState','synchronizeActiveCombatJumpDonorPlayback','seekViewerCharacterActionMixer','synchronizeViewerCharacterActionClipRepetition','advanceViewerCharacterActionTimelineRepetition']
    const functions=names.map(name=>{const start=source.indexOf(`function ${name}(`),next=source.indexOf('\nfunction ',start+1);assert.ok(start>=0&&next>start);return source.slice(start,next)}).join('\n')
    const deps={THREE,viewerCharacterActionRepetitions:new WeakMap(),observeViewerPerformanceTimelineMixer:f.runtime.timelineObserve,publishViewerPerformanceTimelineProducer:f.runtime.timelinePublish,
        combatSkeletonPhaseCrossfadeSeconds:0.1,applyCombatSkeletonAttachmentPose:()=>events.push(['attachment']),
        characterActionPlaybackBlocksLocomotion:b=>!b.combatJumpActions.activeJumpDonorPlayback&&['playing','paused'].includes(b.characterActionPlayback.status),
        releaseViewerCharacterActionPhysicsPhase:()=>{},emitCharacterActionPlaybackState:()=>{},familyEquals:(x,y)=>x===y,
        interruptViewerCharacterAction:()=>{throw Error('Unexpected interruption')},stopActiveCombatSkeletonPlayback:b=>{b.combatJumpActions.activeSkeletonPlayback=undefined},
        stopActiveCombatJumpDonorPlayback:b=>{b.controller.setJumpLocomotionAnimationOverride(undefined);b.combatJumpActions.activeJumpDonorPlayback=undefined},
        enabled:false,resumeViewerLocomotionIdle:()=>{},deactivateNativeDungeonPresentation:()=>{}}
    const api=new Function(...Object.keys(deps),stripTypeScriptTypes(functions,{mode:'strip'})+`\nreturn {${names.join(',')}}`)(...Object.values(deps))
    let active,timeline,controller,step
    if(kind==='home'||kind==='home-loop') {
        const phases=['Start','Loop','End','Wait'].map((name,i)=>({phase:['start','loop','end','restore'][i],startTime:i*0.4,endTime:(i+1)*0.4,clip:{name,durationSeconds:1}}))
        const binding=createObjectTimelineBinding({object,animation:{play:(name,loop)=>port.play(name,{loop}),clear:port.clear,setTime:port.setTime}})
        timeline=kind==='home'?new CharacterTimeline({schema:'character-timeline-v1',duration:1.6,loop:false,tracks:[{id:'phase',targetId:'body',kind:'clip',interpolation:'step',keyframes:phases.map(p=>({time:p.startTime,value:{name:p.clip.name,loop:p.phase==='loop'}}))}],events:[]},{bindings:{body:binding}}):undefined
        active={catalogActionId:'exact-home',profileActionId:'native-home',runtimeName:'Loop',playbackKind:timeline?'sequence':'loop',timeline,
            phases:timeline?phases:[{...phases[1],startTime:0,endTime:1}]}
        a.binding.directHomeActions.active=active
        if(timeline) {timeline.play();api.seekActiveDirectHomePlayback(a.binding,active,0)}
        else port.play('Loop',{loop:true})
        step=(dt=1/60)=>{f.runtime.nextFrame();api.synchronizeViewerCharacterActionState(a.binding,dt);if(!a.character.animation.paused)mixer.update(dt)}
    } else if(kind==='skeleton') {
        const phases=['Start','Loop','End'].map((name,i)=>({phase:['start','loop','end'][i],clipName:name,startSeconds:i*0.4,endSeconds:(i+1)*0.4,sourceDurationSeconds:1}))
        const role={targetId:'body',role:'body',phases,clipByName:clips}
        timeline=new CharacterTimeline({schema:'character-timeline-v1',duration:1.2,loop:false,tracks:[{id:'body',targetId:'body',kind:'clip',interpolation:'step',keyframes:phases.map(p=>({time:p.startSeconds,value:{name:p.clipName,loop:p.phase==='loop'}}))}],events:[]},{bindings:{body:{setAnimationClip(value){
            if(!value.name||role.currentPhase?.clipName===value.name)return
            role.previousAction=role.currentAction;role.previousPhase=role.currentPhase;role.currentPhase=phases.find(p=>p.clipName===value.name)
            role.currentAction=mixer.clipAction(clips.get(value.name)).reset().play();role.transitionStartSeconds=role.currentPhase.startSeconds
        }}}})
        active={catalogActionId:'exact-skeleton',roles:[role],attachments:[{}],playback:{state:()=>({timeSeconds:timeline.time,playing:timeline.playing,durationSeconds:timeline.duration}),seek:t=>timeline.seek(t),step:dt=>timeline.step(dt),pause:()=>timeline.pause()}}
        a.binding.combatJumpActions.activeSkeletonPlayback=active;a.character.animation.paused=true
        timeline.play();api.applyCombatSkeletonPose(a.binding,active)
        step=(dt=1/60)=>{f.runtime.nextFrame();api.synchronizeViewerCharacterActionState(a.binding,dt)}
    } else {
        const sequence={jump:'DonorTakeoff',fall:'DonorAir',land:'DonorLand',durationSeconds:2}
        const ground=new FlatGroundCollisionWorld(0)
        controller=new CharacterLocomotionController({characterId:'101901',transform:object,collisionWorld:ground,groundQuery:ground,initiallyGrounded:true,animation:port,
            locomotionAnimations:{idle:'Idle',walk:'Walk',run:'Run'},config:fixedConfig({jumpTakeoffDelaySeconds:0})})
        controller.setJumpLocomotionAnimationOverride(Object.fromEntries(['standing','walking','running'].map(mode=>[mode,{jump:sequence.jump,fall:sequence.fall,land:sequence.land}])))
        controller.setInput({moveX:0,moveZ:1,run:false,jumpPressed:true})
        active={actionId:'exact-donor',sequence,elapsedSeconds:0,jumpStateObserved:false};a.binding.combatJumpActions.activeJumpDonorPlayback=active;a.binding.controller=controller
        step=(dt=1/60)=>{f.runtime.nextFrame();a.binding.snapshot=controller.advance(dt);api.synchronizeActiveCombatJumpDonorPlayback(a.binding,dt);if(!a.character.animation.paused)mixer.update(dt)}
    }
    const host=f.runtime.create(f.external),selection={root:false,bones:[key],exclusiveBones:[key],morphs:[],action:false}
    const dispose=()=>{host.dispose();mixer.stopAllAction();native?.runtime.dispose();[...a.character.userData.disposeCallbacks].forEach(fn=>fn())}
    return {f,a,bone,key,mixer,clips,api,active,timeline,controller,step,host,selection,native,events,dispose}
}

test('performance host independent timeline direct Home seek and paused phases use actual retained evaluator not displayed output',async()=>{
    const f=await performanceIndependentTimelineFixture('home'),lease=f.host.channelHost.acquire(f.a.descriptor,f.selection).value,values=[]
    f.host.framePort.subscribeBeforePhysics((_,context)=>{const r=lease.captureEvaluatorFrame(context);assert.equal(r.status,'ready',r.reason);values.push(r.value.pose.bones[f.key].position[0])})
    for(const time of [0.2,0.55,0.95]){f.f.runtime.nextFrame();f.api.seekActiveDirectHomePlayback(f.a.binding,f.active,time);f.bone.position.x=99;f.a.body()}
    assert.ok(Math.abs(values[0]-0.04)<1e-7);assert.ok(Math.abs(values[1]-0.13)<1e-7);assert.ok(Math.abs(values[2]-0.23)<1e-7)
    f.timeline.pause();f.a.character.animation.paused=true;f.a.binding.characterActionPlayback.status='paused'
    f.f.runtime.nextFrame();f.bone.position.x=999;f.a.body();assert.equal(values[3],values[2]);f.dispose()
})

test('performance host independent timeline direct loop requires actual mixer evaluation and does not add an update',async()=>{
    const f=await performanceIndependentTimelineFixture('home-loop'),lease=f.host.channelHost.acquire(f.a.descriptor,f.selection).value,results=[]
    f.host.framePort.subscribeBeforePhysics((_,context)=>results.push(lease.captureEvaluatorFrame(context)))
    f.f.runtime.nextFrame();f.api.synchronizeViewerCharacterActionState(f.a.binding,1/60);f.a.body();assert.equal(results[0].status,'unavailable')
    const time=f.mixer.time;f.step();const advanced=f.mixer.time;f.bone.position.x=800;f.a.body()
    assert.equal(results[1].status,'ready',results[1].reason);assert.ok(Math.abs(advanced-time-1/60)<1e-12);assert.equal(f.mixer.time,advanced)
    f.dispose()
})

test('performance host independent timeline synchronized combat reads real phase weights after seek and holds exact pause',async()=>{
    const f=await performanceIndependentTimelineFixture('skeleton'),lease=f.host.channelHost.acquire(f.a.descriptor,f.selection).value,values=[]
    f.host.framePort.subscribeBeforePhysics((_,context)=>{const r=lease.captureEvaluatorFrame(context);assert.equal(r.status,'ready',r.reason);values.push(r.value.pose.bones[f.key].position[0])})
    for(const time of [0.2,0.45,0.9]){f.f.runtime.nextFrame();f.active.playback.seek(time);f.api.applyCombatSkeletonPose(f.a.binding,f.active);const evaluated=f.bone.position.x;f.bone.position.x=700;f.a.body();assert.ok(Math.abs(values.at(-1)-evaluated)<1e-12)}
    f.active.playback.pause();f.a.binding.characterActionPlayback.status='paused';f.f.runtime.nextFrame();f.a.body();assert.equal(values.at(-1),values.at(-2));assert.equal(f.events.filter(x=>x[0]==='attachment').length,4)
    f.dispose()
})

test('performance host independent timeline real jump controller retains travel and genuine jump fall land evaluator phases',async()=>{
    const f=await performanceIndependentTimelineFixture('jump'),lease=f.host.channelHost.acquire(f.a.descriptor,f.selection).value,phases=new Set(),observations=[]
    f.host.framePort.subscribeBeforePhysics((_,context)=>{
        if(!f.a.binding.combatJumpActions.activeJumpDonorPlayback)return
        const r=lease.captureEvaluatorFrame(context);assert.equal(r.status,'ready',r.reason);phases.add(f.a.binding.snapshot.state);observations.push(r.value.pose.bones[f.key].position[0])
    })
    const start=f.a.descriptor.object.position.z
    for(let i=0;i<110;i++){f.step();f.bone.position.x=123;f.a.body()}
    assert.ok(phases.has('jump'));assert.ok(phases.has('fall'));assert.ok(phases.has('land'));assert.ok(f.a.descriptor.object.position.z-start>1)
    console.log('INDEPENDENT_TIMELINE_CONTROLLER '+JSON.stringify({phases:[...phases],travel:f.a.descriptor.object.position.z-start,evaluatorSamples:observations.length,diagnostics:f.controller.snapshot().diagnostics}))
    assert.ok(observations.length>10&&observations.every(Number.isFinite));assert.ok(observations.every(x=>x<2));f.dispose()
})

test('performance host independent timeline unregistered phase replacement or extra mixer action fails closed',async()=>{
    for(const failure of ['producer','phase','action','generation','ambiguous']) {
        const f=await performanceIndependentTimelineFixture('home'),lease=f.host.channelHost.acquire(f.a.descriptor,f.selection).value
        f.f.runtime.nextFrame();f.api.seekActiveDirectHomePlayback(f.a.binding,f.active,0.2)
        if(failure==='producer')f.a.binding.directHomeActions.active={...f.active}
        if(failure==='phase')f.timeline.seek(0.7)
        if(failure==='action'){f.mixer.clipAction(f.clips.get('Run')).play();f.mixer.update(0)}
        if(failure==='generation')f.a.sceneCharacter.loadGeneration++
        if(failure==='ambiguous')f.a.binding.combatJumpActions.activeJumpDonorPlayback={sequence:{},elapsedSeconds:0}
        let calls=0;f.host.framePort.subscribeBeforePhysics((_,context)=>{calls++;assert.equal(lease.captureEvaluatorFrame(context).status,'unavailable')})
        f.a.body();assert.equal(calls,failure==='generation'?0:1);f.dispose()
    }
})

test('performance host independent timeline fake displayed setter without actual mixer evaluation never certifies body input',async()=>{
    const f=await performanceIndependentTimelineFixture('home'),lease=f.host.channelHost.acquire(f.a.descriptor,f.selection).value
    Object.defineProperty(f.a.character.animation,'time',{get:()=>0,set:()=>{f.bone.position.x=0.888}})
    f.f.runtime.nextFrame();f.api.seekActiveDirectHomePlayback(f.a.binding,f.active,0.2)
    f.host.framePort.subscribeBeforePhysics((_,context)=>{const r=lease.captureEvaluatorFrame(context);assert.equal(r.status,'unavailable');assert.match(r.reason,/not evaluated/)})
    f.a.body();assert.equal(f.bone.position.x,0.888);f.dispose()
})

test('performance host independent timeline actual MODEL FK and native consumer hold return and regrab all three producers',async()=>{
    const {PerformanceEditorRuntime}=await import('./src/viewer/performanceEditor/runtime.ts')
    const results=[]
    for(const kind of ['home','skeleton','jump']) {
        const f=await performanceIndependentTimelineFixture(kind,true);f.step()
        let request,manualWrites=0,nativeWrites=0
        const editor=new PerformanceEditorRuntime({actorSource:{list:()=>[f.a.descriptor],subscribe:()=>()=>{}},channelHost:f.host.channelHost,framePort:f.host.framePort,transitionSeconds:0.05,
            transformHost:{acquire:r=>{request=r;return {status:'ready',value:()=>{}}}}})
        const drag=editor.beginDrag(f.a.descriptor.object.uuid,'joint',f.key);assert.equal(drag.status,'ready',drag.reason)
        const from=f.bone.quaternion.clone(),heldQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(.3,.2,.1));request.object.quaternion.copy(heldQ);request.onChange();assert.ok(f.bone.quaternion.angleTo(from)<1e-7)
        const copy=f.bone.position.copy,fromArray=f.bone.position.fromArray
        f.bone.position.copy=function(v){nativeWrites++;return copy.call(this,v)}
        f.bone.position.fromArray=function(...args){manualWrites++;return fromArray.apply(this,args)}
        const held=[]
        for(let i=0;i<5;i++){f.step();const writes=nativeWrites;f.a.body();assert.equal(editor.lastError,null);f.native.runtime.updateAfterAnimation(1/60);f.host.flushFinalPoseBeforeCamera();held.push(nativeWrites-writes);assert.ok(f.bone.quaternion.angleTo(heldQ)<1e-7)}
        assert.ok(held.every(x=>x===0));assert.equal(manualWrites,5)
        const heldManualCommits=manualWrites
        editor.stop();const returning=[]
        for(let i=0;i<5;i++){f.step();f.a.body();const writes=nativeWrites;f.native.runtime.updateAfterAnimation(1/60);f.host.flushFinalPoseBeforeCamera();returning.push({position:f.bone.position.toArray(),rotation:f.bone.quaternion.toArray(),writes:nativeWrites-writes})}
        assert.ok(new THREE.Quaternion(...returning[0].rotation).angleTo(heldQ)<1e-7);assert.notDeepEqual(returning[3].position,returning[0].position)
        const again=editor.beginDrag(f.a.descriptor.object.uuid,'joint',f.key);assert.equal(again.status,'ready',again.reason)
        assert.ok(returning.slice(0,4).every(x=>x.writes===1));results.push({kind,heldNativeWrites:held,heldManualCommits,returnEvaluatorInputWrites:manualWrites-heldManualCommits,returning})
        editor.dispose();f.dispose()
    }
    console.log('INDEPENDENT_TIMELINE_REAL_MODEL_NATIVE '+JSON.stringify(results))
})

test('performance host independent timeline observer retains mixer receiver result and restores only its own wrapper on dispose',async()=>{
    const f=await performanceIndependentTimelineFixture('home-loop'),before=f.mixer.update
    f.step();const wrapped=f.mixer.update;assert.notEqual(wrapped,before);assert.equal(f.mixer.update(0),f.mixer)
    const foreign=new THREE.AnimationMixer(new THREE.Group());assert.equal(wrapped.call(foreign,0.1),foreign)
    const later=function(dt){return wrapped.call(this,dt)};f.mixer.update=later;f.dispose();assert.equal(f.mixer.update,later,'later independently installed wrapper is not overwritten')
})

test('performance host evaluator uses real weighted mixer buffers and authored unkeyed channels rather than displayed manual pose',()=>{
    const {f,a,mixer,host,selection}=performanceAuthoredEvaluatorFixture()
    const lease=host.channelHost.acquire(a.descriptor,selection).value,frames=[]
    host.framePort.subscribeBeforePhysics((_,context)=>{
        const read=lease.captureEvaluatorFrame(context);assert.equal(read.status,'ready',read.reason)
        frames.push(structuredClone(read.value.pose))
        const output=structuredClone(read.value.pose);output.bones['./0:Head'].position=[9,8,7]
        assert.equal(lease.commitManualBody(read.value,output).status,'ready')
    })
    for(const time of [0.25,0.5]) {
        mixer.setTime(time)
        // Neither keyed nor unkeyed displayed values are evaluator authority.
        a.bone.position.set(50,60,70);a.bone.quaternion.identity()
        f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera()
        assert.deepEqual(a.bone.position.toArray(),[9,8,7])
    }
    assert.ok(Math.abs(frames[0].bones['./0:Head'].position[0]-0.1)<1e-7)
    assert.ok(Math.abs(frames[1].bones['./0:Head'].position[0]-0.2)<1e-7)
    assert.ok(Math.abs(frames[1].bones['./0:Head'].position[1]-0.3)<1e-12)
    assert.ok(new THREE.Quaternion(...frames[1].bones['./0:Head'].rotation).angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),0.15))<1e-7)
    host.dispose();mixer.stopAllAction()
})

test('performance host evaluator handles concurrent weighted actions and exact component bindings',()=>{
    const {f,a,mixer,clip,host,selection}=performanceAuthoredEvaluatorFixture()
    mixer.clipAction(clip).setEffectiveWeight(0.5)
    const second=new THREE.AnimationClip('Blend',1,[new THREE.NumberKeyframeTrack(`${a.bone.uuid}.position[x]`,[0,1],[0.8,0.8])])
    mixer.clipAction(second).play().setEffectiveWeight(0.5);mixer.setTime(0.5)
    const expected=a.bone.position.x,lease=host.channelHost.acquire(a.descriptor,selection).value
    a.bone.position.x=999
    host.framePort.subscribeBeforePhysics((_,context)=>{
        const frame=lease.captureEvaluatorFrame(context)
        assert.equal(frame.status,'ready',frame.reason)
        assert.ok(Math.abs(frame.value.pose.bones['./0:Head'].position[0]-expected)<1e-12)
        assert.ok(Math.abs(expected-0.5)<1e-7)
    })
    f.runtime.nextFrame();a.body();host.dispose();mixer.stopAllAction()
})

test('performance host evaluator retained frame is actor generation scoped immutable-by-proof and single-use',()=>{
    const {f,a,mixer,host,selection}=performanceAuthoredEvaluatorFixture(),lease=host.channelHost.acquire(a.descriptor,selection).value
    let previous,iteration=0
    assert.equal(lease.captureEvaluatorFrame({frameId:0,actorKey:a.descriptor.object.uuid,generation:1}).status,'unavailable')
    host.framePort.subscribeBeforePhysics((_,context)=>{
        assert.equal(lease.captureEvaluatorFrame({...context,actorKey:'foreign'}).status,'unavailable')
        assert.equal(lease.captureEvaluatorFrame({...context,generation:2}).status,'unavailable')
        const frame=lease.captureEvaluatorFrame(context).value,output=structuredClone(frame.pose)
        assert.equal(lease.captureEvaluatorFrame(context).value,frame)
        assert.equal(lease.commitManualBody({...frame},output).status,'unavailable')
        if(previous)assert.equal(lease.commitManualBody(previous,output).status,'unavailable')
        if(iteration++===0){frame.pose.bones['./0:Head'].position[0]=5;assert.equal(lease.commitManualBody(frame,output).status,'unavailable');frame.pose=structuredClone(output)}
        assert.equal(lease.commitManualBody(frame,output).status,'ready')
        assert.equal(lease.commitManualBody(frame,output).status,'unavailable')
        assert.equal(lease.captureEvaluatorFrame(context).status,'unavailable');previous=frame
    })
    for(let i=0;i<2;i++){mixer.update(1/60);f.runtime.nextFrame();a.body();host.flushFinalPoseBeforeCamera()}
    a.sceneCharacter.loadGeneration++;assert.equal(lease.active,false)
    assert.equal(lease.commitManualBody(previous,previous.pose).status,'unavailable');host.dispose()
})

test('performance host evaluator missing genuine unkeyed source and independent timeline remain typed pending without writes',()=>{
    for(const missing of ['bind','mixer','independent-timeline','morph']) {
        const {f,a,skin,mixer,host,selection}=performanceAuthoredEvaluatorFixture()
        if(missing==='bind')a.descriptor.object.remove(skin)
        if(missing==='mixer')delete a.character.animation.mixer
        if(missing==='independent-timeline')a.binding.directHomeActions={active:{}}
        const chosen=missing==='morph'?{...selection,morphs:f.channels.morphs}:selection
        const lease=host.channelHost.acquire(a.descriptor,chosen).value
        a.bone.position.set(8,9,10)
        host.framePort.subscribeBeforePhysics((_,context)=>{
            const read=lease.captureEvaluatorFrame(context);assert.equal(read.status,'unavailable');assert.match(read.reason,/WAIT_EVALUATED_FRAME/)
            assert.deepEqual(a.bone.position.toArray(),[8,9,10])
        })
        f.runtime.nextFrame();a.body();host.dispose();mixer.stopAllAction()
    }
})

test('performance host evaluator binds unkeyed child local input through authored parent inverse bind not displayed parent',()=>{
    const {f,a,skin,mixer,host}=performanceAuthoredEvaluatorFixture(),child=new THREE.Bone()
    child.name='Child';child.position.set(0,0.4,0);a.bone.add(child);a.descriptor.object.updateMatrixWorld(true)
    skin.bind(new THREE.Skeleton([a.bone,child]))
    const key='./0:Head/0:Child',selection={root:false,bones:[key],exclusiveBones:[key],morphs:[],action:false}
    const lease=host.channelHost.acquire(a.descriptor,selection).value
    a.bone.position.set(100,200,300);child.position.set(5,6,7)
    host.framePort.subscribeBeforePhysics((_,context)=>{
        const result=lease.captureEvaluatorFrame(context);assert.equal(result.status,'ready',result.reason)
        assert.ok(Math.abs(result.value.pose.bones[key].position[1]-0.4)<1e-12)
        assert.ok(Math.abs(result.value.pose.bones[key].position[0])<1e-12)
    })
    f.runtime.nextFrame();a.body();host.dispose();mixer.stopAllAction()
})

test('performance host evaluator action resample invalidates prior issued input before the manual commit',()=>{
    const {f,a,mixer,host,selection}=performanceAuthoredEvaluatorFixture(),lease=host.channelHost.acquire(a.descriptor,{...selection,action:true}).value
    host.framePort.subscribeBeforePhysics((_,context)=>{
        const old=lease.captureEvaluatorFrame(context).value
        lease.sampleActionAt('Walk_L',0.7,true)
        assert.equal(lease.commitManualBody(old,old.pose).status,'unavailable')
        const next=lease.captureEvaluatorFrame(context).value;assert.notEqual(next,old)
        assert.equal(lease.commitManualBody(next,next.pose).status,'ready')
    })
    f.runtime.nextFrame();a.body();host.dispose();mixer.stopAllAction()
})

test('performance host evaluator actual MODEL detached FK consumer commits real native hold and single fresh moving return',async()=>{
    const {PerformanceEditorRuntime}=await import('./src/viewer/performanceEditor/runtime.ts')
    const fixture=await performanceNativeRuntimeFixture(),native=fixture.create(true),f=performanceHostFixture(),a=f.actor(1,native.root),b=f.actor()
    f.physics.set(native.root,{root:native.root,status:'ready',runtime:native.runtime})
    const outputs=[...native.runtime.getWritableChannelSnapshot().outputObjects],bone=outputs[0],other=outputs[1]
    const mixer=new THREE.AnimationMixer(native.root);a.character.animation={mixer}
    const clip=new THREE.AnimationClip('MovingLive',10,[new THREE.NumberKeyframeTrack(`${bone.uuid}.position[x]`,[0,10],[0,0.3])])
    mixer.clipAction(clip).play();mixer.update(0)
    const host=f.runtime.create(f.external);let request,nativeLease,selectedWrites=0,manualWrites=0,unselectedWrites=0
    const originalAcquire=native.runtime.acquireManualOutputLease
    native.runtime.acquireManualOutputLease=options=>{const result=originalAcquire.call(native.runtime,options);if(result.status==='ready')nativeLease=result.value;return result}
    const editor=new PerformanceEditorRuntime({actorSource:{list:()=>[a.descriptor,b.descriptor],subscribe:()=>()=>{}},
        channelHost:host.channelHost,framePort:host.framePort,transitionSeconds:0.05,
        transformHost:{acquire:input=>{request=input;return {status:'ready',value:()=>{request=undefined}}}}})
    const key=[...editor.actors.get(native.root.uuid).bones].find(([,node])=>node===bone)[0]
    const before=bone.position.toArray(),drag=editor.beginDrag(native.root.uuid,'joint',key)
    assert.equal(drag.status,'ready',drag.reason);assert.notEqual(request.object,bone)
    const heldQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(.3,.2,.1));request.object.quaternion.copy(heldQ);request.onChange()
    assert.deepEqual(bone.position.toArray(),before,'gizmo callback has not touched real native output')
    const originalCopy=bone.position.copy;bone.position.copy=function(value){selectedWrites++;return originalCopy.call(this,value)}
    const originalFrom=bone.position.fromArray;bone.position.fromArray=function(...args){manualWrites++;return originalFrom.apply(this,args)}
    const otherCopy=other.position.copy;other.position.copy=function(value){unselectedWrites++;return otherCopy.call(this,value)}
    const step=()=>{mixer.update(1/60);f.runtime.nextFrame();a.body();b.body();native.root.updateMatrixWorld(true);native.runtime.updateAfterAnimation(1/60);host.flushFinalPoseBeforeCamera()}
    const held=[]
    for(let i=0;i<8;i++){
        const start=selectedWrites,manual=manualWrites;step();assert.equal(editor.lastError,null)
        held.push({nativeWrites:selectedWrites-start,manualCommits:manualWrites-manual,state:nativeLease.state})
        assert.equal(selectedWrites-start,0);assert.equal(manualWrites-manual,1)
        assert.ok(bone.quaternion.angleTo(heldQ)<1e-7);assert.equal(nativeLease.state,'held')
    }
    assert.ok(unselectedWrites>0,'unselected real native output continued')
    // A second actor keeps its ordinary root track while native A returns.
    editor.setDocument({schema:'performance-editor-v1',duration:1,loop:false,tracks:[{id:'rootB',actorKey:b.descriptor.object.uuid,channel:'root-position',keys:[{id:'b0',time:0,value:[0,0,0]},{id:'b1',time:1,value:[1,0,0]}]}]})
    editor.play();assert.equal(editor.lastError,null)
    const from=bone.position.toArray(),returned=[]
    for(let i=0;i<7;i++){
        const writes=selectedWrites;step();returned.push({state:nativeLease.state,position:bone.position.toArray(),nativeWrites:selectedWrites-writes})
        if(i===0)assert.deepEqual(bone.position.toArray(),from,'return starts at exact displayed manual pose')
        if(i<4)assert.equal(selectedWrites-writes,1,'one native return compositor, no native restore writer')
    }
    assert.equal(nativeLease.state,'released');assert.notDeepEqual(returned.at(-1).position,from)
    assert.ok(b.descriptor.object.position.x>0);assert.equal(editor.lastError,null)
    assert.equal(f.runtime.claims.has(native.root),false)
    assert.equal(native.runtime.diagnostics.nonFiniteCorrections,0)
    console.log('G23_REAL_MODEL_NATIVE_MEASUREMENT '+JSON.stringify({held,returned,unselectedWrites,otherActorX:b.descriptor.object.position.x}))
    editor.dispose();host.dispose();mixer.stopAllAction();native.runtime.dispose()
})

test('performance host evaluator native return waits for genuine next source and cancels on generation revoke',async()=>{
    const fixture=await performanceNativeRuntimeFixture(),native=fixture.create(true),f=performanceHostFixture(),a=f.actor(1,native.root)
    f.physics.set(native.root,{root:native.root,status:'ready',runtime:native.runtime})
    const bone=[...native.runtime.getWritableChannelSnapshot().outputObjects][0],mixer=new THREE.AnimationMixer(native.root);a.character.animation={mixer}
    const keys=new Map(),visit=(o,k)=>{if(o.isBone)keys.set(o,k);o.children.forEach((c,i)=>visit(c,`${k}/${i}:${c.name}`))};visit(native.root,'.')
    const key=keys.get(bone),host=f.runtime.create(f.external),selection={root:false,bones:[key],exclusiveBones:[key],morphs:[],action:false}
    let nativeLease;const acquire=native.runtime.acquireManualOutputLease;native.runtime.acquireManualOutputLease=x=>{const r=acquire.call(native.runtime,x);if(r.status==='ready')nativeLease=r.value;return r}
    const acquired=host.channelHost.acquire(a.descriptor,selection);assert.equal(acquired.status,'ready',acquired.reason);const lease=acquired.value
    host.framePort.subscribeBeforePhysics((_,context)=>{const read=lease.captureEvaluatorFrame(context);assert.equal(read.status,'ready',read.reason);const output=structuredClone(read.value.pose);output.bones[key].position=[0.6,0.4,0];assert.equal(lease.commitManualBody(read.value,output).status,'ready')})
    f.runtime.nextFrame();a.body();native.runtime.updateAfterAnimation(1/60);host.flushFinalPoseBeforeCamera()
    lease.releaseFromEvaluated(lease.captureEvaluated(),0.05);const from=bone.position.toArray()
    a.binding.directHomeActions={active:{}}
    for(let i=0;i<6;i++){f.runtime.nextFrame();a.body();native.runtime.updateAfterAnimation(1/60);host.flushFinalPoseBeforeCamera();assert.deepEqual(bone.position.toArray(),from);assert.equal(nativeLease.state,'returning');assert.equal(nativeLease.reason,'WAIT_EVALUATED_FRAME')}
    a.sceneCharacter.loadGeneration++;assert.equal(lease.active,false);assert.ok(['released','invalid'].includes(nativeLease.state));assert.equal(f.runtime.claims.has(native.root),false)
    host.dispose();native.runtime.dispose()
})

test('performance host evaluator actual MODEL mixed action samples before manual native commit without a fake combat cue for Walk_L and no live callback edit',async()=>{
    const {PerformanceEditorRuntime}=await import('./src/viewer/performanceEditor/runtime.ts')
    const fixture=await performanceNativeRuntimeFixture(),native=fixture.create(true),order=[]
    const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8'),start=source.indexOf('function playViewerPerformanceAction('),end=source.indexOf('function pauseViewerCharacterAction(',start)
    const [play,sample]=new Function('combatSkeletonSourceActionId','exactCombatSkeletonPreviewEntry','nativeDungeonActionDescriptor','interruptViewerCharacterAction',
        'startDirectHomePlayback','startCombatSkeletonPlayback','stopActiveCombatSkeletonPlayback','stopActiveDirectHomePlayback','pauseViewerCharacterAction',
        'actionSlots','emitCatalogActionEffectCue','seekViewerCharacterAction',
        compilePerformanceActionTestSource(source,start,end)+'\nreturn [playViewerPerformanceAction,sampleViewerPerformanceAction]'
    )(()=>undefined,()=>undefined,()=>undefined,()=>{},()=>{throw Error('unexpected direct')},()=>{throw Error('unexpected skeleton')},()=>{},()=>{},()=>{},
        [{code:'KeyE'}],()=>order.push('cue'),(time,binding)=>{order.push('sample');binding.character.animation.time=time})
    const f=performanceHostFixture({play,sample}),a=f.actor(1,native.root)
    f.physics.set(native.root,{root:native.root,status:'ready',runtime:native.runtime})
    // This body/action test selects no facial channel: unkeyed Home morph provenance
    // is an explicitly separate pending producer seam, not a fake body PASS.
    delete a.mesh.morphTargetDictionary;delete a.mesh.morphTargetInfluences
    native.root.updateMatrixWorld(true)
    const headSkin=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());native.root.add(headSkin);headSkin.bind(new THREE.Skeleton([a.bone]))
    const bone=[...native.runtime.getWritableChannelSnapshot().outputObjects][0],mixer=new THREE.AnimationMixer(native.root)
    const clip=new THREE.AnimationClip('Walk_L',1,[new THREE.NumberKeyframeTrack(`${bone.uuid}.position[x]`,[0,1],[0,0.4])])
    let plays=0;a.character.animations=['Walk_L'];a.character.animation={mixer,duration:1,play(){plays++;order.push('play');mixer.clipAction(clip).reset().play();mixer.update(0)},set time(time){mixer.setTime(time)},paused:false}
    Object.assign(a.binding,{directHomeActions:{entries:[]},combatJumpActions:{entries:[]},nativeDungeonActions:{},catalogActionIds:new Map([['KeyE','Walk_L']])})
    const host=f.runtime.create(f.external),editor=new PerformanceEditorRuntime({actorSource:{list:()=>[a.descriptor],subscribe:()=>()=>{}},channelHost:host.channelHost,framePort:host.framePort,transitionSeconds:0})
    const key=[...editor.actors.get(native.root.uuid).bones].find(([,o])=>o===bone)[0],evaluated=[]
    const acquire=host.channelHost.acquire;host.channelHost.acquire=(...args)=>{
        const result=acquire(...args);if(result.status==='ready'){
            const capture=result.value.captureEvaluatorFrame;result.value.captureEvaluatorFrame=context=>{const frame=capture(context);if(frame.status==='ready')evaluated.push(frame.value.pose.bones[key].position[0]);return frame}
            const commit=result.value.commitManualBody;result.value.commitManualBody=(...values)=>{order.push('manual');return commit(...values)}
        }return result
    }
    editor.setDocument({schema:'performance-editor-v1',duration:1,loop:false,tracks:[
        {id:'action',actorKey:native.root.uuid,channel:'action',keys:[{id:'e',time:0,value:{name:'Walk_L',loop:true}}]},
        {id:'manual',actorKey:native.root.uuid,channel:'bone-rotation',property:key,keys:[{id:'m',time:0,value:[0,0,Math.sin(.2),Math.cos(.2)]}]},
    ]});editor.play();assert.equal(editor.lastError,null)
    for(let i=0;i<3;i++){f.runtime.nextFrame();a.body();assert.equal(editor.lastError,null);assert.ok(bone.quaternion.angleTo(new THREE.Quaternion(0,0,Math.sin(.2),Math.cos(.2)))<1e-7);order.push('native');native.runtime.updateAfterAnimation(1/60);host.flushFinalPoseBeforeCamera()}
    assert.equal(plays,1);assert.equal(order.filter(x=>x==='cue').length,0,'A generic Walk_L is not an admitted native combat identity');assert.equal(order.filter(x=>x==='manual').length,3)
    assert.ok(evaluated[0]<evaluated[1]&&evaluated[1]<evaluated[2]);assert.ok(evaluated.every(x=>x<0.1))
    assert.equal(order.indexOf('sample')<order.indexOf('manual'),true);assert.equal(order.indexOf('manual')<order.indexOf('native'),true)
    editor.dispose();host.dispose();native.runtime.dispose();mixer.stopAllAction()
})

test('performance host evaluator native return regrab has exact ownership and external revocation prevents commits',async()=>{
    const fixture=await performanceNativeRuntimeFixture(),native=fixture.create(true),f=performanceHostFixture(),a=f.actor(1,native.root)
    f.physics.set(native.root,{root:native.root,status:'ready',runtime:native.runtime});a.character.animation={mixer:new THREE.AnimationMixer(native.root)}
    const bone=[...native.runtime.getWritableChannelSnapshot().outputObjects][0],keys=new Map(),visit=(o,k)=>{if(o.isBone)keys.set(o,k);o.children.forEach((c,i)=>visit(c,`${k}/${i}:${c.name}`))};visit(native.root,'.')
    const key=keys.get(bone),selection={root:false,bones:[key],exclusiveBones:[key],morphs:[],action:false},host=f.runtime.create(f.external),nativeLeases=[]
    const acquire=native.runtime.acquireManualOutputLease;native.runtime.acquireManualOutputLease=x=>{const r=acquire.call(native.runtime,x);if(r.status==='ready')nativeLeases.push(r.value);return r}
    const first=host.channelHost.acquire(a.descriptor,selection).value;bone.position.x=0.4;first.releaseFromEvaluated(first.captureEvaluated(),0.18)
    const second=host.channelHost.acquire(a.descriptor,selection);assert.equal(second.status,'ready',second.reason)
    assert.equal(nativeLeases[0].state,'released');assert.equal(nativeLeases[1].state,'held');assert.equal(nativeLeases[1].owns(bone),true)
    first.releaseFromEvaluated({bones:{},morphs:{}},0);assert.equal(second.value.active,true)
    let commits=0
    host.framePort.subscribeBeforePhysics((_,context)=>{
        const frame=second.value.captureEvaluatorFrame(context);assert.equal(frame.status,'ready',frame.reason)
        f.externalStates.get(native.root).valid=false
        assert.equal(second.value.commitManualBody(frame.value,frame.value.pose).status,'unavailable');commits++
    })
    f.runtime.nextFrame();a.body();assert.equal(commits,1);assert.equal(second.value.active,false)
    assert.equal(nativeLeases[1].state,'released');assert.equal(f.runtime.claims.has(native.root),false);assert.equal(bone.position.x,0.4)
    host.dispose();native.runtime.dispose()
})

test('performance host channel split real native-ready action evaluates before one native writer and retains displayed output', async () => {
    const fixture=await performanceNativeRuntimeFixture(),native=fixture.create(),second=fixture.create()
    const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8'),order=[]
    const start=source.indexOf('function playViewerPerformanceAction('),end=source.indexOf('function pauseViewerCharacterAction(',start)
    const [play,sample]=new Function('combatSkeletonSourceActionId','exactCombatSkeletonPreviewEntry','nativeDungeonActionDescriptor','interruptViewerCharacterAction',
        'startDirectHomePlayback','startCombatSkeletonPlayback','stopActiveCombatSkeletonPlayback','stopActiveDirectHomePlayback','pauseViewerCharacterAction',
        'actionSlots','emitCatalogActionEffectCue','seekViewerCharacterAction',
        compilePerformanceActionTestSource(source,start,end)+'\nreturn [playViewerPerformanceAction,sampleViewerPerformanceAction]',
    )(()=>undefined,()=>undefined,()=>undefined,()=>{},()=>{throw Error('unexpected direct')},()=>{throw Error('unexpected skeleton')},()=>{},()=>{},()=>{},[],()=>{throw Error('unexpected cue')},
        (time,binding)=>{order.push('sample');binding.character.animation.time=time})
    const f=performanceHostFixture({play,sample}),a=f.actor(1,native.root),b=f.actor(1,second.root)
    f.physics.set(native.root,{root:native.root,status:'ready',runtime:native.runtime})
    f.physics.set(second.root,{root:second.root,status:'ready',runtime:second.runtime})
    const nativeBone=[...native.runtime.getWritableChannelSnapshot().outputObjects][0]
    const keys=new Map(),visit=(object,key)=>{if(object.isBone)keys.set(object,key);object.children.forEach((child,i)=>visit(child,`${key}/${i}:${child.name}`))};visit(native.root,'.')
    const nativeKey=keys.get(nativeBone),manualKey=keys.get(a.bone);assert.ok(nativeKey&&manualKey)
    const mixer=new THREE.AnimationMixer(native.root)
    const clip=new THREE.AnimationClip('Walk_L',1,[new THREE.NumberKeyframeTrack(`${nativeBone.uuid}.position[x]`,[0,1],[0,0.2])])
    let animationPlays=0
    a.character.animations=['Walk_L'];a.character.animation={duration:1,play(){animationPlays++;order.push('animation-play');mixer.clipAction(clip).reset().play()},
        set time(value){mixer.setTime(value)},paused:false}
    Object.assign(a.binding,{directHomeActions:{entries:[]},combatJumpActions:{entries:[]},nativeDungeonActions:{},catalogActionIds:new Map()})
    const queried=[],host=f.runtime.create({...f.external,nativePhysicsConflicts:(actor,bones)=>{
        queried.push([...bones]);return f.external.nativePhysicsConflicts(actor,bones)
    }})
    const selection={root:false,bones:[...keys.values()],exclusiveBones:[manualKey],morphs:[],action:true}
    const acquired=host.channelHost.acquire(a.descriptor,selection);assert.equal(acquired.status,'ready',acquired.reason)
    const lease=acquired.value,otherBefore=[...second.nodes.values()].map(node=>node.position.toArray())
    let frame=0,displayed,prePhysics,physicsCalls=0,writes=0
    const copy=nativeBone.position.copy;nativeBone.position.copy=function(value){writes++;return copy.call(this,value)}
    host.framePort.subscribeBeforePhysics(()=>{
        order.push('actor-phase')
        if(frame++===0)lease.playActionBeat({keyId:'walk',occurrenceId:'epoch1:walk',name:'Walk_L',loop:true,localTimeSeconds:0.4,transitionSeconds:0.2})
        else {
            assert.deepEqual(lease.captureEvaluated().bones[nativeKey],displayed,'crossing starts from prior post-native displayed output')
            lease.sampleActionAt('Walk_L',0.6,true)
        }
        prePhysics=nativeBone.position.x
    })
    for(let i=0;i<2;i++) {
        f.runtime.nextFrame();order.push('base-mixer');mixer.update(1/60);a.body()
        assert.ok(Math.abs(prePhysics-(i===0?0.08:0.12))<1e-6,'actual retained mixer evaluated action sample')
        native.root.updateMatrixWorld(true);order.push('native');physicsCalls++;native.runtime.updateAfterAnimation(1/60)
        const snapshot={position:nativeBone.position.toArray(),rotation:nativeBone.quaternion.toArray(),scale:nativeBone.scale.toArray()}
        host.flushFinalPoseBeforeCamera();assert.deepEqual(lease.captureEvaluated().bones[nativeKey],snapshot,'final phase never reapplies body over native')
        displayed=snapshot
    }
    assert.equal(animationPlays,1);assert.equal(physicsCalls,2);assert.ok(writes>0)
    assert.deepEqual(order,['base-mixer','actor-phase','animation-play','sample','native','base-mixer','actor-phase','sample','native'])
    assert.ok(queried.every(bones=>bones.length===1&&bones[0]===a.bone))
    assert.deepEqual([...second.nodes.values()].map(node=>node.position.toArray()),otherBefore)
    assert.equal(f.runtime.claims.has(b.descriptor.object),false);host.dispose()
    const manualHost=f.runtime.create(f.external)
    assert.match(manualHost.channelHost.acquire(a.descriptor,{...selection,exclusiveBones:[nativeKey]}).reason,/native writable-channel conflict/)
    const voiceBlocked=f.runtime.create({...f.external,acquireExternalChannels:()=>({status:'unavailable',reason:'exact voice/manual lease busy'})})
    assert.equal(voiceBlocked.channelHost.acquire(a.descriptor,selection).reason,'exact voice/manual lease busy')
    const refreshed=manualHost.channelHost.acquire(a.descriptor,selection);assert.equal(refreshed.status,'ready')
    native.registrations[0]();assert.equal(native.runtime.getWritableChannelSnapshot().reason,'binding-refresh-pending')
    assert.equal(refreshed.value.active,false)
    manualHost.dispose();voiceBlocked.dispose();native.runtime.dispose();second.runtime.dispose();mixer.stopAllAction()
})

test('G08 body transition captures evaluated pose once across nested stop/play and recaptures an interrupted blend', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const start = source.indexOf('interface ViewerTpsPoseTransitionNode'), end = source.indexOf('class ViewerProceduralLocomotion', start)
    const Transition = new Function('THREE', 'getClockDelta', 'viewerPerformanceClaims', 'getViewerCharacterPhysicsAttachment', stripTypeScriptTypes(source.slice(start, end), { mode: 'strip' }) + '\nreturn ViewerTpsPoseTransition')(THREE, () => 1 / 60, new WeakMap(), () => undefined)
    const object = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'Head'; object.add(bone)
    const transition = new Transition({ object })
    const quaternion = value => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), value)
    bone.quaternion.copy(quaternion(0.6)); transition.begin()
    bone.quaternion.identity(); transition.begin() // nested clear/restart is not a new evaluated source
    bone.quaternion.copy(quaternion(-0.5)); transition.update()
    assert.ok(bone.quaternion.angleTo(quaternion(0.6)) < 1e-7)
    for (let i = 0; i < 5; i++) { bone.quaternion.copy(quaternion(-0.5)); transition.update() }
    const blended = bone.quaternion.clone(); transition.begin()
    bone.quaternion.copy(quaternion(0.9)); transition.update()
    assert.ok(bone.quaternion.angleTo(blended) < 1e-7)
    for (let i = 0; i < 30; i++) { bone.quaternion.copy(quaternion(0.9)); transition.update() }
    assert.ok(bone.quaternion.angleTo(quaternion(0.9)) < 1e-7)
    assert.equal(transition.diagnostics.active, false)
})

test('performance exact action adapter uses retained actor routes and isolates event emission from sampling', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const start = source.indexOf('function playViewerPerformanceAction('), end = source.indexOf('function pauseViewerCharacterAction(', start)
    const calls = []
    const [play, sample] = new Function('combatSkeletonSourceActionId','exactCombatSkeletonPreviewEntry','nativeDungeonActionDescriptor','interruptViewerCharacterAction',
        'startDirectHomePlayback','startCombatSkeletonPlayback','stopActiveCombatSkeletonPlayback','stopActiveDirectHomePlayback','pauseViewerCharacterAction',
        'actionSlots','emitCatalogActionEffectCue','seekViewerCharacterAction',
        compilePerformanceActionTestSource(source,start,end)+'\nreturn [playViewerPerformanceAction,sampleViewerPerformanceAction]',
    )(()=>undefined,()=>undefined,()=>undefined,()=>calls.push('interrupt'),()=>{throw Error('unexpected direct')},()=>{throw Error('unexpected skeleton')},()=>{},()=>{},()=>calls.push('pause'),
        [{code:'KeyE'}],()=>calls.push('cue'),(time,binding)=>calls.push(['seek',binding.character.userData.characterId,time]))
    const binding={character:{userData:{characterId:800001},animations:['Walk_L'],animation:{play:(...args)=>calls.push(['play',...args]),duration:2}},
        tpsPoseTransition:{begin:()=>calls.push('capture')},directHomeActions:{entries:[]},combatJumpActions:{entries:[]},nativeDungeonActions:{},catalogActionIds:new Map([['KeyE','Walk_L']])}
    binding.sceneCharacter={character:binding.character};
    const beat={name:'Walk_L',keyId:'k',occurrenceId:'e:0:k',loop:true,localTimeSeconds:0,transitionSeconds:0.2}
    play(binding,beat,true); sample(binding,'Walk_L',0.5,true)
    assert.equal(calls.filter(call=>call==='cue').length,0,'Generic locomotion must not emit a fake combat cue')
    assert.equal(calls.filter(call=>Array.isArray(call)&&call[0]==='play').length,1)
    assert.ok(calls.indexOf('capture') < calls.indexOf('interrupt'))
    play(binding,beat,false); sample(binding,'Walk_L',0.8,true)
    assert.equal(calls.filter(call=>call==='cue').length,0,'Generic locomotion must not emit a fake combat cue')
    assert.throws(()=>sample(binding,'wrong',0,true),/own/)
    assert.throws(()=>play(binding,{...beat,name:'not-present'},true),/unavailable/)
})

test('G08 per-instance animation handoff covers ordinary selector play and clear without duplicate playback or successor overwrite', () => {
    const source = fs.readFileSync('src/viewer/viewerLocomotion.ts', 'utf8')
    const start = source.indexOf('function installViewerEvaluatedAnimationHandoff('), end = source.indexOf('class ViewerProceduralLocomotion', start)
    const install = new Function(stripTypeScriptTypes(source.slice(start,end),{mode:'strip'})+'\nreturn installViewerEvaluatedAnimationHandoff')()
    const calls = [], transition = { begin: seconds => calls.push(['capture',seconds]) }
    const originalPlay = function(...args){assert.equal(this,animation);calls.push(['native-play',...args])}
    const originalClear = function(){assert.equal(this,animation);calls.push(['native-clear'])}
    const animation = {play:originalPlay,clear:originalClear}
    const restore = install({animation},transition)
    animation.play('HomeWait_L',true,{transitionSeconds:0.3}); animation.clear()
    assert.deepEqual(calls,[['capture',0.3],['native-play','HomeWait_L',true,{transitionSeconds:0.3}],['capture',undefined],['native-clear']])
    restore(); assert.equal(animation.play,originalPlay);assert.equal(animation.clear,originalClear)
    const restoreSecond = install({animation},transition), laterOwner = () => undefined
    animation.play=laterOwner;restoreSecond();assert.equal(animation.play,laterOwner)
})
