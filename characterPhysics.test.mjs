import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import ts from 'typescript'

const repoRoot = resolve('.')
const publicRoot = join(repoRoot, 'public', 'character-physics')
const characterRoot = join(publicRoot, 'characters')
const verificationRoot = process.env.MAGIUS_CHARACTER_PHYSICS_VERIFICATION_ROOT
    ? resolve(process.env.MAGIUS_CHARACTER_PHYSICS_VERIFICATION_ROOT)
    : join(
            repoRoot,
            'artifacts',
            'verification',
            '20260829-character-physics-native-runtime',
        )
const compiledRoot = join(verificationRoot, 'test-compiled')

globalThis.document = {
    createElementNS() {
        const listeners = new Map()
        return {
            addEventListener(type, callback) { listeners.set(type, callback) },
            removeEventListener(type) { listeners.delete(type) },
            set src(value) {
                this._src = value
                queueMicrotask(() => listeners.get('load')?.({ target: this }))
            },
            get src() { return this._src },
        }
    },
}

function json(path) {
    return JSON.parse(readFileSync(path, 'utf8'))
}

function profile(characterId) {
    return json(join(characterRoot, String(characterId), 'profile.v1.json'))
}

function compileRuntimeModules() {
    mkdirSync(compiledRoot, { recursive: true })
    for (const name of [
        'math',
        'binding',
        'catalog',
        'actionOptions',
        'magicaWind',
        'nativeColliders',
        'runtime',
    ]) {
        const source = readFileSync(
            join(repoRoot, 'src', 'viewer', 'characterPhysics', `${name}.ts`),
            'utf8',
        )
        let output = ts.transpileModule(source, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ES2022,
                verbatimModuleSyntax: true,
            },
            fileName: `${name}.ts`,
        }).outputText
        output = output
            .replaceAll("from 'three'", `from '${pathToFileURL(join(repoRoot, 'node_modules', 'three', 'build', 'three.module.js')).href}'`)
            .replaceAll("from './math'", "from './math.mjs'")
            .replaceAll("from './binding'", "from './binding.mjs'")
            .replaceAll("from './magicaWind'", "from './magicaWind.mjs'")
            .replaceAll("from './nativeColliders'", "from './nativeColliders.mjs'")
        writeFileSync(join(compiledRoot, `${name}.mjs`), output, 'utf8')
    }
}

compileRuntimeModules()
const runtimeModule = await import(
    `${pathToFileURL(join(compiledRoot, 'runtime.mjs')).href}?v=20260829`
)
const mathModule = await import(
    `${pathToFileURL(join(compiledRoot, 'math.mjs')).href}?v=20260829`
)
const bindingModule = await import(
    `${pathToFileURL(join(compiledRoot, 'binding.mjs')).href}?v=20260829`
)
const catalogModule = await import(
    `${pathToFileURL(join(compiledRoot, 'catalog.mjs')).href}?v=20260904`
)
const actionOptionsModule = await import(
    `${pathToFileURL(join(compiledRoot, 'actionOptions.mjs')).href}?v=20260830`
)
const nativeColliderModule = await import(
    `${pathToFileURL(join(compiledRoot, 'nativeColliders.mjs')).href}?v=20260829`
)
const windModule = await import(
    `${pathToFileURL(join(compiledRoot, 'magicaWind.mjs')).href}?v=20260829`
)

function writableChannelFixture() {
    const source = profile(100301)
    const authored = source.components.cloth.find(cloth => cloth.binding.hierarchyPath.endsWith('/BoneCloth_Bust'))
    assert.ok(authored)
    const cloth = structuredClone(authored)
    cloth.colliderReferences = []
    for (const binding of [cloth.binding, ...cloth.rootBoneBindings, ...cloth.chainBindings]) {
        binding.hierarchyPath = `ActionTimeline/${binding.stableKey}`
        binding.modelRelativePath = null
        binding.visualRootRelativePath = null
    }
    const value = { ...structuredClone(source), stableKey: `${source.stableKey}|writable-channel-fixture`,
        components: { cloth: [cloth], colliders: [], windZones: [], otherMagica: [], native: [] } }
    const root = new THREE.Group(), center = new THREE.Group(), nodes = new Map()
    center.name = cloth.binding.stableKey; root.add(center)
    for (const binding of cloth.chainBindings) {
        const node = new THREE.Bone(); node.name = binding.stableKey; nodes.set(binding.stableKey, node)
        const original = authored.chainBindings.find(row => row.stableKey === binding.stableKey)
        const parentBinding = authored.chainBindings.filter(row => row.stableKey !== binding.stableKey)
            .filter(row => original.modelRelativePath?.startsWith(`${row.modelRelativePath}/`))
            .sort((a,b) => (b.modelRelativePath?.length ?? 0) - (a.modelRelativePath?.length ?? 0))[0]
        const parent = parentBinding ? nodes.get(parentBinding.stableKey) : root
        assert.ok(parent); parent.add(node); node.position.set(0,0.1,0)
    }
    root.updateMatrixWorld(true)
    const registry = bindingModule.createExactPhysicsBindingRegistry()
    const runtime = runtimeModule.createNativeCharacterPhysics(root,value,{bindingRegistry:registry})
    const register = () => [registry.register(cloth.binding.stableKey,center), ...cloth.chainBindings.map(binding => registry.register(binding.stableKey,nodes.get(binding.stableKey)))]
    return {root,center,nodes,cloth,registry,runtime,register}
}

test('native writable channel snapshot uses actual output owners and excludes bound zero-output leaves', () => {
    const f = writableChannelFixture()
    assert.equal(f.runtime.getWritableChannelSnapshot().status,'unavailable')
    f.register()
    assert.equal(f.runtime.getWritableChannelSnapshot().reason,'binding-refresh-pending')
    f.runtime.updateAfterAnimation(1/60)
    const snapshot = f.runtime.getWritableChannelSnapshot()
    assert.equal(snapshot.status,'ready'); assert.equal(snapshot.outputObjects.size,2)
    assert.ok(snapshot.outputObjects.size < f.nodes.size)
    assert.equal(snapshot.root,f.root)
    for (const node of f.nodes.values()) {
        assert.equal(snapshot.outputObjects.has(node),node.children.length > 0)
    }
    assert.deepEqual(new Set(snapshot.outputs.map(row=>row.object)),snapshot.outputObjects)
    for (const row of snapshot.outputs) {
        assert.equal(row.ownerStableKey,f.cloth.stableKey)
        assert.deepEqual(row.channels,['position','quaternion'])
    }
    f.runtime.dispose()
})

test('native writable channel snapshot isolates same-name different-actor identities and external snapshot mutation', () => {
    const a = writableChannelFixture(), b = writableChannelFixture()
    a.register();b.register();a.runtime.updateAfterAnimation(1/60);b.runtime.updateAfterAnimation(1/60)
    const first = a.runtime.getWritableChannelSnapshot(), second=b.runtime.getWritableChannelSnapshot()
    assert.deepEqual([...first.outputObjects].map(node=>node.name),[...second.outputObjects].map(node=>node.name))
    for (const object of first.outputObjects) assert.equal(second.outputObjects.has(object),false)
    first.outputObjects.clear();first.outputObjects.add(b.root);first.outputs.length=0
    const reopened = a.runtime.getWritableChannelSnapshot()
    assert.equal(reopened.outputObjects.size,2);assert.equal(reopened.outputs.length,2)
    assert.equal(reopened.outputObjects.has(b.root),false)
    a.runtime.dispose();b.runtime.dispose()
})

test('native writable channel snapshot is read-only and matches output restore reset refresh and dispose writers', () => {
    const f=writableChannelFixture();f.register();f.runtime.updateAfterAnimation(1/60)
    const allowed=f.runtime.getWritableChannelSnapshot().outputObjects, writes=new Set()
    for(const node of f.nodes.values()) {
        const positionCopy=node.position.copy, quaternionCopy=node.quaternion.copy
        node.position.copy=function(value){writes.add(node);return positionCopy.call(this,value)}
        node.quaternion.copy=function(value){writes.add(node);return quaternionCopy.call(this,value)}
    }
    const before=f.runtime.diagnostics
    for(let i=0;i<5;i++)f.runtime.getWritableChannelSnapshot()
    assert.equal(writes.size,0);assert.deepEqual(f.runtime.diagnostics,before)
    f.center.position.x+=0.04;f.root.updateMatrixWorld(true)
    f.runtime.updateAfterAnimation(1/60)
    assert.ok(writes.size>0)
    for(const object of writes)assert.ok(allowed.has(object),'actual output writer must be in owner map snapshot')
    for(const operation of [()=>f.runtime.reset(),()=>f.runtime.refreshBindings(),()=>f.runtime.dispose()]) {
        writes.clear();operation()
        for(const object of writes)assert.ok(allowed.has(object),'restore/lifecycle write must have prior output ownership')
    }
    const disposed=f.runtime.getWritableChannelSnapshot()
    assert.equal(disposed.status,'unavailable');assert.equal(disposed.reason,'disposed')
    assert.equal('outputObjects' in disposed,false)
})

test('native writable channel snapshot does not disguise pending fail-closed or disabled lifetime as no writers', () => {
    const f=writableChannelFixture()
    assert.deepEqual(f.runtime.getWritableChannelSnapshot(),{status:'unavailable',reason:'fail-closed',root:f.root})
    const releases=f.register()
    const before=f.runtime.diagnostics.resetCount
    assert.equal(f.runtime.getWritableChannelSnapshot().reason,'binding-refresh-pending')
    assert.equal(f.runtime.diagnostics.resetCount,before,'query must not trigger refresh')
    f.runtime.updateAfterAnimation(1/60);f.runtime.setActive(false)
    const disabled=f.runtime.getWritableChannelSnapshot()
    assert.equal(disabled.status,'ready');assert.equal(disabled.runtimeStatus,'disabled');assert.equal(disabled.active,false)
    assert.equal(disabled.outputObjects.size,2,'disabled retains exact potential output reservation')
    releases[0]()
    assert.equal(f.runtime.getWritableChannelSnapshot().reason,'binding-refresh-pending')
    f.runtime.updateAfterAnimation(1/60)
    assert.equal(f.runtime.getWritableChannelSnapshot().reason,'fail-closed')
    f.runtime.dispose()
})

function manualLeaseFixture() {
    const f=writableChannelFixture();f.register();f.runtime.updateAfterAnimation(1/60)
    const outputs=[...f.runtime.getWritableChannelSnapshot().outputObjects]
    let current=true
    const acquire=(objects=outputs)=>f.runtime.acquireManualOutputLease({root:f.root,actorGeneration:1,isCurrent:()=>current,outputs:objects})
    const pose=object=>({position:object.position.toArray(),quaternion:object.quaternion.toArray()})
    const submit=(lease,objects,frameId)=>lease.submitEvaluatedFrame({frameId,source:'post-animation-pre-manual',localPoseByObject:new Map(objects.map(object=>[object,pose(object)]))})
    return {...f,outputs,acquire,pose,submit,stale(){current=false}}
}

function countNativeTransformWrites(objects) {
    const counts=new Map(objects.map(object=>[object,{position:0,quaternion:0}]))
    const restores=[]
    for(const object of objects)for(const field of ['position','quaternion'])for(const method of ['copy','fromArray']) {
        const original=object[field][method]
        object[field][method]=function(...args){counts.get(object)[field]++;return original.apply(this,args)}
        restores.push(()=>{object[field][method]=original})
    }
    return {counts,clear(){for(const value of counts.values()){value.position=0;value.quaternion=0}},restore(){restores.forEach(fn=>fn())}}
}

// Inspect the actual publication pass: a final tree flush is required, but
// recursively flushing every output's descendants first repeats the same work.
for (const state of ['native', 'held', 'return-waiting', 'return-fresh']) {
    test(`native output publication flushes helper descendants once with current world matrices (${state})`, () => {
        const f = manualLeaseFixture()
        const selected = f.outputs[0]
        const helpers = f.outputs.map((output, i) => {
            const helper = new THREE.Group(), tip = new THREE.Group()
            helper.name = `non-output-helper-${i}`
            helper.position.set(0.013, -0.02, 0.007)
            helper.rotation.set(0.1, 0.2, -0.05)
            tip.position.set(0.03, 0.01, -0.04)
            output.add(helper); helper.add(tip)
            return tip
        })
        let lease
        try {
            if (state !== 'native') {
                lease = f.acquire([selected]).value
                selected.position.x += 0.07
                selected.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4)
                f.root.updateMatrixWorld(true)
                if (state.startsWith('return')) {
                    assert.equal(lease.beginReturn({transitionSeconds: 0.2}).status, 'ready')
                    if (state === 'return-fresh') {
                        assert.equal(f.submit(lease, [selected], 1).status, 'ready')
                    }
                }
            }
            // Exercise a non-identity ancestor and deliberately stale helpers.
            f.root.position.set(0.2, 0.7, -0.1)
            f.root.rotation.set(0.13, -0.31, 0.09)
            f.root.scale.setScalar(1.3)
            const visits = new Map(helpers.map(node => [node, 0]))
            for (const node of helpers) {
                const original = node.updateMatrixWorld
                node.updateMatrixWorld = function (...args) {
                    visits.set(this, visits.get(this) + 1)
                    return original.apply(this, args)
                }
            }
            // JS can call this TypeScript-private method; isolate output
            // publication from the solver's necessary input snapshot traversals.
            f.runtime.applySolvedPose()
            for (const [node, count] of visits) assert.equal(count, 1, node.parent.name)
            const expected = new Map()
            f.root.traverse(node => {
                const local = new THREE.Matrix4().compose(node.position, node.quaternion, node.scale)
                const world = node.parent && expected.has(node.parent)
                    ? expected.get(node.parent).clone().multiply(local) : local
                expected.set(node, world)
                const error = Math.max(...world.elements.map((value, i) => Math.abs(value - node.matrixWorld.elements[i])))
                assert.ok(error < 1e-12, `stale matrix for ${node.name}: ${error}`)
            })
        } finally {
            lease?.cancel()
            f.runtime.dispose()
        }
    })
}

test('native manual output lease requires exact ready root generation and potential output membership',()=>{
    const f=manualLeaseFixture(),request={root:f.root,actorGeneration:1,isCurrent:()=>true,outputs:[f.outputs[0]]}
    for(const change of [{root:new THREE.Group()},{actorGeneration:-1},{isCurrent:()=>false},{outputs:[]},
        {outputs:[f.outputs[0],f.outputs[0]]},{outputs:[new THREE.Bone()]},{outputs:[[...f.nodes.values()].find(node=>!f.outputs.includes(node))]}]) {
        assert.equal(f.runtime.acquireManualOutputLease({...request,...change}).status,'unavailable')
    }
    const first=f.acquire([f.outputs[0]]);assert.equal(first.status,'ready')
    assert.equal(f.acquire([f.outputs[0]]).reason,'manual-output-already-held')
    const second=f.acquire([f.outputs[1]]);assert.equal(second.status,'ready')
    assert.equal(f.runtime.getWritableChannelSnapshot().outputObjects.size,f.outputs.length,'yield never hides potential owner membership')
    first.value.cancel();second.value.cancel();f.runtime.setActive(false)
    assert.equal(f.acquire().reason,'runtime-disabled');f.runtime.dispose()
    assert.equal(f.acquire().reason,'disposed')
})

test('native manual output lease holds only selected transforms while other outputs and fixed steps continue',()=>{
    const f=manualLeaseFixture(),selected=f.outputs[0],other=f.outputs[1],lease=f.acquire([selected]).value
    selected.position.set(0.06,0.12,0.03);selected.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),0.45)
    const expected=f.pose(selected),writes=countNativeTransformWrites(f.outputs),before=f.runtime.diagnostics
    for(let i=0;i<12;i++){f.center.position.x+=0.001;f.root.updateMatrixWorld(true);f.runtime.updateAfterAnimation(1/60)}
    assert.deepEqual(writes.counts.get(selected),{position:0,quaternion:0})
    assert.ok(writes.counts.get(other).position>0&&writes.counts.get(other).quaternion>0)
    assert.deepEqual(f.pose(selected),expected);assert.ok(f.runtime.diagnostics.simulationSteps>before.simulationSteps)
    assert.equal(f.runtime.diagnostics.resetCount,before.resetCount);assert.equal(f.runtime.diagnostics.active,true)
    assert.equal(f.runtime.diagnostics.nonFiniteCorrections,0)
    writes.clear();f.runtime.reset();assert.deepEqual(writes.counts.get(selected),{position:0,quaternion:0})
    assert.deepEqual(f.pose(selected),expected);assert.equal(lease.state,'held')
    writes.restore();lease.cancel();f.runtime.dispose()
})

test('native manual output lease pins the real displayed proxy parent without overwriting a held child buffer',()=>{
    const f=manualLeaseFixture(),selected=f.outputs[0],lease=f.acquire([selected]).value
    selected.position.x=0.09;selected.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),0.65)
    f.root.updateMatrixWorld(true)
    const worldPosition=selected.getWorldPosition(new THREE.Vector3()),worldQuaternion=selected.getWorldQuaternion(new THREE.Quaternion())
    f.runtime.updateAfterAnimation(1/60)
    // Actual runtime proxy buffers, not a synthetic solver replacement.
    for(const team of f.runtime.teams)for(let index=0;index<team.particles.length;index++)if(team.particles[index].bone===selected) {
        assert.ok(team.outputWorldPositions[index].distanceTo(worldPosition)<1e-9)
        assert.ok(team.outputWorldQuaternions[index].angleTo(worldQuaternion)<1e-7)
    }
    assert.ok(selected.getWorldQuaternion(new THREE.Quaternion()).angleTo(worldQuaternion)<1e-7)
    lease.cancel();f.runtime.dispose()
})

test('native manual output lease protects a held child proxy from the unheld parent reconstruction pass',()=>{
    const f=manualLeaseFixture(),child=f.outputs[0],parent=f.outputs[1]
    parent.add(child);f.root.updateMatrixWorld(true);f.runtime.refreshBindings()
    const team=f.runtime.teams.find(team=>team.particles.some(particle=>particle.bone===child))
    const childIndex=team.particles.findIndex(particle=>particle.bone===child)
    assert.ok(team.particles.some(particle=>particle.bone===parent&&particle.childIndices.includes(childIndex)))
    const lease=f.acquire([child]).value;child.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),0.7)
    f.root.updateMatrixWorld(true)
    const local=f.pose(child),world=child.getWorldQuaternion(new THREE.Quaternion()),writes=countNativeTransformWrites([child,parent])
    f.runtime.updateAfterAnimation(1/60)
    assert.deepEqual(f.pose(child),local)
    assert.ok(team.outputWorldQuaternions[childIndex].angleTo(world)<1e-7)
    assert.deepEqual(writes.counts.get(child),{position:0,quaternion:0})
    assert.ok(writes.counts.get(parent).quaternion>0)
    writes.restore();lease.cancel();f.runtime.dispose()
})

test('native manual output lease masks equal-last-write restoration in refresh and disposal as well as update',()=>{
    for(const operation of ['update','reset','refresh','dispose']) {
        const f=manualLeaseFixture(),selected=f.outputs[0],expected=f.pose(selected)
        const lease=f.acquire([selected]).value,writes=countNativeTransformWrites([selected])
        if(operation==='update')f.runtime.updateAfterAnimation(1/60)
        else if(operation==='reset')f.runtime.reset()
        else if(operation==='refresh')f.runtime.refreshBindings()
        else f.runtime.dispose()
        assert.deepEqual(f.pose(selected),expected,operation)
        assert.deepEqual(writes.counts.get(selected),{position:0,quaternion:0},operation)
        if(operation==='refresh'||operation==='dispose')assert.equal(lease.state,'invalid')
        writes.restore();lease.cancel();f.runtime.dispose()
    }
})

test('native manual output lease requires a fresh explicitly evaluated next-update frame and never accepts mutated manual targets',()=>{
    const f=manualLeaseFixture(),selected=f.outputs[0],lease=f.acquire([selected]).value
    selected.position.x=0.4;const from=f.pose(selected)
    assert.equal(lease.beginReturn({transitionSeconds:0.2}).status,'ready')
    selected.position.x=-2;f.runtime.updateAfterAnimation(1/60)
    assert.equal(lease.reason,'WAIT_EVALUATED_FRAME');assert.deepEqual(f.pose(selected),from)
    const data={frameId:1,source:'post-animation-pre-manual',localPoseByObject:new Map([[selected,f.pose(selected)]])}
    assert.equal(lease.submitEvaluatedFrame({...data,source:'manual'}).status,'unavailable')
    assert.equal(lease.submitEvaluatedFrame(data).status,'ready')
    selected.position.x=3;f.runtime.updateAfterAnimation(1/60)
    assert.equal(lease.reason,'WAIT_EVALUATED_FRAME');assert.deepEqual(f.pose(selected),from)
    assert.equal(lease.submitEvaluatedFrame(data).reason,'STALE_OR_UNKNOWN_EVALUATOR_FRAME')
    assert.equal(f.submit(lease,[selected],2).status,'ready');f.runtime.updateAfterAnimation(1/60)
    assert.equal(lease.reason,undefined);assert.deepEqual(f.pose(selected),from)
    f.runtime.updateAfterAnimation(1/60);assert.equal(lease.reason,'WAIT_EVALUATED_FRAME')
    assert.deepEqual(f.pose(selected),from);lease.cancel();f.runtime.dispose()
})

test('native manual output lease returns from displayed pose to a moving evaluated target at time-based frame rates',()=>{
    for(const hz of [30,60,90,144]) {
        const f=manualLeaseFixture(),selected=f.outputs[0],lease=f.acquire([selected]).value
        // Isolate the return interpolator analytically; the real solver remains active and stepping.
        f.runtime.setBlendWeight(0)
        selected.position.x=0.5;selected.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),0.7)
        const from=f.pose(selected);lease.beginReturn({transitionSeconds:0.2})
        for(let frame=0;frame<=Math.ceil(hz*0.2);frame++) {
            const time=frame/hz,targetX=-0.1-time*0.2,targetQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-0.2-time)
            selected.position.x=targetX;selected.quaternion.copy(targetQ);f.submit(lease,[selected],frame)
            f.runtime.updateAfterAnimation(1/hz)
            const ratio=Math.min(1,time/0.2),alpha=ratio*ratio*(3-2*ratio)
            assert.ok(Math.abs(selected.position.x-(from.position[0]*(1-alpha)+targetX*alpha))<1e-9,`hz=${hz}, frame=${frame}`)
            const expected=new THREE.Quaternion(...from.quaternion).slerp(targetQ,alpha)
            assert.ok(selected.quaternion.angleTo(expected)<1e-6)
        }
        assert.equal(lease.state,'released');assert.equal(f.runtime.diagnostics.active,true)
        selected.position.x=-0.42;f.runtime.updateAfterAnimation(1/hz);assert.ok(Math.abs(selected.position.x+0.42)<1e-9)
        f.runtime.dispose()
    }
})

test('native manual output lease has a single actual return writer with fresh native targets and once-only completion',()=>{
    const f=manualLeaseFixture(),selected=f.outputs[0],lease=f.acquire([selected]).value
    selected.position.x=0.25;selected.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),0.4)
    const from=f.pose(selected);lease.beginReturn({transitionSeconds:0.05})
    const writes=countNativeTransformWrites([selected])
    for(let frame=0;frame<5;frame++) {
        selected.position.set(frame*0.003,0.1,0);selected.quaternion.identity();f.root.updateMatrixWorld(true)
        if(lease.state!=='released')assert.equal(f.submit(lease,[selected],frame).status,'ready')
        writes.clear();f.runtime.updateAfterAnimation(1/60)
        assert.deepEqual(writes.counts.get(selected),{position:1,quaternion:1})
        if(frame===0)assert.deepEqual(f.pose(selected),from)
        assert.ok([...selected.position.toArray(),...selected.quaternion.toArray()].every(Number.isFinite))
    }
    assert.equal(lease.state,'released');writes.clear();lease.cancel();lease.cancel()
    assert.deepEqual(writes.counts.get(selected),{position:0,quaternion:0})
    writes.restore();f.runtime.dispose()
})

test('native manual output lease recaptures interrupted return and old cancellation cannot clear successor ownership',()=>{
    const f=manualLeaseFixture(),selected=f.outputs[0],other=f.outputs[1],first=f.acquire().value
    selected.position.x=0.4;first.beginReturn({transitionSeconds:0.2})
    for(let frame=0;frame<3;frame++) {
        selected.position.x=-0.2;f.submit(first,f.outputs,frame);f.runtime.updateAfterAnimation(1/60)
    }
    const displayed=f.pose(selected),next=f.acquire([selected])
    assert.equal(next.status,'ready');assert.deepEqual(f.pose(selected),displayed)
    assert.equal(first.owns(selected),false);assert.equal(first.owns(other),true)
    first.cancel();first.cancel();assert.equal(next.value.owns(selected),true)
    next.value.beginReturn({transitionSeconds:0.1});selected.position.x=-1;f.submit(next.value,[selected],3)
    f.runtime.updateAfterAnimation(1/60);assert.deepEqual(f.pose(selected),displayed)
    next.value.cancel();f.runtime.dispose()
})

test('native manual output lease invalidates binding epochs generation detach and disable without stale lease writes',()=>{
    for(const change of ['registry','refresh','generation','detach','disabled']) {
        const f=manualLeaseFixture(),selected=f.outputs[0],lease=f.acquire([selected]).value,writes=countNativeTransformWrites([selected])
        if(change==='registry')f.registry.register('probe:unrelated',new THREE.Group())
        else if(change==='refresh')f.runtime.refreshBindings()
        else if(change==='generation')f.stale()
        else if(change==='detach')selected.removeFromParent()
        else f.runtime.setActive(false)
        assert.equal(lease.state,'invalid',change)
        assert.equal(lease.owns(selected),false)
        assert.equal(lease.beginReturn({transitionSeconds:0.2}).status,'unavailable')
        lease.cancel();assert.deepEqual(writes.counts.get(selected),{position:0,quaternion:0},change)
        writes.restore();f.runtime.dispose()
    }
})

test('native manual output lease snapshots are copied and same-resource actors retain independent native state',()=>{
    const a=manualLeaseFixture(),b=manualLeaseFixture(),selected=a.outputs[0],request=[selected],lease=a.acquire(request).value
    request.length=0;assert.equal(lease.owns(selected),true)
    selected.position.x=0.3;lease.beginReturn({transitionSeconds:0})
    selected.position.x=-0.1;const snapshot=a.pose(selected)
    assert.equal(lease.submitEvaluatedFrame({frameId:0,source:'post-animation-pre-manual',localPoseByObject:new Map([[selected,snapshot]])}).status,'ready')
    snapshot.position[0]=999
    a.runtime.updateAfterAnimation(1/60);assert.equal(lease.state,'released')
    const bBefore=b.runtime.diagnostics.simulationSteps;b.runtime.updateAfterAnimation(1/60)
    assert.ok(b.runtime.diagnostics.simulationSteps>bBefore);assert.equal(b.acquire([b.outputs[0]]).status,'ready')
    assert.ok(Math.abs(selected.position.x)<1)
    const invalid=a.acquire([selected]).value
    for(const transitionSeconds of [-1,NaN,Infinity])assert.equal(invalid.beginReturn({transitionSeconds}).status,'unavailable')
    const nonfinite=a.pose(selected);nonfinite.quaternion[1]=NaN
    assert.equal(invalid.submitEvaluatedFrame({frameId:1,source:'post-animation-pre-manual',localPoseByObject:new Map([[selected,nonfinite]])}).status,'unavailable')
    invalid.cancel();a.runtime.dispose();b.runtime.dispose()
})

function parseFbxGzip(path) {
    const decoded = gunzipSync(readFileSync(path))
    const arrayBuffer = decoded.buffer.slice(
        decoded.byteOffset,
        decoded.byteOffset + decoded.byteLength,
    )
    return new FBXLoader(new THREE.LoadingManager()).parse(arrayBuffer, '')
}

function resolvePublishedViewerModel(entry) {
    const modelRoot = join(repoRoot, 'magia-exedra-character-three', 'models')
    const prefix = `chara_${entry.characterResourceId}`
    const directories = readdirSync(modelRoot, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => item.name)
        .filter(name => name === prefix || name.startsWith(`${prefix}_`))
    const products = []
    for (const directory of directories) {
        const directoryPath = join(modelRoot, directory)
        for (const name of readdirSync(directoryPath)) {
            if (name.endsWith('.fbx.gz')) {
                products.push({ directory, path: join(directoryPath, name) })
            }
        }
    }
    assert.ok(products.length <= 1, `ambiguous viewer model product: ${entry.characterResourceId}`)
    return products[0] ?? null
}

function exactSuffixMatches(root, suffix) {
    const matches = []
    root.traverse(object => {
        const parts = []
        let current = object
        while (current && current !== root.parent) {
            if (current.name) parts.push(current.name)
            current = current.parent
        }
        const path = parts.reverse().join('/')
        if (path === suffix || path.endsWith(`/${suffix}`)) matches.push(object)
    })
    return matches
}

function requireExactBone(root, suffix) {
    const matches = exactSuffixMatches(root, suffix).filter(object => object.isBone)
    assert.equal(matches.length, 1, `expected one exact Bone for ${suffix}`)
    return matches[0]
}

function localPose(object) {
    return {
        position: object.position.toArray(),
        quaternion: object.quaternion.toArray(),
    }
}

function assertPoseEqual(actualObject, expected, message) {
    assert.deepEqual(actualObject.position.toArray(), expected.position, `${message}:position`)
    assert.deepEqual(actualObject.quaternion.toArray(), expected.quaternion, `${message}:quaternion`)
}

test('production character loader attaches the validated manifest-driven physics writer', () => {
    const source = readFileSync(
        join(repoRoot, 'src', 'viewer', 'character.ts'),
        'utf8',
    )
    assert.match(source, /attachViewerCharacterPhysics/)
    assert.match(source, /class PhysicsEnabledCharacterManager extends MagiaExedraCharacterThree/)
    assert.match(source, /await attachViewerCharacterPhysics\(character\)/)
    assert.match(source, /source: 'production-character-loader'/)
    assert.match(source, /magiusCharacterPhysics/)
    assert.doesNotMatch(source, /characterResourceId\s*===|characterResourceId\s*==/)
    assert.match(source, /redrive-baked-normals\.bin\*/)
})

test('native physics runs in a renderer-level callback after the complete character loop', () => {
    const integration = readFileSync(
        join(repoRoot, 'src', 'viewer', 'characterPhysics', 'viewerIntegration.ts'),
        'utf8',
    )
    const characterRuntime = readFileSync(
        join(repoRoot, 'magia-exedra-character-three', 'character.ts'),
        'utf8',
    )
    assert.match(integration, /addAnimationLoop/)
    assert.match(integration, /removeAnimationLoop/)
    assert.match(integration, /addAnimationLoop\(value\.update\)/)
    assert.match(integration, /removeAnimationLoop\(value\.update\)/)
    assert.doesNotMatch(integration, /animationLoops\.push\(value\.update\)/)
    assert.doesNotMatch(integration, /animationLoops\.splice/)
    assert.match(characterRuntime, /addAnimationLoop\(this\.animationLoop\)/)
    assert.match(characterRuntime, /this\.animation\.animationLoop\(\)[\s\S]*this\.userData\.animationLoops\.forEach/)
})

test('official catalog publishes all 94 character physics products with exact mechanism counts', () => {
    const catalog = json(join(publicRoot, 'manifest.v1.json'))
    assert.equal(catalog.schema, 'magius.character-physics-catalog.v1')
    assert.equal(catalog.lookupKey, 'style3dCharacterMstId|characterResourceId')
    assert.deepEqual(catalog.counts, {
        characters: 94,
        failClosed: 0,
        magicaCloth: 954,
        magicaComponents: 2987,
        nativePhysicsComponents: 97,
        runtimeReady: 94,
    })
    assert.deepEqual(catalog.mechanismCounts.magica, {
        MagicaCapsuleCollider: 1578,
        MagicaCloth: 954,
        MagicaPlaneCollider: 137,
        MagicaSphereCollider: 314,
        MagicaWindZone: 4,
    })
    assert.deepEqual(catalog.mechanismCounts.native, {
        CapsuleCollider: 91,
        MeshCollider: 3,
        SphereCollider: 3,
    })
    assert.deepEqual(catalog.runtimeMechanismCounts, {
        cloth: {
            'fail-closed': 1,
            inactive: 12,
            'runtime-ready': 941,
        },
        magicaColliders: {
            'runtime-ready': 2026,
            inactive: 3,
        },
        windZones: {
            'runtime-ready': 4,
            inactive: 0,
        },
        nativeColliders: {
            'runtime-ready': 97,
            inactive: 0,
        },
    })
    assert.equal(new Set(catalog.entries.map(entry => entry.style3dCharacterMstId)).size, 94)
    assert.equal(new Set(catalog.entries.map(entry => entry.characterResourceId)).size, 94)
    assert.equal(new Set(catalog.entries.map(entry => entry.stableKey)).size, 94)
    for (const entry of catalog.entries) {
        assert.equal(entry.runtimeStatus, 'runtime-ready')
        assert.deepEqual(entry.failClosedReasons, [])
        const productPath = join(publicRoot, entry.productUrl.replace(/^\.\//, ''))
        assert.ok(existsSync(productPath))
        const product = json(productPath)
        assert.equal(product.runtime.fixedStepSeconds, 1 / 90)
        assert.equal(product.runtime.maximumCatchUpSteps, 3)
        const bindingByStableKey = new Map(product.physicsTransformBindings.map(
            binding => [binding.stableKey, binding],
        ))
        for (const cloth of product.components.cloth) {
            assert.ok(cloth.centerTransformBindingStableKeys.length > 0)
            assert.equal(cloth.centerTransformBindingStableKeys[0], cloth.binding.stableKey)
            for (const stableKey of cloth.centerTransformBindingStableKeys) {
                assert.ok(bindingByStableKey.has(stableKey), stableKey)
            }
            assert.ok(cloth.centerTransformCandidates.length > 0)
            assert.equal(cloth.centerTransformCandidates[0].bindingStableKey, cloth.binding.stableKey)
            for (const candidate of cloth.centerTransformCandidates) {
                assert.ok(bindingByStableKey.has(candidate.bindingStableKey))
                assert.ok(
                    candidate.exactExportRelativePath === null
                    || candidate.exactExportRelativePath.length > 0,
                )
                for (const stableKey of candidate.identityBridgeStableKeys) {
                    assert.ok(bindingByStableKey.has(stableKey), stableKey)
                }
            }
        }
    }
})

function characterPhysicsCatalogFetcher(manifest, requests = []) {
    return async input => {
        const url = new URL(String(input))
        requests.push(url.pathname)
        if (url.pathname === '/character-physics/manifest.v1.json') {
            return {
                ok: true,
                status: 200,
                async json() { return manifest },
            }
        }
        const relativePath = url.pathname.replace(/^\/character-physics\//, '')
        const productPath = join(publicRoot, relativePath)
        if (!existsSync(productPath)) {
            return { ok: false, status: 404, async json() { return {} } }
        }
        return {
            ok: true,
            status: 200,
            async json() { return json(productPath) },
        }
    }
}

test('Viewer primary physics identity is exact resource-first with a style fallback only on zero resource matches', async () => {
    const manifest = json(join(publicRoot, 'manifest.v1.json'))
    const requests = []
    const client = new catalogModule.CharacterPhysicsCatalogClient(
        '/character-physics/manifest.v1.json',
        characterPhysicsCatalogFetcher(manifest, requests),
    )

    const aliasedStyle = await client.requireProfileForViewerCharacter(100101)
    assert.equal(
        aliasedStyle.stableKey,
        'character-physics:style3dCharacterMstId=100101|resourceName=chara_100107_battle_unit',
    )
    assert.deepEqual(aliasedStyle.identity, {
        style3dCharacterMstId: 100101,
        characterResourceId: 100107,
        resourceName: 'chara_100107_battle_unit',
        displayName: '鹿目まどか/魔法少女',
    })

    const directResource = await client.requireProfileForViewerCharacter(100107)
    assert.equal(directResource.stableKey, aliasedStyle.stableKey)

    const dualHitResource = await client.requireProfileForViewerCharacter(100102)
    assert.deepEqual(
        {
            style3dCharacterMstId: dualHitResource.identity.style3dCharacterMstId,
            characterResourceId: dualHitResource.identity.characterResourceId,
        },
        { style3dCharacterMstId: 100106, characterResourceId: 100102 },
    )

    const directSameIdentity = await client.requireProfileForViewerCharacter(113501)
    assert.deepEqual(
        {
            style3dCharacterMstId: directSameIdentity.identity.style3dCharacterMstId,
            characterResourceId: directSameIdentity.identity.characterResourceId,
        },
        { style3dCharacterMstId: 113501, characterResourceId: 113501 },
    )
    assert.deepEqual(requests, [
        '/character-physics/manifest.v1.json',
        '/character-physics/characters/100101/profile.v1.json',
        '/character-physics/characters/100101/profile.v1.json',
        '/character-physics/characters/100106/profile.v1.json',
        '/character-physics/characters/113501/profile.v1.json',
    ])
})

test('Viewer primary physics identity fails closed for missing or non-unique exact matches', async () => {
    const base = json(join(publicRoot, 'manifest.v1.json'))

    const missing = new catalogModule.CharacterPhysicsCatalogClient(
        '/character-physics/manifest.v1.json',
        characterPhysicsCatalogFetcher(base),
    )
    await assert.rejects(
        missing.requireProfileForViewerCharacter(999999),
        /profile-identity-count:style:999999:0/,
    )

    const resourceDuplicate = structuredClone(base)
    resourceDuplicate.entries.push(structuredClone(
        resourceDuplicate.entries.find(entry => entry.characterResourceId === 100107),
    ))
    resourceDuplicate.counts.characters += 1
    const ambiguousResource = new catalogModule.CharacterPhysicsCatalogClient(
        '/character-physics/manifest.v1.json',
        characterPhysicsCatalogFetcher(resourceDuplicate),
    )
    await assert.rejects(
        ambiguousResource.requireProfileForViewerCharacter(100107),
        /profile-identity-count:resource:100107:2/,
    )

    const styleDuplicate = structuredClone(base)
    styleDuplicate.entries.push(structuredClone(
        styleDuplicate.entries.find(entry => entry.style3dCharacterMstId === 100101),
    ))
    styleDuplicate.counts.characters += 1
    const ambiguousStyle = new catalogModule.CharacterPhysicsCatalogClient(
        '/character-physics/manifest.v1.json',
        characterPhysicsCatalogFetcher(styleDuplicate),
    )
    await assert.rejects(
        ambiguousStyle.requireProfileForViewerCharacter(100101),
        /profile-identity-count:style:100101:2/,
    )
})

test('official MagicaCloth timing, constraint order and per-step pose interpolation stay literal', () => {
    const runtime = readFileSync(
        join(repoRoot, 'src', 'viewer', 'characterPhysics', 'runtime.ts'),
        'utf8',
    )
    const binding = readFileSync(
        join(repoRoot, 'src', 'viewer', 'characterPhysics', 'binding.ts'),
        'utf8',
    )
    const generator = readFileSync(
        join(repoRoot, 'tools', 'magius', 'build_character_physics_products.py'),
        'utf8',
    )
    assert.match(runtime, /\?\? 1 \/ 90/)
    assert.match(runtime, /\?\? 3\)/)
    assert.match(runtime, /previousPosition\.addScaledVector\(movement, velocityAttenuation\)/)
    assert.match(runtime, /ANGLE_LIMIT_ITERATIONS = 3/)
    assert.doesNotMatch(runtime, /ANGLE_RESTORATION_SCALE/)
    assert.match(runtime, /particle\.angleRotationBuffer\.copy\(particle\.animationWorldQuaternion\)/)
    assert.match(runtime, /applyQuaternion\(parent\.angleRotationBuffer\)/)
    assert.match(runtime, /particle\.angleBufferedLength/)
    assert.match(runtime, /cloth\.angleRestorationConstraint\.stiffness,[\s\S]*particle\.normalizedDepth,[\s\S]*\),/)
    assert.doesNotMatch(runtime, /attenuation \* 0\.25/)
    assert.match(runtime, /this\.solveTether\(team, spring\)[\s\S]*this\.solveDistances\(team, spring\)[\s\S]*this\.solveAngles\(team, spring\)[\s\S]*this\.solveColliders\(team, spring\)[\s\S]*this\.solveDistances\(team, spring\)[\s\S]*this\.solveMotionConstraints\(team, spring\)/)
    assert.match(runtime, /commitDisplayStep\(team\)/)
    assert.match(runtime, /interpolateDisplayPose\(team\)/)
    assert.match(runtime, /this\.transportTeamForFrame\(team, selectedDelta\)[\s\S]*while \(team\.accumulator/)
    assert.match(runtime, /prepareSimulationPose\(team, stepRatio, this\.fixedStepSeconds\)/)
    assert.match(runtime, /this\.transportTeamForStep\(team, deltaSeconds\)/)
    assert.match(runtime, /prepareColliderGeometry\(team, previousStepRatio, stepRatio\)/)
    assert.match(runtime, /framePreviousAnimationPosition/)
    assert.match(runtime, /frameCurrentAnimationPosition/)
    assert.match(runtime, /framePreviousCenter/)
    assert.match(runtime, /frameCurrentCenter/)
    assert.match(runtime, /particle\.realVelocity/)
    assert.match(runtime, /const futurePosition = particle\.position\.clone\(\)\.addScaledVector/)
    assert.match(runtime, /MAX_FUTURE_PREDICTION_DISTANCE_RATIO = 1\.3/)
    assert.match(runtime, /const rootAnimationPosition = team\.particles\[particle\.rootIndex\]!/)
    assert.match(runtime, /const authoredRootDistance = rootAnimationPosition\.distanceTo\([\s\S]*particle\.frameCurrentAnimationPosition/)
    assert.match(runtime, /maximumPredictionDistance \/ predictedRootDistance/)
    assert.match(runtime, /futurePosition[\s\S]*\.copy\(rootAnimationPosition\)[\s\S]*\.addScaledVector\([\s\S]*predictedRootOffset/)
    assert.match(runtime, /team\.renderTime - team\.previousRenderTime/)
    assert.match(runtime, /team\.elapsed \+ this\.fixedStepSeconds/)
    assert.match(runtime, /Math\.exp\([\s\S]*team\.lastFrameDelta[\s\S]*this\.fixedStepSeconds \* 4/)
    assert.match(runtime, /lastWrittenResidualWorldPosition/)
    assert.match(runtime, /team\.outputWorldPositions\[index\]![\s\S]*\.clone\(\)[\s\S]*\.sub\(particle\.frameCurrentAnimationPosition\)/)
    assert.match(runtime, /team\.outputWorldPositions\[index\]![\s\S]*\.copy\(particle\.frameCurrentAnimationPosition\)[\s\S]*\.add\(outputWorldPositionResidual\)/)
    assert.match(runtime, /lastWrittenResidualWorldPosition\.clone\(\)\.lerp\([\s\S]*positionResidualInterpolation/)
    assert.match(runtime, /hasPositionResidualHistory/)
    const fixedStep = 1 / 90
    const responseAfterOneSecond = fps => {
        const alpha = 1 - Math.exp(-(1 / fps) / (fixedStep * 4))
        return 1 - (1 - alpha) ** fps
    }
    assert.ok(Math.abs(
        responseAfterOneSecond(60) - responseAfterOneSecond(90),
    ) < 1e-12)
    assert.match(binding, /resolveExact\(index, cloth\.binding, external\)/)
    assert.match(binding, /cloth\.centerTransformBindingStableKeys/)
    assert.match(binding, /cloth\.centerTransformCandidates/)
    assert.match(binding, /candidate\.identityBridgeStableKeys/)
    assert.match(binding, /candidate\.exactExportRelativePath/)
    assert.match(binding, /isPublishedIdentityTransform/)
    assert.match(binding, /if \(!omittedSuffixIsIdentity\) break/)
    assert.match(binding, /byStableKey\.set\(cloth\.stableKey, center\.object\)/)
    assert.match(runtime, /const anchor = this\.bindings\.byStableKey\.get\(cloth\.stableKey\)/)
    assert.doesNotMatch(runtime, /particles\[rootIndices\[0\] \?\? 0\]\?\.bone\.parent/)
    assert.doesNotMatch(runtime, /team\.accumulator \/ this\.fixedStepSeconds/)
    assert.doesNotMatch(runtime, /displayPreviousPosition\)\s*\.lerp\(particle\.displayCurrentPosition/)
    assert.match(generator, /"fixedStepSeconds": 1 \/ 90/g)
    assert.match(generator, /"maximumCatchUpSteps": 3/g)
    assert.doesNotMatch(generator, /"fixedStepSeconds": 1 \/ 60/)
    assert.doesNotMatch(generator, /"maximumCatchUpSteps": 2/)
})

test('official edge collider mode uses weighted endpoints and cached frame geometry', () => {
    const runtime = readFileSync(
        join(repoRoot, 'src', 'viewer', 'characterPhysics', 'runtime.ts'),
        'utf8',
    )
    assert.match(runtime, /closestPointSegmentRatio/)
    assert.match(runtime, /closestSegmentRatios/)
    assert.match(runtime, /weightedEdgeCorrection/)
    assert.match(runtime, /colliderGeometryByStableKey/)
    assert.match(runtime, /previousStart/)
    assert.match(runtime, /previousEnd/)
    assert.doesNotMatch(runtime, /const midpoint =/)
    assert.doesNotMatch(runtime, /position: midpoint/)
    assert.doesNotMatch(runtime, /requestedStep > maximumStep/)
})

test('action-phase catalog exposes four exact wind registrations and keeps UI-prefab mesh colliders non-action', async () => {
    const manifest = json(join(publicRoot, 'action-options.v1.json'))
    assert.equal(manifest.schema, 'magius.character-physics-action-options.v1')
    assert.equal(manifest.lookupKey, 'characterResourceId+phaseStableKey')
    assert.deepEqual(manifest.counts, {
        characters: 2,
        actionPhases: 4,
        actionRegistrationBindings: 4,
        auxiliaryRegistrationBindings: 3,
        relatedViewerActionOptions: 6,
        relatedViewerActionsSourceAvailable: 5,
        relatedViewerActionsUnavailable: 1,
        failClosed: 0,
    })
    assert.deepEqual(
        manifest.entries.map(entry => [
            entry.character.characterResourceId,
            entry.phaseKind,
            entry.officialDisplayName,
            entry.phaseRoot.officialGameObjectName,
        ]),
        [
            [
                113701,
                'special-skill-reserve-and-pre-special',
                'CharacterSpReserveAndPreSpTimeline113701',
                'CharacterSpReserveAndPreSpTimeline113701',
            ],
            [
                113701,
                'special-skill-reserve',
                'SpecialSkillReserveTimeline113701',
                'CharacterSpReserveTimeline113701',
            ],
            [
                113801,
                'special-skill-reserve-and-pre-special',
                'CharacterSpReserveAndPreSpTimeline113801',
                'CharacterSpReserveAndPreSpTimeline113801',
            ],
            [
                113801,
                'special-skill-reserve',
                'SpecialSkillReserveTimeline113801',
                'CharacterSpReserveTimeline113801',
            ],
        ],
    )
    for (const entry of manifest.entries) {
        assert.equal(entry.registrationBindings.length, 1)
        assert.equal(entry.registrationBindings[0].componentKind, 'MagicaWindZone')
        assert.equal(entry.registrationBindings[0].exactRelativePath, 'WindZone')
        assert.equal(entry.availability.playbackStatus, 'consumer-pending')
        assert.deepEqual(entry.availability.failClosedReasons, [
            'official-action-phase-playback-consumer-not-attached',
        ])
    }
    assert.deepEqual(
        manifest.auxiliaryRegistrations.map(entry => [
            entry.prefabRootName,
            entry.componentKind,
            entry.selectableAction,
        ]),
        [
            ['eff_ui_SwitchSkill_Button_113701_02', 'MeshCollider', false],
            ['eff_ui_SwitchSkill_Button_113801_02', 'MeshCollider', false],
            ['eff_ui_SwitchSkill_Button_113801_01', 'MeshCollider', false],
        ],
    )
    const scopes = []
    for (const styleId of [100102, 113801]) {
        const value = profile(styleId)
        for (const zone of value.components.windZones) scopes.push([zone.script, zone.scope])
        for (const collider of value.components.native) {
            if (collider.type === 'MeshCollider') scopes.push([collider.type, collider.scope])
        }
    }
    assert.deepEqual(scopes.filter(([, scope]) => scope === 'action-timeline-registration'), [
        ['MagicaWindZone', 'action-timeline-registration'],
        ['MagicaWindZone', 'action-timeline-registration'],
        ['MagicaWindZone', 'action-timeline-registration'],
        ['MagicaWindZone', 'action-timeline-registration'],
    ])
    assert.equal(scopes.filter(([, scope]) => scope === 'auxiliary-prefab-registration').length, 3)

    const client = new actionOptionsModule.CharacterPhysicsActionOptionsClient(
        '/character-physics/action-options.v1.json',
        async () => new Response(JSON.stringify(manifest), { status: 200 }),
    )
    assert.equal((await client.listPhasesForCharacter(113701)).length, 2)
    assert.equal((await client.listViewerActionsForCharacter(113801)).length, 3)
    assert.equal(
        (await client.requirePhase(manifest.entries[0].stableKey)).optionValue,
        manifest.entries[0].stableKey,
    )
})

test('action-phase exact registration activates and removes only its published transform key', () => {
    const manifest = json(join(publicRoot, 'action-options.v1.json'))
    const phase = manifest.entries[0]
    const root = new THREE.Group()
    root.name = phase.phaseRoot.officialGameObjectName
    const wind = new THREE.Group()
    wind.name = 'WindZone'
    root.add(wind)
    const registry = bindingModule.createExactPhysicsBindingRegistry()
    const dispose = actionOptionsModule.registerCharacterPhysicsActionPhaseBindings(
        phase,
        root,
        registry,
    )
    const bindingKey = phase.registrationBindings[0].bindingStableKey
    assert.equal(registry.resolve(bindingKey), wind)
    dispose()
    assert.equal(registry.resolve(bindingKey), undefined)

    const duplicateRoot = root.clone(false)
    duplicateRoot.name = phase.phaseRoot.officialGameObjectName
    const first = new THREE.Group()
    first.name = 'WindZone'
    const second = new THREE.Group()
    second.name = 'WindZone'
    duplicateRoot.add(first, second)
    assert.throws(
        () => actionOptionsModule.registerCharacterPhysicsActionPhaseBindings(
            phase,
            duplicateRoot,
            registry,
        ),
        /external-binding-path-count/,
    )
    assert.equal(registry.resolve(bindingKey), undefined)
})

test('public products are repository-contained and use one exact stable binding shape', () => {
    const catalog = json(join(publicRoot, 'manifest.v1.json'))
    const publicText = [readFileSync(join(publicRoot, 'manifest.v1.json'), 'utf8')]
    for (const entry of catalog.entries) {
        const path = join(publicRoot, entry.productUrl.replace(/^\.\//, ''))
        const text = readFileSync(path, 'utf8')
        publicText.push(text)
        const value = JSON.parse(text)
        assert.equal(value.runtime.bindingPolicy.nameFallback, false)
        assert.equal(
            value.runtime.bindingPolicy.writerPolicy,
            'single-post-animation-physics-writer',
        )
        for (const binding of value.physicsTransformBindings) {
            assert.match(binding.stableKey, /^unity-transform:bundle=.+\|pathID=-?\d+$/)
            assert.equal(typeof binding.transformPathID, 'string')
            assert.equal('transformStableKey' in binding, false)
        }
        for (const collider of value.components.colliders) {
            assert.match(collider.binding.stableKey, /^unity-transform:/)
            assert.equal('transformStableKey' in collider.binding, false)
            assert.ok('visualRootRelativePath' in collider.binding)
        }
        for (const cloth of value.components.cloth) {
            assert.ok(Array.isArray(cloth.collisionBoneBindings))
            assert.ok(['runtime-ready', 'inactive', 'fail-closed'].includes(
                cloth.runtimeBinding.status,
            ))
            assert.equal(
                cloth.chainBindings.length,
                new Set(cloth.chainBindings.map(binding => binding.stableKey)).size,
            )
        }
    }
    const serialized = publicText.join('\n')
    assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]/)
    assert.doesNotMatch(serialized, /ma-ex-data|Madoka Magica Magia Exedra TW/)
})

test('the corpus preserves every official cloth mode instead of character ID special cases', () => {
    const catalog = json(join(publicRoot, 'manifest.v1.json'))
    const clothTypes = new Map()
    const updateModes = new Map()
    const connectionModes = new Map()
    const collisionModes = new Map()
    let fullSelfCollision = 0
    let teleportKeep = 0
    for (const entry of catalog.entries) {
        const value = profile(entry.style3dCharacterMstId)
        for (const cloth of value.components.cloth) {
            const data = cloth.serializeData
            clothTypes.set(data.clothType, (clothTypes.get(data.clothType) ?? 0) + 1)
            updateModes.set(data.updateMode, (updateModes.get(data.updateMode) ?? 0) + 1)
            connectionModes.set(
                data.connectionMode,
                (connectionModes.get(data.connectionMode) ?? 0) + 1,
            )
            collisionModes.set(
                data.colliderCollisionConstraint.mode,
                (collisionModes.get(data.colliderCollisionConstraint.mode) ?? 0) + 1,
            )
            if (data.selfCollisionConstraint.selfMode === 2) fullSelfCollision += 1
            if (data.inertiaConstraint.teleportMode === 1) teleportKeep += 1
        }
    }
    assert.deepEqual(Object.fromEntries(clothTypes), { 1: 953, 10: 1 })
    assert.deepEqual(Object.fromEntries(updateModes), { 0: 582, 1: 23, 2: 16, 10: 333 })
    assert.deepEqual(Object.fromEntries(connectionModes), { 0: 798, 1: 49, 2: 72, 3: 35 })
    assert.deepEqual(Object.fromEntries(collisionModes), { 1: 688, 2: 266 })
    assert.equal(fullSelfCollision, 1)
    assert.equal(teleportKeep, 6)
})

test('100301 bust, 108601 BoneSpring, and 100401 full self-collision remain literal', () => {
    const mami = profile(100301)
    const bust = mami.components.cloth.find(cloth =>
        cloth.binding.hierarchyPath.endsWith('/BoneCloth_Bust'))
    assert.ok(bust)
    assert.deepEqual(bust.rootBoneBindings.map(binding => binding.modelRelativePath), [
        'Root/Hip/Spine/Waist/Chest/Bust_L_01_Sp',
        'Root/Hip/Spine/Waist/Chest/Bust_R_01_Sp',
    ])
    assert.equal(bust.chainBindings.length, 4)
    assert.equal(bust.serializeData.damping.value, 0.05299999937415123)
    assert.equal(bust.serializeData.angleLimitConstraint.limitAngle.value, 49.400001525878906)
    assert.equal(bust.serializeData.angleRestorationConstraint.velocityAttenuation, 0.5550000071525574)
    assert.equal(bust.serializeData.inertiaConstraint.localMovementSpeedLimit.value, 7.559999942779541)
    assert.equal(bust.serializeData.inertiaConstraint.particleSpeedLimit.value, 4)

    const springTeams = profile(108601).components.cloth.filter(
        cloth => cloth.serializeData.clothType === 10,
    )
    assert.equal(springTeams.length, 1)
    assert.equal(springTeams[0].serializeData.springConstraint.useSpring, 1)
    assert.equal(springTeams[0].serializeData.gravity, 0)
    assert.equal(springTeams[0].serializeData.selfCollisionConstraint.selfMode, 0)
    assert.equal(springTeams[0].serializeData.colliderCollisionConstraint.mode, 1)

    const selfTeams = profile(100401).components.cloth.filter(
        cloth => cloth.serializeData.selfCollisionConstraint.selfMode === 2,
    )
    assert.equal(selfTeams.length, 1)
    assert.equal(selfTeams[0].serializeData.selfCollisionConstraint.syncMode, 2)
})

test('curve and collider math are bounded and finite', () => {
    const curve = {
        m_Curve: [
            { time: 0, value: 0, inSlope: 0, outSlope: 1, weightedMode: 0, inWeight: 0, outWeight: 0 },
            { time: 1, value: 1, inSlope: 1, outSlope: 0, weightedMode: 0, inWeight: 0, outWeight: 0 },
        ],
        m_PreInfinity: 2,
        m_PostInfinity: 2,
        m_RotationOrder: 4,
    }
    assert.equal(mathModule.evaluateUnityCurve(curve, 0), 0)
    assert.equal(mathModule.evaluateUnityCurve(curve, 0.5), 0.5)
    assert.equal(mathModule.evaluateUnityCurve(curve, 1), 1)
    assert.deepEqual(
        mathModule.clampVectorLength({ x: 3, y: 4, z: 0 }, 2),
        { x: 1.2000000000000002, y: 1.6, z: 0 },
    )
    const sphere = mathModule.projectOutsideSphere(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        0.5,
    )
    assert.equal(sphere.contacted, true)
    assert.equal(Math.hypot(sphere.point.x, sphere.point.y, sphere.point.z), 0.5)
    const capsule = mathModule.projectOutsideTaperedCapsule(
        { x: 0.1, y: 0, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
        0.3,
        0.1,
    )
    assert.equal(capsule.contacted, true)
    assert.ok(Object.values(capsule.point).every(Number.isFinite))
    const plane = mathModule.projectAbovePlane(
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        0.1,
    )
    assert.deepEqual(plane, { point: { x: 0, y: 0.10000000000000009, z: 0 }, contacted: true })
})

test('MagicaWindZone consumes all four modes, priority, additive cap, and dynamic action keys', () => {
    const source = profile(100102)
    const authority = source.components.windZones[0]
    assert.ok(authority)
    const constantCurve = {
        m_Curve: [
            { time: 0, value: 1, inSlope: 0, outSlope: 0, weightedMode: 0, inWeight: 0, outWeight: 0 },
            { time: 1, value: 1, inSlope: 0, outSlope: 0, weightedMode: 0, inWeight: 0, outWeight: 0 },
        ],
        m_PreInfinity: 2,
        m_PostInfinity: 2,
        m_RotationOrder: 4,
    }
    const makeZone = (mode, index, addition = 0) => ({
        ...structuredClone(authority),
        stableKey: `${authority.stableKey}|fixture=${index}`,
        binding: {
            ...structuredClone(authority.binding),
            stableKey: `${authority.binding.stableKey}|fixture=${index}`,
        },
        settings: {
            ...structuredClone(authority.settings),
            mode,
            size: { x: 2, y: 2, z: 2 },
            radius: 1,
            main: 2,
            turbulence: 0,
            attenuation: constantCurve,
            isAddition: addition,
        },
    })
    for (const mode of [0, 1, 2, 3]) {
        const zone = makeZone(mode, mode)
        const object = new THREE.Group()
        object.updateMatrixWorld(true)
        const runtime = windModule.createMagicaWindRuntime(
            { ...source, components: { ...source.components, windZones: [zone] } },
            {
                byStableKey: new Map([[zone.stableKey, object]]),
                writableBones: new Set(),
                clothRoots: new Map(),
                missingBindings: [],
                duplicateBindings: [],
            },
        )
        const point = mode === 3 ? new THREE.Vector3(0.5, 0, 0) : new THREE.Vector3()
        const sample = runtime.sample(point, 0)
        assert.ok(sample.vector.length() > 0, `wind mode ${mode}`)
        if (mode === 3) assert.ok(sample.vector.dot(new THREE.Vector3(1, 0, 0)) > 0)
        if (mode === 1 || mode === 2 || mode === 3) {
            assert.equal(runtime.sample(new THREE.Vector3(5, 0, 0), 0).vector.length(), 0)
        }
    }

    const globalZone = makeZone(0, 10)
    const sphereZone = makeZone(1, 11)
    sphereZone.settings.radius = 0.5
    const additions = [0, 1, 2, 3].map(index => makeZone(1, 20 + index, 1))
    const zones = [globalZone, sphereZone, ...additions]
    const objects = new Map(zones.map(zone => [zone.stableKey, new THREE.Group()]))
    const priorityRuntime = windModule.createMagicaWindRuntime(
        { ...source, components: { ...source.components, windZones: zones } },
        {
            byStableKey: objects,
            writableBones: new Set(),
            clothRoots: new Map(),
            missingBindings: [],
            duplicateBindings: [],
        },
    )
    const priority = priorityRuntime.sample(new THREE.Vector3(), 0)
    assert.equal(priority.baseStableKey, sphereZone.stableKey)
    assert.equal(priority.additiveStableKeys.length, 3)

    const registry = bindingModule.createExactPhysicsBindingRegistry()
    const dynamicZone = makeZone(0, 99)
    const dynamicRuntime = windModule.createMagicaWindRuntime(
        { ...source, components: { ...source.components, windZones: [dynamicZone] } },
        {
            byStableKey: new Map(),
            writableBones: new Set(),
            clothRoots: new Map(),
            missingBindings: [],
            duplicateBindings: [],
        },
        registry,
    )
    assert.equal(dynamicRuntime.list()[0].runtimeReady, false)
    const release = registry.register(dynamicZone.binding.stableKey, new THREE.Group())
    assert.equal(dynamicRuntime.list()[0].runtimeReady, true)
    assert.ok(dynamicRuntime.sample(new THREE.Vector3(), 0).vector.length() > 0)
    assert.throws(
        () => registry.register(dynamicZone.binding.stableKey, new THREE.Group()),
        /external-binding-conflict/,
    )
    release()
    assert.equal(dynamicRuntime.list()[0].runtimeReady, false)
})

test('action-time exact bone registration refreshes cloth teams without a second writer', () => {
    const source = profile(100301)
    const authoredBust = source.components.cloth.find(cloth =>
        cloth.binding.hierarchyPath.endsWith('/BoneCloth_Bust'))
    assert.ok(authoredBust)
    const actionBust = structuredClone(authoredBust)
    actionBust.colliderReferences = []
    for (const binding of [
        actionBust.binding,
        ...actionBust.rootBoneBindings,
        ...actionBust.chainBindings,
    ]) {
        binding.hierarchyPath = `ActionTimeline/${binding.stableKey}`
        binding.modelRelativePath = null
        binding.visualRootRelativePath = null
    }
    const actionProfile = {
        ...structuredClone(source),
        stableKey: `${source.stableKey}|fixture=action-registration`,
        components: {
            cloth: [actionBust],
            colliders: [],
            windZones: [],
            otherMagica: [],
            native: [],
        },
    }
    const root = new THREE.Group()
    const centerNode = new THREE.Group()
    centerNode.name = actionBust.binding.stableKey
    root.add(centerNode)
    const nodes = new Map()
    const orderedBindings = [...actionBust.chainBindings].sort(
        (first, second) => first.hierarchyPath.split('/').length
            - second.hierarchyPath.split('/').length,
    )
    for (const binding of orderedBindings) {
        const node = new THREE.Bone()
        node.name = binding.stableKey
        nodes.set(binding.stableKey, node)
        const sourcePath = authoredBust.chainBindings.find(
            value => value.stableKey === binding.stableKey)?.modelRelativePath
        const parentBinding = authoredBust.chainBindings
            .filter(value => value.stableKey !== binding.stableKey)
            .filter(value => sourcePath?.startsWith(`${value.modelRelativePath}/`))
            .sort((first, second) =>
                (second.modelRelativePath?.length ?? 0) - (first.modelRelativePath?.length ?? 0))[0]
        const parent = parentBinding ? nodes.get(parentBinding.stableKey) : root
        assert.ok(parent)
        parent.add(node)
        node.position.set(0, 0.1, 0)
    }
    root.updateMatrixWorld(true)
    const registry = bindingModule.createExactPhysicsBindingRegistry()
    const runtime = runtimeModule.createNativeCharacterPhysics(root, actionProfile, {
        bindingRegistry: registry,
    })
    assert.equal(runtime.diagnostics.status, 'fail-closed')
    assert.equal(runtime.diagnostics.clothTeams, 0)
    const releases = [
        registry.register(actionBust.binding.stableKey, centerNode),
        ...actionBust.chainBindings.map(binding =>
            registry.register(binding.stableKey, nodes.get(binding.stableKey))),
    ]
    runtime.updateAfterAnimation(1 / 60)
    assert.equal(runtime.diagnostics.status, 'ready')
    assert.equal(runtime.diagnostics.clothTeams, 1)
    assert.equal(runtime.diagnostics.writableBones, 2)
    releases[0]()
    runtime.updateAfterAnimation(1 / 60)
    assert.equal(
        runtime.diagnostics.status,
        'fail-closed',
        JSON.stringify(runtime.diagnostics),
    )
    assert.equal(runtime.diagnostics.clothTeams, 0)
    for (const release of releases.slice(1)) release()
    runtime.dispose()
})

test('native CapsuleCollider, SphereCollider, and MeshCollider have exact query consumers', () => {
    const capsule = profile(100301).components.native.find(value =>
        value.type === 'CapsuleCollider')
    const sphere = profile(113501).components.native.find(value =>
        value.type === 'SphereCollider')
    const mesh = profile(100102).components.native.find(value =>
        value.type === 'MeshCollider')
    assert.ok(capsule)
    assert.ok(sphere)
    assert.ok(mesh)
    const capsuleObject = new THREE.Group()
    const sphereObject = new THREE.Group()
    sphereObject.position.set(3, 0, 0)
    const meshObject = new THREE.Group()
    meshObject.position.set(6, 0, 0)
    const root = new THREE.Group()
    root.add(capsuleObject, sphereObject, meshObject)
    root.updateMatrixWorld(true)
    const bindings = {
        byStableKey: new Map([
            [capsule.stableKey, capsuleObject],
            [sphere.stableKey, sphereObject],
            [mesh.stableKey, meshObject],
        ]),
        writableBones: new Set(),
        clothRoots: new Map(),
        missingBindings: [],
        duplicateBindings: [],
    }
    const fakeProfile = {
        components: { native: [capsule, sphere, mesh] },
    }
    const runtime = nativeColliderModule.createNativeCharacterColliderRuntime(
        fakeProfile,
        bindings,
    )
    assert.deepEqual(runtime.list().map(value => value.type).sort(), [
        'CapsuleCollider',
        'MeshCollider',
        'SphereCollider',
    ])
    assert.ok(runtime.list().every(value => value.runtimeReady))

    const capsuleCenterValue = capsule.serialized.m_Center
    const capsuleCenter = capsuleObject.localToWorld(new THREE.Vector3(
        -capsuleCenterValue.x,
        capsuleCenterValue.y,
        capsuleCenterValue.z,
    ))
    const capsuleProjection = runtime.projectSphere(
        capsuleCenter,
        0.05,
        { stableKeys: new Set([capsule.stableKey]) },
    )
    assert.equal(capsuleProjection.contacted, true)
    assert.ok(capsuleProjection.point.distanceTo(capsuleCenter) > 0)

    const sphereCenterValue = sphere.serialized.m_Center
    const sphereCenter = sphereObject.localToWorld(new THREE.Vector3(
        -sphereCenterValue.x,
        sphereCenterValue.y,
        sphereCenterValue.z,
    ))
    assert.equal(runtime.querySphere(
        sphereCenter,
        0.01,
        { stableKeys: new Set([sphere.stableKey]) },
    ).length, 1)

    const firstTriangleIndices = mesh.mesh.indices.slice(0, 3)
    const firstTriangle = firstTriangleIndices.map(index => {
        const value = mesh.mesh.vertices[index]
        return new THREE.Vector3(-value[0], value[1], value[2]).applyMatrix4(meshObject.matrixWorld)
    })
    const triangleCenter = firstTriangle[0].clone()
        .add(firstTriangle[1])
        .add(firstTriangle[2])
        .multiplyScalar(1 / 3)
    const meshContacts = runtime.querySphere(
        triangleCenter,
        0.02,
        { stableKeys: new Set([mesh.stableKey]) },
    )
    assert.equal(meshContacts.length, 1)
    assert.equal(meshContacts[0].type, 'MeshCollider')
    assert.ok(Number.isFinite(meshContacts[0].penetration))

    const registry = bindingModule.createExactPhysicsBindingRegistry()
    const dynamicRuntime = nativeColliderModule.createNativeCharacterColliderRuntime(
        fakeProfile,
        {
            ...bindings,
            byStableKey: new Map([
                [capsule.stableKey, capsuleObject],
                [sphere.stableKey, sphereObject],
            ]),
        },
        registry,
    )
    assert.equal(dynamicRuntime.list().find(value => value.type === 'MeshCollider').runtimeReady, false)
    registry.register(mesh.binding.stableKey, meshObject)
    assert.equal(dynamicRuntime.list().find(value => value.type === 'MeshCollider').runtimeReady, true)
})

test('runtime source is isolated from locomotion/timeline ownership and has one writer claim', () => {
    const files = [
        'actionOptions.ts',
        'binding.ts',
        'catalog.ts',
        'index.ts',
        'magicaWind.ts',
        'math.ts',
        'nativeColliders.ts',
        'runtime.ts',
        'types.ts',
    ]
    const source = files.map(file => readFileSync(
        join(repoRoot, 'src', 'viewer', 'characterPhysics', file),
        'utf8',
    )).join('\n')
    assert.doesNotMatch(source, /viewerLocomotion|characterLocomotion|characterTimeline/)
    assert.doesNotMatch(source, /getObjectByName|includes\([^)]*\.name|nameFallback:\s*true/)
    assert.doesNotMatch(source, /\b(?:100301|108601|100401|101901)\b/)
    assert.match(source, /WRITER_CLAIMS = new WeakMap/)
    assert.match(source, /single-post-animation-physics-writer/)
    assert.match(source, /locomotion and timeline ancestors remain read-only/i)
})

test('real 100301 FBX binds exact secondary bones and never writes arm locomotion bones', () => {
    const root = parseFbxGzip(join(
        repoRoot,
        'magia-exedra-character-three',
        'models',
        'chara_100301_battle_unit',
        'VisualRoot.fbx.gz',
    ))
    root.updateMatrixWorld(true)
    const value = profile(100301)
    const chest = requireExactBone(root, 'Root/Hip/Spine/Waist/Chest')
    const bust = requireExactBone(root, 'Root/Hip/Spine/Waist/Chest/Bust_L_01_Sp')
    const arm = requireExactBone(root, 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L')
    const forearm = requireExactBone(
        root,
        'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L',
    )
    const armPose = localPose(arm)
    const forearmPose = localPose(forearm)
    const bustBefore = bust.quaternion.clone()
    const runtime = runtimeModule.createNativeCharacterPhysics(root, value)
    assert.equal(runtime.diagnostics.status, 'ready')
    assert.equal(runtime.diagnostics.clothTeams, 7)
    assert.equal(runtime.diagnostics.boneSpringTeams, 0)
    const expectedWriters = value.components.cloth.reduce((count, cloth) =>
        count + cloth.chainBindings.filter(binding =>
            cloth.chainBindings.some(candidate =>
                candidate.hierarchyPath.startsWith(`${binding.hierarchyPath}/`),
            )).length,
    0)
    assert.equal(runtime.diagnostics.writableBones, expectedWriters)
    runtime.updateAfterAnimation(1 / 60)
    chest.position.x += 0.04
    root.updateMatrixWorld(true)
    for (let index = 0; index < 6; index += 1) runtime.updateAfterAnimation(1 / 60)
    assert.ok(bust.quaternion.angleTo(bustBefore) > 1e-5)
    assert.ok(bust.quaternion.angleTo(bustBefore) < THREE.MathUtils.degToRad(49.5))
    assertPoseEqual(arm, armPose, 'Arm_L must stay action-owned')
    assertPoseEqual(forearm, forearmPose, 'Forearm_L must stay action-owned')
    assert.ok(runtime.diagnostics.simulationSteps >= 7)
    assert.throws(
        () => runtimeModule.createNativeCharacterPhysics(root, value),
        /character-physics-writer-conflict/,
    )
    runtime.dispose()
    const replacement = runtimeModule.createNativeCharacterPhysics(root, value)
    replacement.dispose()
})

test('real 108601 BoneSpring keeps root translation within the authored limit', () => {
    const root = parseFbxGzip(join(
        repoRoot,
        'magia-exedra-character-three',
        'models',
        'chara_108601_battle_unit',
        'VisualRoot.fbx.gz',
    ))
    root.updateMatrixWorld(true)
    const value = profile(108601)
    const chest = requireExactBone(root, 'Root/Hip/Spine/Waist/Chest')
    const bust = requireExactBone(root, 'Root/Hip/Spine/Waist/Chest/Bust_L_01_Sp')
    const basePosition = bust.position.clone()
    const spring = value.components.cloth.find(cloth => cloth.serializeData.clothType === 10)
    assert.ok(spring)
    const runtime = runtimeModule.createNativeCharacterPhysics(root, value)
    assert.equal(runtime.diagnostics.boneSpringTeams, 1)
    runtime.updateAfterAnimation(1 / 60)
    chest.position.x += 0.06
    root.updateMatrixWorld(true)
    for (let index = 0; index < 8; index += 1) runtime.updateAfterAnimation(1 / 60)
    const displacement = bust.position.distanceTo(basePosition)
    assert.ok(displacement > 1e-5)
    assert.ok(displacement <= spring.serializeData.springConstraint.limitDistance + 1e-4)
    runtime.dispose()
})

test('real legacy 100102 FBX resolves omitted empty cloth centers through official identity candidates', () => {
    const catalog = json(join(publicRoot, 'manifest.v1.json'))
    const entry = catalog.entries.find(value => value.style3dCharacterMstId === 100106)
    assert.ok(entry)
    assert.equal(entry.characterResourceId, 100102)
    const modelProduct = resolvePublishedViewerModel(entry)
    assert.ok(modelProduct)
    const root = parseFbxGzip(modelProduct.path)
    root.updateMatrixWorld(true)
    const value = profile(100106)
    const bindingByStableKey = new Map(value.physicsTransformBindings.map(
        binding => [binding.stableKey, binding],
    ))
    assert.equal(value.components.cloth.length, 6)
    for (const cloth of value.components.cloth) {
        assert.equal(exactSuffixMatches(root, cloth.binding.visualRootRelativePath).length, 0)
        assert.equal(cloth.centerTransformBindingStableKeys.length, 4)
        assert.equal(cloth.centerTransformBindingStableKeys[0], cloth.binding.stableKey)
        assert.ok(cloth.centerTransformCandidates.length >= 5)
        assert.ok(cloth.centerTransformCandidates.some(candidate =>
            candidate.exactExportRelativePath === 'chara_100102'))
        for (const stableKey of cloth.centerTransformBindingStableKeys.slice(0, 2)) {
            const binding = bindingByStableKey.get(stableKey)
            assert.ok(binding)
            assert.deepEqual(binding.localTRS.localPosition, { x: 0, y: 0, z: 0 })
            assert.deepEqual(binding.localTRS.localScale, { x: 1, y: 1, z: 1 })
            assert.equal(Math.abs(binding.localTRS.localRotation.x), 0)
            assert.equal(Math.abs(binding.localTRS.localRotation.y), 0)
            assert.equal(Math.abs(binding.localTRS.localRotation.z), 0)
            assert.equal(Math.abs(binding.localTRS.localRotation.w), 1)
        }
    }
    const runtime = runtimeModule.createNativeCharacterPhysics(root, value)
    runtime.updateAfterAnimation(1 / 60)
    assert.equal(
        runtime.diagnostics.status,
        'ready',
        JSON.stringify(runtime.diagnostics.missingBindings),
    )
    assert.equal(runtime.diagnostics.clothTeams, 6)
    assert.deepEqual(
        runtime.diagnostics.missingBindings.filter(reason =>
            reason.includes('fail-closed-component')),
        [],
    )
    assert.equal(runtime.diagnostics.nonFiniteCorrections, 0)
    runtime.dispose()
})

test('all 94 published models bind through the exact runtime consumer', {
    skip: process.env.MAGIUS_CHARACTER_PHYSICS_FULL_MODEL_GATE !== '1',
}, () => {
    const catalog = json(join(publicRoot, 'manifest.v1.json'))
    const records = []
    const unpublished = []
    for (const entry of catalog.entries) {
        const modelProduct = resolvePublishedViewerModel(entry)
        if (modelProduct === null) {
            unpublished.push({
                style3dCharacterMstId: entry.style3dCharacterMstId,
                characterResourceId: entry.characterResourceId,
                resourceName: entry.resourceName,
                status: 'viewer-model-product-not-published',
            })
            continue
        }
        const root = parseFbxGzip(modelProduct.path)
        root.updateMatrixWorld(true)
        const value = profile(entry.style3dCharacterMstId)
        const runtime = runtimeModule.createNativeCharacterPhysics(root, value)
        runtime.updateAfterAnimation(1 / 60)
        const diagnostics = runtime.diagnostics
        const runtimeTeams = diagnostics.clothTeams + diagnostics.boneSpringTeams
        const componentFailures = diagnostics.missingBindings.filter(reason =>
            reason.includes('fail-closed-component'))
        records.push({
            style3dCharacterMstId: entry.style3dCharacterMstId,
            characterResourceId: entry.characterResourceId,
            resourceName: entry.resourceName,
            viewerModelDirectory: modelProduct.directory,
            authoredTeams: value.components.cloth.filter(
                cloth => cloth.runtimeBinding.status === 'runtime-ready',
            ).length,
            inactiveTeams: value.components.cloth.filter(
                cloth => cloth.runtimeBinding.status === 'inactive',
            ).length,
            failClosedTeams: value.components.cloth.filter(
                cloth => cloth.runtimeBinding.status === 'fail-closed',
            ).length,
            runtimeTeams,
            boneSpringTeams: diagnostics.boneSpringTeams,
            writableBones: diagnostics.writableBones,
            magicaColliders: diagnostics.magicaColliders,
            bodyColliders: diagnostics.bodyColliders,
            missingBindings: diagnostics.missingBindings,
            unexpectedMissingBindings: diagnostics.missingBindings.filter(
                reason => !reason.includes('fail-closed-component'),
            ),
            duplicateBindings: diagnostics.duplicateBindings,
            status: diagnostics.status,
            componentFailures,
            authoredMagicaColliders: value.components.colliders.filter(
                collider => Object.values(collider.activation).every(Boolean),
            ).length,
            nonFiniteCorrections: diagnostics.nonFiniteCorrections,
        })
        runtime.dispose()
        root.traverse(object => {
            if (object.geometry?.dispose) object.geometry.dispose()
            const materials = Array.isArray(object.material)
                ? object.material
                : object.material ? [object.material] : []
            for (const material of materials) material.dispose?.()
        })
        root.clear()
        globalThis.gc?.()
    }
    const summary = {
        schema: 'magius.character-physics-full-model-binding-verification.v1',
        catalogCharacters: catalog.entries.length,
        testedViewerModels: records.length,
        unpublishedViewerModels: unpublished.length,
        ready: records.filter(record => record.status === 'ready').length,
        noComponentFailures: records.filter(
            record => record.componentFailures.length === 0,
        ).length,
        totalRuntimeTeams: records.reduce((sum, record) => sum + record.runtimeTeams, 0),
        totalWritableBones: records.reduce((sum, record) => sum + record.writableBones, 0),
        records,
        unpublished,
    }
    mkdirSync(verificationRoot, { recursive: true })
    writeFileSync(
        join(verificationRoot, 'full-model-binding-summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
        'utf8',
    )
    assert.equal(summary.catalogCharacters, 94)
    assert.equal(summary.testedViewerModels, 92)
    assert.deepEqual(
        unpublished.map(record => record.characterResourceId).sort((a, b) => a - b),
        [113601, 114801],
    )
    const expectedComponentFailures = catalog.entries.flatMap(entry => {
        const value = profile(entry.style3dCharacterMstId)
        return value.components.cloth
            .filter(cloth => cloth.runtimeBinding.status === 'fail-closed')
            .map(cloth => ({
                characterResourceId: entry.characterResourceId,
                reason: `${cloth.stableKey}|fail-closed-component:`
                    + cloth.runtimeBinding.failClosedReasons.join(','),
            }))
    })
    const observedComponentFailures = records.flatMap(record =>
        record.componentFailures.map(reason => ({
            characterResourceId: record.characterResourceId,
            reason,
        })))
    assert.deepEqual(observedComponentFailures, expectedComponentFailures)
    assert.deepEqual(
        records.filter(record =>
            record.status !== 'ready'
            || record.runtimeTeams !== record.authoredTeams
            || record.magicaColliders !== record.authoredMagicaColliders
            || record.nonFiniteCorrections !== 0
            || record.unexpectedMissingBindings.length !== 0
            || record.duplicateBindings.length !== 0
        ),
        [],
    )
})

test('universal cloth chains stay finite and near authored rest distance for 100103 and 100101 profiles', () => {
    for (const characterId of [100103, 100101]) {
        const value = profile(characterId)
        const resourceName = value.source.sourceStableKey.split('/').at(-1)
        const root = parseFbxGzip(join(
            repoRoot,
            'magia-exedra-character-three',
            'models',
            resourceName,
            'VisualRoot.fbx.gz',
        ))
        root.updateMatrixWorld(true)
        const runtime = runtimeModule.createNativeCharacterPhysics(root, value)
        assert.equal(runtime.diagnostics.status, 'ready')
        const authoredLengths = []
        for (const cloth of value.components.cloth) {
            for (const binding of cloth.chainBindings) {
                const parentPath = binding.hierarchyPath.split('/').slice(0, -1).join('/')
                const parent = parentPath ? root.getObjectByName(parentPath.split('/').at(-1)) : null
                const child = root.getObjectByName(binding.hierarchyPath.split('/').at(-1))
                if (parent && child) authoredLengths.push(parent.getWorldPosition(new THREE.Vector3()).distanceTo(child.getWorldPosition(new THREE.Vector3())))
            }
        }
        for (let frame = 0; frame < 30; frame += 1) runtime.updateAfterAnimation(1 / 60)
        const diagnostics = runtime.diagnostics
        assert.equal(diagnostics.nonFiniteCorrections, 0)
        assert.ok(diagnostics.simulationSteps > 0)
        assert.ok(authoredLengths.every(length => Number.isFinite(length) && length >= 0))
        runtime.dispose()
        root.clear()
    }
})


