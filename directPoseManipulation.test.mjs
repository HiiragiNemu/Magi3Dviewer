import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = process.env.MAGIUS_TEST_SOURCE_ROOT ?? path.dirname(fileURLToPath(import.meta.url))
const runtime = process.env.MAGIUS_TEST_RUNTIME_ROOT ?? root
const require = createRequire(path.join(runtime, 'package.json'))
const ts = require('typescript')
const T = await import(pathToFileURL(path.join(runtime, 'node_modules/three/build/three.module.js')))
const { TransformControls } = await import(pathToFileURL(path.join(runtime, 'node_modules/three/examples/jsm/controls/TransformControls.js')))
const cache = fs.mkdtempSync(path.join(runtime, '.direct-pose-test-'))
after(() => fs.rmSync(cache, { recursive: true, force: true }))
const limitsModule = path.join(cache, 'poseJointLimits.mjs')
fs.writeFileSync(limitsModule, ts.transpileModule(fs.readFileSync(path.join(root, 'src/viewer/poseJointLimits.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
const { registerPoseJointLimits, clampPoseJoint } = await import(pathToFileURL(limitsModule))
const moduleFile = path.join(cache, 'directPoseTarget.mjs')
fs.writeFileSync(moduleFile, ts.transpileModule(fs.readFileSync(path.join(root, 'src/viewer/directPoseTarget.ts'), 'utf8').replace("'./poseJointLimits'", "'./poseJointLimits.mjs'"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText)
const { DirectPoseTarget, directPoseTranslationJoints } = await import(pathToFileURL(moduleFile))
const toolsModule = path.join(cache, 'directPoseTools.mjs')
fs.writeFileSync(toolsModule, ts.transpileModule(fs.readFileSync(path.join(root, 'src/viewer/directPoseTools.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText)
const { DirectPoseHistory, findDirectPoseParts } = await import(pathToFileURL(toolsModule))
const source = fs.readFileSync(path.join(root, 'src/viewer/index.ts'), 'utf8')
const ast = ts.createSourceFile('viewer.ts', source, ts.ScriptTarget.Latest, true)
assert.equal(ast.parseDiagnostics.length, 0, 'production viewer syntax')
const names = ['getPoseEntries', 'poseQuaternionMatches', 'applyPoseEntry', 'restoreManualPoseOverrides', 'applyManualPoseOverrides', 'resetActionParameters', 'getPoseEntryBase', 'getPoseEntryPositionBase', 'syncPoseEntryControls', 'setDirectPoseTransformMode', 'updateDirectPoseUi', 'updateDirectPoseTarget', 'requestDirectPoseFeedback', 'selectDirectPoseBone', 'clearDirectPoseSelection', 'setDirectPoseEditing', 'beginDirectPoseTransaction', 'syncDirectPoseOffsetsFromBone', 'directPoseScreenTranslationDelta', 'finishDirectPoseDrag', 'setupDirectPoseEditing', 'startDirectPosePointerDrag', 'updateDirectPosePointerDrag', 'pauseSelectedAnimation', 'captureDirectPose', 'getDirectPoseHistory', 'commitDirectPoseHistory', 'restoreDirectPose', 'undoDirectPose']
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
assert.equal(functions.length, names.length, 'exercise real production functions, not copies of the algorithms')
const js = ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function element() {
    const listeners = new Map(), attrs = new Map(), captures = new Set(), classes = new Set()
    return {
        listeners, attrs, style: {}, hidden: false, disabled: false, value: '', textContent: '', title: '', dataset: {},
        setAttribute: (key, value) => attrs.set(key, String(value)), getAttribute: key => attrs.get(key),
        addEventListener(name, fn, options) {
            if (!listeners.has(name)) listeners.set(name, [])
            listeners.get(name).push({ fn, capture: options === true || options?.capture === true })
        },
        removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(item => item.fn !== fn)) },
        setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
        querySelectorAll: () => [], querySelector: () => null, replaceChildren() {},
        classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key), toggle(key, value) { if (value) classes.add(key); else classes.delete(key) } },
    }
}

function fixture({ scaled = false, orthographic = false } = {}) {
    const actor = new T.Group(), anchor = new T.Bone(), upper = new T.Bone(), lower = new T.Bone(), hand = new T.Bone(), sibling = new T.Bone()
    anchor.name = 'Root'; upper.name = 'UpperArm_R'; lower.name = 'Forearm_R'; hand.name = 'Hand_R'; sibling.name = 'Other_L'
    actor.add(anchor); anchor.add(upper, sibling); upper.add(lower); lower.add(hand)
    upper.position.set(0, 1, 0); lower.position.set(.8, 0, 0); hand.position.set(.7, 0, 0); sibling.position.set(-1, 1, 0)
    if (scaled) { actor.scale.set(.7, 1.2, .9); actor.rotation.set(.12, .25, -.08) }
    const bones = [anchor, upper, lower, hand, sibling]
    const positions = bones.map(bone => bone.position.clone()), scales = bones.map(bone => bone.scale.clone())
    const geometry = new T.BufferGeometry()
    geometry.setAttribute('position', new T.Float32BufferAttribute([1.5, 1, 0, 1.6, 1, 0, 1.5, 1.1, 0], 3))
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute([3, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0], 4))
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
    const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial())
    actor.add(mesh); actor.updateMatrixWorld(true); mesh.bind(new T.Skeleton(bones))
    const otherActor = new T.Group(); otherActor.position.set(4, 0, 0)
    const window = element(), document = element(), canvas = element()
    document.body = element(); document.pointerLockElement = null; canvas.ownerDocument = document; canvas.getRootNode = () => document
    const camera = orthographic ? new T.OrthographicCamera(-2, 2, 1.5, -1.5, .01, 100) : new T.PerspectiveCamera(40, 1.5, .01, 100)
    camera.position.set(2, 2.5, 5); camera.lookAt(.5, 1, 0); camera.updateMatrixWorld(true); camera.updateProjectionMatrix()
    const scene = { camera, scene: new T.Scene(), controls: { enabled: true }, renderer: { domElement: canvas }, effects: { outlinePass: { selectedObjects: [actor] } }, characterSelected: { character: { object: actor, animation: { paused: false } } }, characters: [{ character: { object: actor } }, { character: { object: otherActor } }] }
    scene.scene.add(actor, otherActor)
    const leases = new Set(), translate = element(), rotate = element(), toggle = element(), output = element(), feedback = []
    const meshEntry = { object: mesh, defaultVisible: true, path: 'mesh', label: 'mesh' }
    let weighted, partUiCalls = 0, catalogState, pauses = 0, objectCloses = 0, selectedPart
    const deps = {
        THREE: T, TransformControls, DirectPoseTarget, DirectPoseHistory, scene, document, window, registerPoseJointLimits, clampPoseJoint,
        createPoseContactGuard: () => () => false, editorGround: {}, setViewerLocomotionEnabled() {},
        requestAnimationFrame: fn => feedback.push(fn),
        actionDirectEditToggle: toggle, actionDirectTranslate: translate, actionDirectRotate: rotate, actionDirectEditTarget: output, actionChannelList: element(),
        translateUiText: text => text, translateBoneChannelLabel: text => text, isPerformanceBoneLeased: bone => leases.has(bone),
        updateModelPartVisibilityUi() { ++partUiCalls }, closeObjectTransform() { ++objectCloses }, updateAnimationControls() {},
        currentCatalogPlayback: () => catalogState,
        characterActionsApi: () => ({ pause() { ++pauses; return { ...catalogState, status: 'paused' } } }),
        setCharacterActionPlaybackState: state => { catalogState = state },
        getWeightedBoneAtPointer: () => weighted,
        getModelPartEntries: () => new Map([[mesh.uuid, meshEntry]]),
        selectModelPart(entry) { selectedPart = entry },
        restoreModelPartVisibility() {}, setSelectedAnimationPlaybackRate() {}, rebuildActionParameterChannels() {}, rebuildModelPartVisibilityControls() {},
    }
    const api = Function(...Object.keys(deps), `
        const manualPoseByCharacter = new WeakMap();
        let directPoseControls, directPoseControlsHelper, directPoseSelection, selectedModelPart, directPosePointerDrag, directPoseGizmoPointerId;
        let directPoseFeedbackPending=false, directPoseEditingEnabled=false, directPoseTransformMode='rotate', directPoseGizmoDragging=false;
        let directPoseOrbitControlsWasEnabled=true, directPoseOutlineSelection=[], performanceGizmoActive=false, directPoseTarget, directPoseInputRoot, directPoseFinishing=false;
        const directPoseDragBases = new Map(), directPoseHistories = new WeakMap();
        let viewportEditor, directPoseToolsUi, directPoseKeepOrientation = false, directPoseBendEditing = false;
        ${js}
        setupDirectPoseEditing();
        return { entries:getPoseEntries, apply:applyPoseEntry, restore:restoreManualPoseOverrides, frame:applyManualPoseOverrides,
            reset:resetActionParameters, undo:undoDirectPose, mode:setDirectPoseTransformMode, edit:setDirectPoseEditing, select:selectDirectPoseBone, finish:finishDirectPoseDrag,
            get selection(){return directPoseSelection}, get drag(){return directPosePointerDrag}, get controls(){return directPoseControls}, get target(){return directPoseTarget} };
    `)(...Object.values(deps))
    const event = (x = 600, y = 400, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, shiftKey: false, altKey: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra })
    const direct = (name, value) => {
        const list = canvas.listeners.get(name) ?? []
        const handler = name === 'pointermove'
            ? list.find(item => item.fn.toString().includes('const drag = directPosePointerDrag'))?.fn
            : name === 'pointerdown' ? list.find(item => item.capture && item.fn.toString().includes('getWeightedBoneAtPointer'))?.fn : list.filter(item => !item.capture).at(-1)?.fn
        handler?.(value)
    }
    const render = (native = () => {}) => { api.restore(); native(); api.frame(); scene.scene.updateMatrixWorld(true) }
    const choose = (bone = hand) => { api.edit(true); api.select(actor, bone); scene.scene.updateMatrixWorld(true) }
    const startBody = (bone = hand) => { weighted = { object: actor, bone, part: mesh }; api.controls.axis = null; direct('pointerdown', event()) }
    const vertex = () => { actor.updateMatrixWorld(true); mesh.skeleton.update(); return mesh.getVertexPosition(0, new T.Vector3()).applyMatrix4(mesh.matrixWorld) }
    const noStretch = () => {
        bones.forEach((bone, index) => {
            assert.deepEqual(bone.position.toArray(), positions[index].toArray(), bone.name + ' joint position unchanged')
            assert.deepEqual(bone.scale.toArray(), scales[index].toArray(), bone.name + ' scale unchanged')
        })
        assert.deepEqual(otherActor.position.toArray(), [4, 0, 0], 'other actors untouched')
    }
    return { actor, anchor, upper, lower, hand, sibling, mesh, api, scene, leases, translate, rotate, output, feedback, canvas, window, choose, startBody, direct, event, render, noStretch, vertex,
        partUiCalls: () => partUiCalls, setCatalog: state => { catalogState = state }, pauses: () => pauses, objectCloses: () => objectCloses, selectedPart: () => selectedPart,
        flushFeedback() { for (const fn of feedback.splice(0)) fn() },
        cleanup() { geometry.dispose(); mesh.material.dispose(); api.controls.dispose() },
    }
}
const sameRotation = (a, b) => 1 - Math.abs(a.clone().normalize().dot(b.clone().normalize())) < 1e-11

test('TransformControls owns an isolated input handle, not a bone or the whole scene', () => {
    const f = fixture(); f.choose()
    assert.equal(f.api.controls.object, f.api.target.handle); assert.notEqual(f.api.controls.object, f.hand)
    assert.equal(f.api.target.handle.parent.children.length, 1); assert.notEqual(f.api.target.handle.parent, f.scene.scene)
    let traversals = 0; const original = f.actor.updateMatrixWorld
    f.actor.updateMatrixWorld = () => { ++traversals }
    f.api.controls.getHelper().updateMatrixWorld(true)
    f.actor.updateMatrixWorld = original
    assert.equal(traversals, 0, 'drawing the gizmo does not traverse the rig')
    f.cleanup()
})
test('root movement does not stretch the skeleton or silently switch a drag to rotation', () => {
    const f = fixture(); assert.equal(directPoseTranslationJoints(f.actor, f.anchor).length, 0)
    f.choose(f.anchor); f.api.mode('translate')
    assert.equal(f.api.controls.mode, 'translate'); assert.equal(f.api.controls.enabled, false); assert.equal(f.translate.disabled, true)
    f.startBody(f.anchor); assert.equal(f.api.drag, undefined); f.noStretch(); f.cleanup()
})
test('Move XYZ remains a three-axis IK operation for a valid limb', () => {
    const f = fixture(); f.choose(); f.api.mode('translate')
    assert.equal(f.translate.disabled, false); assert.equal(f.api.controls.mode, 'translate'); assert.equal(f.api.controls.space, 'world')
    assert.deepEqual([f.api.controls.showX, f.api.controls.showY, f.api.controls.showZ], [true, true, true]); assert.match(f.translate.textContent, /IK/)
    f.api.mode('rotate'); assert.equal(f.api.controls.space, 'local'); f.cleanup()
})
for (const axis of ['X', 'Y', 'Z']) test('real TransformControls ' + axis + ' translation moves the skinned limb through IK, never through bone stretching', () => {
    const f = fixture(); f.choose(); f.api.mode('translate'); const control = f.api.controls
    control.axis = axis; f.scene.scene.updateMatrixWorld(true)
    const origin = f.api.target.handle.position.clone(), direction = new T.Vector3(axis === 'X' ? -.15 : 0, axis === 'Y' ? .15 : 0, axis === 'Z' ? .15 : 0)
    const from = origin.clone().project(f.scene.camera), to = origin.clone().add(direction).project(f.scene.camera)
    const before = f.hand.getWorldPosition(new T.Vector3()), vertex = f.vertex()
    control.pointerDown({ x: from.x, y: from.y, button: 0 }); assert.equal(control.dragging, true)
    control.pointerMove({ x: to.x, y: to.y, button: -1 }); assert.equal(f.api.target.solves, 0)
    f.noStretch(); f.render(); control.pointerUp({ button: 0 })
    assert.ok(f.hand.getWorldPosition(new T.Vector3()).distanceTo(before) > .05)
    assert.ok(f.vertex().distanceTo(vertex) > .05, 'real weighted vertices follow the chain')
    const pose = [f.upper, f.lower, f.hand].map(bone => bone.quaternion.clone())
    for (let i = 0; i < 360; ++i) f.render()
    pose.forEach((q, i) => assert.ok(sameRotation(q, [f.upper, f.lower, f.hand][i].quaternion)))
    f.noStretch(); f.cleanup()
})
for (const axis of ['X', 'Y', 'Z']) test('real ' + axis + ' rotation stops on release and stays still for 360 frames', () => {
    const f = fixture(); f.choose(); const control = f.api.controls; control.axis = axis; f.scene.scene.updateMatrixWorld(true)
    const origin = f.api.target.handle.position.clone()
    const u = axis === 'X' ? new T.Vector3(0, .4, 0) : new T.Vector3(.4, 0, 0)
    const v = axis === 'Z' ? new T.Vector3(0, .4, 0) : new T.Vector3(0, 0, .4)
    const from = origin.clone().add(u).project(f.scene.camera), to = origin.clone().add(v).project(f.scene.camera), before = f.hand.quaternion.clone()
    control.pointerDown({ x: from.x, y: from.y, button: 0 }); assert.equal(control.dragging, true)
    control.pointerMove({ x: to.x, y: to.y, button: -1 }); assert.deepEqual(f.hand.quaternion.toArray(), before.toArray(), 'input event did not write a bone')
    f.render(); control.pointerUp({ button: 0 }); const final = f.hand.quaternion.clone()
    assert.ok(!sameRotation(before, final), 'nonzero rotation')
    for (let i = 0; i < 360; ++i) f.render()
    assert.ok(sameRotation(final, f.hand.quaternion)); f.noStretch(); f.cleanup()
})
for (const scaled of [false, true]) for (const orthographic of [false, true]) test('body-plane and depth dragging preserve lengths ' + JSON.stringify({ scaled, orthographic }), () => {
    const f = fixture({ scaled, orthographic }); f.choose(); f.api.mode('translate'); const before = f.hand.getWorldPosition(new T.Vector3())
    f.startBody(); f.direct('pointermove', f.event(565, 360)); f.render(); f.direct('pointerup', f.event(565, 360))
    assert.ok(f.hand.getWorldPosition(new T.Vector3()).distanceTo(before) > .02); f.noStretch()
    f.startBody(); f.direct('pointermove', f.event(600, 360, { altKey: true, shiftKey: true })); f.render(); f.direct('pointerup', f.event()); f.noStretch(); f.cleanup()
})
test('10,000 body pointer events coalesce to one solve without rebuilding the model-part panel', () => {
    const f = fixture(); f.choose(); f.api.mode('translate'); f.startBody(); const calls = f.partUiCalls(), start = performance.now()
    for (let i = 0; i < 10000; ++i) f.direct('pointermove', f.event(550 + i % 30, 360))
    assert.equal(f.api.target.solves, 0); assert.equal(f.partUiCalls(), calls)
    f.render(); assert.equal(f.api.target.solves, 1); f.flushFeedback(); assert.equal(f.partUiCalls(), calls)
    console.log('10k pointer-event/coalesced-solve elapsed milliseconds:', (performance.now() - start).toFixed(3))
    f.noStretch(); f.cleanup()
})
for (const stop of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'mode', 'exit']) test('release before RAF flushes the last input exactly once on ' + stop, () => {
    const f = fixture(); f.choose(); f.api.mode('translate'); f.startBody(); f.direct('pointermove', f.event(560, 355))
    const transaction = f.api.target; assert.equal(transaction.solves, 0)
    if (stop === 'blur') f.window.listeners.get('blur').at(-1).fn()
    else if (stop === 'mode') f.api.mode('rotate')
    else if (stop === 'exit') f.api.edit(false)
    else f.direct(stop, f.event())
    assert.equal(transaction.solves, 1); assert.equal(f.api.drag, undefined); assert.equal(transaction.dragging, false)
    const final = f.upper.quaternion.clone(); f.direct('pointermove', f.event(900, 100))
    for (let i = 0; i < 120; ++i) f.render()
    assert.ok(sameRotation(final, f.upper.quaternion)); f.noStretch(); f.cleanup()
})
test('another pointer cannot move or release the current drag', () => {
    const f = fixture(); f.choose(); f.startBody()
    f.direct('pointermove', f.event(900, 100, { pointerId: 9 })); f.direct('pointerup', f.event(900, 100, { pointerId: 9 }))
    assert.ok(f.api.drag); assert.equal(f.api.target.solves, 0); f.direct('pointerup', f.event()); f.cleanup()
})
test('leased IK parents do not cause a root/rotation fallback or steal another editor channel', () => {
    const f = fixture(); f.choose(); f.api.mode('translate'); f.leases.add(f.upper); f.startBody()
    assert.equal(f.api.drag, undefined); assert.equal(f.api.controls.mode, 'translate'); f.noStretch(); f.cleanup()
})
test('reset during an active drag flushes and then restores the pre-edit pose', () => {
    const f = fixture(); f.choose(); const sibling = f.sibling.quaternion.clone()
    f.startBody(); f.direct('pointermove', f.event(670, 440)); f.render(); f.direct('pointerup', f.event())
    f.api.mode('translate'); f.startBody(); f.direct('pointermove', f.event(530, 360)); f.api.reset()
    assert.equal(f.api.drag, undefined)
    for (const bone of [f.upper, f.lower, f.hand]) assert.ok(sameRotation(new T.Quaternion(), bone.quaternion))
    assert.ok(sameRotation(sibling, f.sibling.quaternion)); f.noStretch(); f.cleanup()
})
test('native additive animation sees the unmodified baseline, not last frame manual output', () => {
    const f = fixture(); f.choose(); f.api.selection.entry.offsets.set(20, 35, 10)
    const nativeDelta = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), .001), expected = new T.Quaternion()
    const overlay = new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.degToRad(20), T.MathUtils.degToRad(35), T.MathUtils.degToRad(10), 'XYZ'))
    for (let i = 0; i < 600; ++i) {
        expected.multiply(nativeDelta).normalize(); f.render(() => f.hand.quaternion.multiply(nativeDelta).normalize())
        assert.ok(sameRotation(expected, f.api.selection.entry.lastBase), 'native baseline at frame ' + i)
        const expectedLimited = expected.clone().multiply(overlay)
        assert.ok(f.hand.quaternion.toArray().every(Number.isFinite) && expectedLimited.toArray().every(Number.isFinite))
    }
    f.noStretch(); f.cleanup()
})
test('non-unit Float32 imported quaternions remain stable through 1,200 idle frames', () => {
    const f = fixture(); f.hand.quaternion.fromArray(new Float32Array(new T.Quaternion().setFromEuler(new T.Euler(.7, 1.2, -.35)).toArray()))
    const original = f.hand.quaternion.clone(); f.choose(); f.startBody(); f.direct('pointermove', f.event(680, 420)); f.render(); f.direct('pointerup', f.event())
    const final = f.hand.quaternion.clone(); for (let i = 0; i < 1200; ++i) f.render()
    assert.ok(sameRotation(final, f.hand.quaternion)); f.api.reset(); assert.ok(sameRotation(original, f.hand.quaternion)); f.cleanup()
})
test('far, coincident, straight and antiparallel targets are finite, deterministic and never stretch', () => {
    const f = fixture(); f.choose(); const target = f.api.target; assert.ok(target.begin('translate'))
    for (const point of [new T.Vector3(100, 100, 100), new T.Vector3(0, 1, 0), new T.Vector3(-1, 1, 0), new T.Vector3(.5, 1, 0)]) {
        target.handle.position.copy(point); target.queue(); target.flush(); const q = [f.upper, f.lower].map(bone => bone.quaternion.clone())
        for (let i = 0; i < 8; ++i) {
            target.handle.position.copy(point); target.queue(); target.flush()
            q.forEach((value, index) => assert.ok(sameRotation(value, [f.upper, f.lower][index].quaternion)))
            assert.ok(f.hand.getWorldPosition(new T.Vector3()).toArray().every(Number.isFinite)); f.noStretch()
        }
    }
    f.cleanup()
})
test('invalid input and detached bones are rejected without a solve', () => {
    const f = fixture(); f.choose(); const target = f.api.target; target.begin('rotate')
    target.handle.quaternion.set(NaN, 0, 0, 1); target.queue(); assert.equal(target.pending, false)
    target.handle.quaternion.identity(); target.queue(); f.hand.removeFromParent(); assert.equal(target.flush().length, 0); assert.equal(target.solves, 0); f.cleanup()
})
test('editing pauses the active official transport and dismisses competing root handles', () => {
    const f = fixture(); f.setCatalog({ actionId: 'official', status: 'playing' }); f.api.edit(true)
    assert.equal(f.pauses(), 1); assert.equal(f.objectCloses(), 1); assert.equal(f.scene.controls.enabled, true)
    f.api.edit(false); assert.equal(f.scene.controls.enabled, true); f.cleanup()
})
test('joint picking clears whole-mesh selection and cannot hide the whole body', () => {
    const f = fixture(); f.choose(); f.startBody(); assert.equal(f.selectedPart(), undefined); f.api.finish(); f.cleanup()
})
test('pointer hot path performs no solve, full skeleton traversal, layout read or panel rebuild', () => {
    const setup = functions.find(node => node.name?.text === 'setupDirectPoseEditing').getText(ast)
    const move = functions.find(node => node.name?.text === 'updateDirectPosePointerDrag').getText(ast)
    assert.doesNotMatch(move, /applyPoseEntry|applyManualPoseOverrides|getBoundingClientRect|\.flush\(|getPoseEntries|updateModelPartVisibilityUi/)
    assert.match(source, /directPoseControls\.attach\(directPoseTarget\.handle\)/)
    assert.doesNotMatch(functions.find(node => node.name?.text === 'applyPoseEntry').getText(ast), /bone\.position\.add/)
    assert.match(source, /addBeforeAnimationLoop\(restoreManualPoseOverrides\)/)
    assert.match(source, /request\.mode === 'joint' \? 'rotate' : 'translate'/)
})
test('the real renderer invokes restoration before native animation and honors pause and removal', () => {
    const text = fs.readFileSync(path.join(root, 'magia-exedra-character-three/renderer.ts'), 'utf8')
    const tree = ts.createSourceFile('renderer.ts', text, ts.ScriptTarget.Latest, true)
    const wanted = ['createRenderer', 'addBeforeAnimationLoop', 'removeBeforeAnimationLoop', 'addAnimationLoop', 'setRenderPaused']
    const methods = tree.statements.filter(node => ts.isFunctionDeclaration(node) && wanted.includes(node.name?.text)).map(node => node.getText(tree).replace(/^export /, ''))
    assert.equal(methods.length, wanted.length)
    const code = ts.transpileModule(methods.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    let tick
    const fake = { WebGLRenderer: class { capabilities = { getMaxAnisotropy: () => 1 }; shadowMap = {}; setAnimationLoop(callback) { tick = callback } }, PCFShadowMap: 1, ACESFilmicToneMapping: 1 }
    const api = Function('THREE', `let renderer, animationLoop=()=>{}, animationLoops=[], beforeAnimationLoops=[], renderPaused=false, pageVisibilityPaused=false, pageFocusPaused=false, clockDelta=0; const clock={getDelta:()=>1/60}; ${code}; return {createRenderer,addBeforeAnimationLoop,removeBeforeAnimationLoop,addAnimationLoop,setRenderPaused};`)(fake)
    const order = [], before = () => order.push('restore'), renderer = api.createRenderer()
    api.addBeforeAnimationLoop(before); api.addBeforeAnimationLoop(before); api.addAnimationLoop(() => order.push('native'))
    renderer.setAnimationLoop(() => order.push('manual-and-render')); tick(0); assert.deepEqual(order, ['restore', 'native', 'manual-and-render'])
    api.setRenderPaused(true); tick(1); assert.equal(order.length, 3)
    api.setRenderPaused(false); api.removeBeforeAnimationLoop(before); order.length = 0; tick(2); assert.deepEqual(order, ['native', 'manual-and-render'])
})


test('undo/redo restore a completed gesture without resizing joints', () => {
    const f=fixture();f.choose();const before=f.hand.quaternion.clone()
    f.startBody();f.direct('pointermove',f.event(655,425));f.render();f.direct('pointerup',f.event())
    const after=f.hand.quaternion.clone();assert.ok(!sameRotation(before,after))
    f.api.undo();assert.ok(sameRotation(f.hand.quaternion,before))
    f.api.undo(true);assert.ok(sameRotation(f.hand.quaternion,after));f.noStretch();f.cleanup()
})
test('history is bounded and identical clicks do not consume an undo slot',()=>{
    const h=new DirectPoseHistory(),p=new Map([['a',[0,0,0]]]);h.begin(p);h.finish(p);assert.equal(h.canUndo,false)
    for(let i=0;i<55;i++){h.begin(p);p.set('a',[i+1,0,0]);h.finish(p)}
    let count=0,current=p;while(h.canUndo){current=h.undo(current);count++}assert.equal(count,40);assert.equal(current.get('a')[0],15)
    assert.equal(h.redo(current).get('a')[0],16)
})
test('hand orientation lock preserves wrist world rotation and all bone lengths',()=>{
    const f=fixture();f.choose();const t=f.api.target;t.preserveEndOrientation=true
    const q=f.hand.getWorldQuaternion(new T.Quaternion());assert.ok(t.begin('translate'))
    t.handle.position.add(new T.Vector3(-.25,.2,.2));t.queue();t.flush()
    assert.ok(sameRotation(q,f.hand.getWorldQuaternion(new T.Quaternion())));f.noStretch();f.cleanup()
})
test('bend adjustment rotates the elbow around a fixed reachable hand target',()=>{
    const f=fixture();f.lower.rotation.z=.55;f.choose();const t=f.api.target;t.begin('translate')
    const target=t.handle.position.clone();t.queue();t.flush();const first=f.lower.getWorldPosition(new T.Vector3())
    t.bendAngle=Math.PI/2;t.queue();t.flush();const second=f.lower.getWorldPosition(new T.Vector3())
    assert.ok(first.distanceTo(second)>.1);assert.ok(f.hand.getWorldPosition(new T.Vector3()).distanceTo(target)<1e-6)
    f.noStretch();f.cleanup()
})
test('body part picker uses actual left/right identities, not helper bones',()=>{
    const a=new T.Group(),decoy=new T.Bone(),hand=new T.Bone(),foot=new T.Bone();decoy.name='Hand_R_Twist';hand.name='Hand_R';foot.name='Foot_L';a.add(decoy,hand,foot)
    const parts=findDirectPoseParts(a);assert.equal(parts.find(p=>p.id==='right-hand').bone,hand);assert.equal(parts.find(p=>p.id==='left-foot').bone,foot);assert.ok(!parts.some(p=>p.bone===decoy))
})
test('anatomical IK stops before reverse folding and does not move the root',()=>{
    const f=fixture();f.choose();const t=f.api.target;t.begin('translate');t.handle.position.copy(f.upper.getWorldPosition(new T.Vector3()));t.queue();t.flush()
    const a=f.upper.getWorldPosition(new T.Vector3()),b=f.lower.getWorldPosition(new T.Vector3()),c=f.hand.getWorldPosition(new T.Vector3())
    const angle=b.clone().sub(a).angleTo(c.clone().sub(b))*180/Math.PI;assert.ok(angle<=160.001);f.noStretch();f.cleanup()
})
