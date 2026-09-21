import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const root = new URL('.', import.meta.url)
const source = fs.readFileSync(new URL('./src/viewer/viewerLocomotion.ts', root), 'utf8')
const nativeManifest = JSON.parse(fs.readFileSync(new URL('./public/character-actions/manifest.v1.json', root), 'utf8'))

function actualFixedTransitionRuntime() {
  const filename = './src/viewer/characterActions/nativeDungeonFixedTransitions.ts'
  const compiled = ts.transpileModule(fs.readFileSync(new URL(filename, root), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename, reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics ?? [], [])
  const module = { exports: {} }
  const localRequire = name => {
    assert.equal(name, './data/native-dungeon-fixed-transitions.json?raw')
    return fs.readFileSync(new URL('./src/viewer/characterActions/data/native-dungeon-fixed-transitions.json', root), 'utf8')
  }
  Function('exports', 'require', 'module', compiled.outputText)(module.exports, localRequire, module)
  const locomotion = fs.readFileSync(new URL('./src/viewer/characterLocomotion.ts', root), 'utf8')
  const start = locomotion.indexOf('export function normalizeAnimationFamilyName(')
  const end = locomotion.indexOf('\nfunction toClipDescriptors(', start)
  assert.ok(start >= 0 && end > start)
  const normalize = ts.transpileModule(locomotion.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText
  Function('exports', normalize)(module.exports)
  return module.exports
}
const fixedTransitions = actualFixedTransitionRuntime()

function transpileFunctions(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start)
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const context = {}
  vm.runInNewContext(code, context)
  return context
}

function nativeAttachBlock() {
  const start = source.indexOf('} else if (hasEmbeddedNativeDungeonLocomotion) {')
  const end = source.indexOf('    } else if (Number(character.userData.characterId) === 101901) {', start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}

test('baseline native route had no jump channels; modified route overlays parameterized jump', () => {
  const block = nativeAttachBlock()
  // Baseline branch was an inferred native idle/walk/run map with no profile;
  // this fixture makes that missing jump channel explicit.
  const baselineNativeAnimations = { idle: 'DungeonWait_L', walk: 'DungeonWalk_L', run: 'DungeonRun_L' }
  assert.equal(baselineNativeAnimations.jump, undefined)
  assert.equal(baselineNativeAnimations.fall, undefined)
  assert.equal(baselineNativeAnimations.land, undefined)
  // Modified path must provide all three generated jump phases.
  assert.match(block, /attachParameterizedHumanoidMotionProfile\(/)
  assert.match(block, /jumpProfile\.jumpAnimations/)
  assert.match(block, /character\.object\.animations = \[\.\.\.nativeAnimations, \.\.\.generatedJumpClips\]/)
  assert.match(block, /jump: jumpProfile\.animations\.jump/)
  assert.match(block, /fall: jumpProfile\.animations\.fall/)
  assert.match(block, /land: jumpProfile\.animations\.land/)
})

test('native idle/walk/run clip choices remain model-owned', () => {
  const block = nativeAttachBlock()
  assert.match(block, /const nativeAnimations = \[\.\.\.character\.object\.animations\]/)
  assert.match(block, /generatedJumpClips = character\.object\.animations\.filter\(clip => jumpNames\.has\(clip\.name\)\)/)
  assert.match(block, /character\.object\.animations = \[\.\.\.nativeAnimations, \.\.\.generatedJumpClips\]/)
  assert.deepEqual(nativeManifest.entries.filter(e => e.characterIdentity.dungeonCharacterId === 100201).map(e => e.clip.semantic).sort(), ['idle', 'run', 'walk'])
})

test('native jump availability does not depend on combat download', () => {
  const attachTail = source.slice(source.indexOf('if (controlAuthority.tps) {', source.indexOf('export function attachViewerLocomotion')),
    source.indexOf('    return binding', source.indexOf('export function attachViewerLocomotion')))
  assert.match(attachTail, /void ensureNativeDungeonActions\(binding\)/)
  assert.match(attachTail, /if \(!hasEmbeddedNativeDungeonLocomotion\) void ensureCombatJumpActions\(binding\)/)
  assert.match(source, /function nativeDungeonJumpSafety\(characterId: number\)/)
  assert.match(source, /allowJumpSequence: true,\n        reason: 'exact native Dungeon idle\/walk\/run retained;/)
})

test('native manifest denominator remains 8 distinct characters and 9 resources', () => {
  assert.equal(nativeManifest.counts.distinctCharacters, 8)
  assert.equal(nativeManifest.counts.dungeonCharacterResources, 9)
  assert.equal(nativeManifest.counts.actions, 27)
})

test('extracted native runtime helper preserves gait identities and enables jump policy', () => {
  const context = transpileFunctions(
    'function nativeDungeonActionForSemantic(',
    'function isNativeDungeonAnimation(',
  )
  const entries = [
    { clip: { semantic: 'idle', sourceName: 'DungeonWait_L', runtimeName: 'NativeIdle' } },
    { clip: { semantic: 'walk', sourceName: 'DungeonWalk_L', runtimeName: 'NativeWalk' } },
    { clip: { semantic: 'run', sourceName: 'DungeonRun_L', runtimeName: 'NativeRun' } },
  ]
  const result = context.nativeDungeonLocomotionAnimations({ nativeDungeonActions: { dungeonCharacterId: 100201, entries }, character: { animations: [] } })
  assert.equal(JSON.stringify(result), JSON.stringify({ idle: 'NativeIdle', walk: 'NativeWalk', run: 'NativeRun', jump: 'NativeIdle', fall: 'NativeIdle', land: 'NativeIdle' }))

  const jumpContext = transpileFunctions(
    'function embeddedDungeonSafety(',
    'function parameterizedTargetRigSafety(',
  )
  // The extracted helper is executable source, not a copied policy assertion.
  const embedded = jumpContext.embeddedDungeonSafety(100201)
  assert.equal(embedded.allowJumpSequence, false)
  const nativeJump = jumpContext.nativeDungeonJumpSafety(100201)
  assert.equal(nativeJump.allowMovement, true)
  assert.equal(nativeJump.allowJumpSequence, true)
  assert.equal(nativeJump.allowCombatActions, false)
})

test('real native activation keeps generated jump map after async attach', () => {
  const start = source.indexOf('function nativeDungeonActionForSemantic(')
  const end = source.indexOf('function deactivateNativeDungeonPresentation(', start)
  assert.ok(start >= 0 && end > start)
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const calls = []
  const context = {
    ...fixedTransitions,
    calls,
    THREE: { MathUtils: { degToRad: value => value * Math.PI / 180 } },
    emitViewerEvent: () => {},
    emitViewerCombatEffectCue: () => {},
    CharacterLocomotionController: class {
      constructor(...args) { calls.push(args) }
      snapshot() { return { state: 'idle' } }
    },
    familyEquals: (a, b) => a === b,
    findFamily: () => undefined,
    createAnimationPort: (...args) => ({ nativeFixedTransitionPolicy: args[3] }),
    setNativeDungeonExternalAttachmentsHidden: () => {},
  }
  vm.runInNewContext(code, context)
  const jumpMap = {
    standing: { jump: 'GeneratedStandingJump', fall: 'GeneratedStandingFall', land: 'GeneratedStandingLand' },
    walking: { jump: 'GeneratedWalkingJump', fall: 'GeneratedWalkingFall', land: 'GeneratedWalkingLand' },
    running: { jump: 'GeneratedRunningJump', fall: 'GeneratedRunningFall', land: 'GeneratedRunningLand' },
  }
  // Execute the actual attach helper's return tail so the profile passed to
  // native activation is produced by source, rather than stubbing a profile
  // that already carries jumpAnimations.  Before the profile-map fix this
  // assertion fails because the returned profile drops the generated map.
  const attachStart = source.indexOf('function attachParameterizedHumanoidMotionProfile(')
  const returnStart = source.indexOf('    return {\n        profile,', attachStart)
  assert.ok(attachStart >= 0 && returnStart > attachStart)
  const assignmentStart = source.lastIndexOf('    profile.jumpAnimations = jumpNames', returnStart)
  const returnEnd = source.indexOf('\n    }\n}', returnStart)
  assert.ok(returnEnd > returnStart)
  const tail = assignmentStart >= 0
    ? source.slice(assignmentStart, returnStart)
    : ''
  const returnCode = source.slice(returnStart, returnEnd + '\n    }'.length)
  const tailContext = {}
  const tailProgram = ts.transpileModule(
    `function executeAttachTail(profile, jumpNames, baselineClip, names, postAnimationWalkClearance) {\n${tail}${returnCode}\n}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
  ).outputText
  vm.runInNewContext(tailProgram, tailContext)
  const generatedProfile = {
    status: 'attached',
    characterId: 100201,
    provenance: 'custom-character-profile',
    generatedClips: [],
  }
  const generated = tailContext.executeAttachTail(
    generatedProfile,
    jumpMap,
    'NativeIdle',
    { walk: 'NativeWalk', run: 'NativeRun' },
    undefined,
  )
  assert.deepEqual(generated.profile.jumpAnimations, jumpMap)
  const binding = {
    nativeDungeonActions: {
      status: 'attached',
      dungeonCharacterId: 100201,
      entries: nativeManifest.entries.filter(entry => entry.characterIdentity.dungeonCharacterId === 100201)
        .map(entry => ({ ...entry, clip: { ...entry.clip, runtimeName: { idle: 'NativeIdle', walk: 'NativeWalk', run: 'NativeRun' }[entry.clip.semantic] } })),
      active: false,
      controllerReady: false,
    },
    character: { userData: { characterId: 100201 }, animations: [], animation: { current: 'NativeIdle', default: 'NativeIdle' }, object: {} },
    characterSpecificMotion: generated.profile,
    combatJumpActions: { exactLocomotion: undefined },
    collision: {},
  }
  context.activateNativeDungeonController(binding)
  assert.equal(binding.nativeDungeonActions.active, true)
  assert.equal(binding.nativeDungeonActions.controllerReady, true)
  assert.equal(binding.locomotionAnimations.idle, 'NativeIdle')
  assert.equal(binding.locomotionAnimations.walk, 'NativeWalk')
  assert.equal(binding.locomotionAnimations.run, 'NativeRun')
  assert.equal(binding.locomotionAnimations.jump, 'GeneratedStandingJump')
  assert.equal(binding.locomotionAnimations.fall, 'GeneratedStandingFall')
  assert.equal(binding.locomotionAnimations.land, 'GeneratedStandingLand')
  const policy = binding.animationPort.nativeFixedTransitionPolicy
  assert.equal(policy.controllerPathId, '6411218269470645876')
  assert.deepEqual([...policy.secondsByFamilyPair.entries()], [
    ['NativeIdle\0NativeWalk', 0.25], ['NativeWalk\0NativeIdle', 0.25],
    ['NativeWalk\0NativeRun', 0.25], ['NativeRun\0NativeWalk', 0.25],
  ])
  assert.equal(fixedTransitions.nativeDungeonFixedTransitionSeconds(policy, 'NativeIdle', 'NativeWalk', 9), 0.25)
  assert.equal(fixedTransitions.nativeDungeonFixedTransitionSeconds(policy, 'GeneratedStandingJump', 'NativeWalk', 9), 9)
  assert.equal(fixedTransitions.createNativeDungeonFixedTransitionPolicy(110702, binding.nativeDungeonActions.entries, fixedTransitions.normalizeAnimationFamilyName), undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0].jumpLocomotionAnimations, jumpMap)
})
