import * as THREE from 'three';
import type MagiaExedraCharacter3D from '../character';
import type { MagiaExedraScene3D } from '../scene';
import type { CharacterRingCurve } from './controller.mjs';
// Prepare outside the WebGL render stack, including synchronous captures and
// composer sub-samples. The private carrier scene never matches this gate.
type RenderOwner = { scene: MagiaExedraScene3D; prepare: (camera: THREE.Camera) => void };
type RenderBridge = { original: THREE.WebGLRenderer['render']; wrap: THREE.WebGLRenderer['render']; owners: Set<RenderOwner> };
const renderBridges = new WeakMap<THREE.WebGLRenderer, RenderBridge>();
export function addHeadSurfaceRenderOwner(scene: MagiaExedraScene3D, prepare: RenderOwner['prepare']) {
    const renderer = scene.renderer;
    let bridge = renderBridges.get(renderer);
    if (!bridge) {
        const original = renderer.render, owners = new Set<RenderOwner>();
        const wrap: THREE.WebGLRenderer['render'] = function(this: THREE.WebGLRenderer, world, camera) {
            for (const owner of owners) {
                if (world === owner.scene.scene && camera === owner.scene.camera) owner.prepare(camera);
            }
            return original.call(this, world, camera);
        };
        bridge = {original, wrap, owners};
        renderer.render = wrap;
        renderBridges.set(renderer, bridge);
    }
    const owner = {scene, prepare};
    bridge.owners.add(owner);
    const current = bridge;
    return () => {
        current.owners.delete(owner);
        if (current.owners.size) return [];
        if (renderer.render !== current.wrap) return ['renderer.render:ownership-changed'];
        renderer.render = current.original;
        renderBridges.delete(renderer);
        return [];
    };
}

// A closed, Head-attached receiver-independent carrier. Unlike the previous
// projected line, its dark top/bottom surfaces participate in depth testing.
// No hair normals or strand geometry enter the highlight coordinate field.
export const RING_METRES_TO_UV = 100 / (40 * .875);
const HALF_HEIGHT = .5 / RING_METRES_TO_UV;
const RESOLUTION = 1024;
const isTarget = (material: THREE.Material) => {
    const ring = material.userData?.officialMaterialProfile?.angelRing;
    return Boolean(ring?.enabled && ring.isHair && !ring.uvMode && ring.map === 'common');
};

export function createHeadSurfaceGeometry(curve: CharacterRingCurve): THREE.BufferGeometry {
    const points = curve.points.slice(0, curve.count);
    if (points.length < 3 || !points.every(p => p.length === 3 && p.every(Number.isFinite))) {
        throw new Error('INVALID_HEAD_SURFACE_CURVE');
    }
    const positions: number[] = [], cap: number[] = [], heights: number[] = [], indices: number[] = [];
    // Side and cap vertices are distinct: caps are exactly black, without
    // interpolating a diagonal bright wedge into the side surface.
    const layers = Array.from({length:9}, (_,i) => i/4-1);
    for (const [layerIndex, layer] of [...layers,-1,1].entries()) {
        for (const p of points) {
            positions.push(p[0], p[1] + layer * HALF_HEIGHT, p[2]);
            cap.push(layerIndex < layers.length ? 0 : 1);
            heights.push(layer * HALF_HEIGHT);
        }
    }
    const n = points.length;
    for (let layer=0; layer<layers.length-1; layer++) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, a=layer*n, b=a+n;
            indices.push(a+i,a+j,b+i,a+j,b+j,b+i);
        }
    }
    const triangles = THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(p[0], p[2])), []);
    for (const [a, b, c] of triangles) {
        const lo=layers.length*n,hi=lo+n;
        indices.push(lo+a,lo+b,lo+c,hi+c,hi+b,hi+a);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('ringCap', new THREE.Float32BufferAttribute(cap, 1));
    geometry.setAttribute('ringHeight', new THREE.Float32BufferAttribute(heights, 1));
    geometry.setIndex(indices);
    geometry.userData.sideVertexCount=layers.length*n;
    return geometry;
}

export const HEAD_SURFACE_VERTEX = /* glsl */`
    attribute float ringCap;
    attribute float ringHeight;
    varying vec3 vRingPoint;
    varying float vRingCap;
    varying float vRingHeight;
    uniform vec3 uRingFace;
    uniform vec3 uRingRight;
    uniform vec3 uRingUp;
    uniform vec3 uRingForward;
    uniform vec3 uRingScale;
    uniform vec3 uRingCancelFace;
    uniform float uRingCancel;
    uniform vec4 uRingCrop;
    void main() {
        vRingPoint = position;
        vRingCap = ringCap;
        vRingHeight = ringHeight;
        vec3 q = position * uRingScale;
        vec3 world = uRingFace + uRingRight*q.x + uRingUp*q.y + uRingForward*q.z;
        vec4 view = viewMatrix * vec4(world, 1.0);
        vec4 clip = projectionMatrix * view;
        // Same position-dependent perspective cancellation as character hair.
        float faceDepth = abs((viewMatrix * vec4(uRingCancelFace, 1.0)).z);
        float influence = max(1.0 - distance(world,uRingCancelFace)*2.25,0.0)
            * uRingCancel * clamp(world.y,0.0,1.0);
        if (projectionMatrix[2][3] == -1.0 && faceDepth > .000001) {
            clip.xy *= 1.0 + influence * (abs(clip.w)/faceDepth - 1.0);
        }
        clip.xy = (clip.xy - uRingCrop.xy * clip.w) / uRingCrop.zw;
        gl_Position = clip;
    }
`;

export const HEAD_SURFACE_FRAGMENT = /* glsl */`
    varying vec3 vRingPoint;
    varying float vRingCap;
    varying float vRingHeight;
    uniform sampler2D uRingMap;
    uniform vec2 uRingYaw;
    void main() {
        float horizontal = dot(vRingPoint.xz, vec2(uRingYaw.y,-uRingYaw.x));
        float back = -.5 * uRingYaw.y + .5;
        float u = horizontal * 2.857142857142857 + .5 + back*back*.75;
        // Only yaw enters U. V remains attached to the carrier in Head space.
        float v = vRingHeight * 2.857142857142857 + .5;
        float band = texture2D(uRingMap, vec2(u,v)).r;
        // No discard: even a zero-signal cap must occlude the far-side band.
        gl_FragColor = vec4(vec3(band * (1.0-step(.5,vRingCap))),1.0);
    }
`;

export function patchHeadSurfaceShader(shader: THREE.WebGLProgramParametersWithUniforms,
    uniforms: Record<string, THREE.IUniform>): () => void {
    const original = shader.fragmentShader;
    const start = original.indexOf('                    vec2 rdAngelFragmentUv =');
    const sample = original.indexOf('float rdAngelMap = texture2D(', start);
    const end = original.indexOf(';', sample) + 1;
    if (start < 0 || sample < start || end <= sample) throw new Error('HEAD_SURFACE_SHADER_CONTRACT');
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = /* glsl */`
        uniform sampler2D tHeadRingSurface;
        uniform vec4 uHeadRingCrop;
        uniform float uHeadRingReady;
        ${original.slice(0,start)}
        // Replace the old projected map, never add another band to it.
        vec2 headRingNdc = gl_FragCoord.xy / uAngelRingViewportSize * 2.0 - 1.0;
        vec2 headRingUv = (headRingNdc-uHeadRingCrop.xy)/uHeadRingCrop.zw*.5+.5;
        float headRingInside = step(0.0,headRingUv.x)*step(headRingUv.x,1.0)
            *step(0.0,headRingUv.y)*step(headRingUv.y,1.0);
        float rdAngelMap = texture2D(tHeadRingSurface,headRingUv).r*headRingInside*uHeadRingReady;
        ${original.slice(end)}
    `;
    return () => {
        shader.fragmentShader = original;
        for (const key of Object.keys(uniforms)) delete shader.uniforms[key];
    };
}

export function createCharacterRingController(scene: MagiaExedraScene3D,
    character: MagiaExedraCharacter3D, curve: CharacterRingCurve,
    {onRemove}: {onRemove?: (character: MagiaExedraCharacter3D) => void} = {}) {
    const materials = new Set<THREE.Material>();
    let head: THREE.Object3D | undefined;
    character.object.traverse(object => {
        if (object.name === 'Head' && !head) head = object;
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (isTarget(material)) materials.add(material);
        }
    });
    if (!head || !materials.size) throw new Error('HEAD_SURFACE_TARGET_MISSING');
    const initialScale = head.getWorldScale(new THREE.Vector3());
    const geometry = createHeadSurfaceGeometry(curve);
    const target = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    const crop = new THREE.Vector4(0,0,1,1);
    const uniforms = {
        tHeadRingSurface: {value: target.texture}, uHeadRingCrop: {value: crop},
        uHeadRingReady: {value: 0},
    };
    const carrierUniforms = {
        uRingFace: {value: new THREE.Vector3()}, uRingRight: {value: new THREE.Vector3()},
        uRingUp: {value: new THREE.Vector3()}, uRingForward: {value: new THREE.Vector3()},
        uRingScale: {value: new THREE.Vector3(1,1,1)},
        uRingCancelFace: {value: new THREE.Vector3()}, uRingCancel: {value: 0},
        uRingMap: {value: null as THREE.Texture | null},
        uRingYaw: {value: new THREE.Vector2(0,1)}, uRingCrop: {value: crop},
    };
    const material = new THREE.ShaderMaterial({
        uniforms: carrierUniforms, vertexShader: HEAD_SURFACE_VERTEX,
        fragmentShader: HEAD_SURFACE_FRAGMENT, side: THREE.DoubleSide,
        depthTest: true, depthWrite: true, blending: THREE.NoBlending, toneMapped: false,
    });
    const world = new THREE.Scene();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    world.add(mesh);
    const compiled = new Set<THREE.WebGLProgramParametersWithUniforms>();
    const localFace = new THREE.Vector3(), localCancel = new THREE.Vector3();
    const localUp = new THREE.Vector3(), localForward = new THREE.Vector3();
    const headPosition = new THREE.Vector3(), headQuaternion = new THREE.Quaternion();
    let referenceCaptured = false;
    const records: Array<{material: THREE.Material; compile: THREE.Material['onBeforeCompile'];
        key: THREE.Material['customProgramCacheKey']; wrap: THREE.Material['onBeforeCompile'];
        cache: THREE.Material['customProgramCacheKey']; undos: Array<() => void>}> = [];
    let enabled = false, removed = false, error: string | null = null, renders = 0;
    let renderMs = 0;
    for (const m of materials) {
        const compile = m.onBeforeCompile, key = m.customProgramCacheKey, undos: Array<() => void> = [];
        const wrap: THREE.Material['onBeforeCompile'] = function(this: THREE.Material, shader, renderer) {
            compile.call(this, shader, renderer);
            undos.push(patchHeadSurfaceShader(shader, uniforms));
            compiled.add(shader);
            // onBeforeCompile has just refreshed the original material reference.
            // Capture its Head-local definition, not its last frame world pose.
            if (!referenceCaptured) {
                head!.updateWorldMatrix(true,false);
                head!.getWorldPosition(headPosition);head!.getWorldQuaternion(headQuaternion);
                const inverse=headQuaternion.clone().invert(), u=shader.uniforms;
                localFace.copy(u.uAngelRingFacePosition.value);head!.worldToLocal(localFace);
                // Hair's perspective-cancel Face uses a fixed metric offset from Head,
                // not the scaled carrier anchor. Preserve that exact producer domain.
                localCancel.copy(u.uRdCharacterFacePositionWS.value).sub(headPosition).applyQuaternion(inverse);
                localUp.copy(u.uAngelRingFaceUp.value).applyQuaternion(inverse);
                localForward.copy(u.uAngelRingFaceForward.value).applyQuaternion(inverse);
                referenceCaptured=true;
            }
        };
        const cache = function(this: THREE.Material) {return key.call(this)+'|closed-head-surface-v4';};
        m.onBeforeCompile = wrap; m.customProgramCacheKey = cache; m.needsUpdate = true;
        records.push({material:m,compile,key,wrap,cache,undos});
    }
    const screen = new THREE.Vector2(), v = new THREE.Vector3(), clip = new THREE.Vector4();
    const cameraRight = new THREE.Vector3();
    const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), clear = new THREE.Color();
    let lastSignature: Array<number | string> | undefined;
    const render = (camera: THREE.Camera) => {
        if (!enabled || removed || camera !== scene.camera) return;
        const u = [...compiled][0]?.uniforms;
        if (!u?.uAngelRingFacePosition || !u.tAngelRingMap?.value) {uniforms.uHeadRingReady.value=0;return;}
        const t0 = performance.now();
        const cu = carrierUniforms;
        head!.updateWorldMatrix(true,false);
        head!.getWorldPosition(headPosition);head!.getWorldQuaternion(headQuaternion);
        cu.uRingFace.value.copy(localFace).applyMatrix4(head!.matrixWorld);
        cu.uRingUp.value.copy(localUp).applyQuaternion(headQuaternion).normalize();
        cu.uRingForward.value.copy(localForward).applyQuaternion(headQuaternion).normalize();
        cu.uRingRight.value.crossVectors(cu.uRingUp.value,cu.uRingForward.value).normalize();
        head!.getWorldScale(cu.uRingScale.value).divide(initialScale);
        cu.uRingCancelFace.value.copy(localCancel).applyQuaternion(headQuaternion).add(headPosition);
        cu.uRingCancel.value = u.uRdCharacterCancelPerspective.value * u.uRdGlobalCharacterCancelPerspective.value;
        cu.uRingMap.value = u.tAngelRingMap.value;
        camera.updateWorldMatrix(true,false);
        cameraRight.setFromMatrixColumn(camera.matrixWorld,0);
        // The camera right axis is unchanged by pitch about that axis, including
        // crossing either pole. Projecting camera-forward would flip yaw by pi.
        const yawX = -cameraRight.dot(cu.uRingForward.value), yawZ = cameraRight.dot(cu.uRingRight.value);
        // Exactly at the pole there is no new azimuth. Keep the last valid yaw.
        if (Math.hypot(yawX,yawZ) > 1e-6) cu.uRingYaw.value.set(yawX,yawZ).normalize();
        const depth = Math.abs(v.copy(cu.uRingCancelFace.value).applyMatrix4(camera.matrixWorldInverse).z);
        if (depth < 1e-6) {uniforms.uHeadRingReady.value=0;lastSignature=undefined;return;}
        const renderer = scene.renderer;
        renderer.getDrawingBufferSize(screen);
        const signature: Array<number | string> = [
            ...head!.matrixWorld.elements, ...camera.matrixWorld.elements,
            ...camera.projectionMatrix.elements, screen.x, screen.y,
            cu.uRingCancel.value, cu.uRingMap.value!.uuid, cu.uRingMap.value!.version,
        ];
        if (uniforms.uHeadRingReady.value && lastSignature?.length === signature.length
            && signature.every((value,i) => value === lastSignature![i])) return;
        uniforms.uHeadRingReady.value = 0;
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity, crossesEye=false;
        const position = geometry.getAttribute('position');
        // The caps repeat the same vertices. Include every side vertex, not
        // just the center line: support cannot spill outside the crop.
        for (let i=0;i<geometry.userData.sideVertexCount;i++) {
            v.fromBufferAttribute(position,i).multiply(cu.uRingScale.value);
            const x=v.x,y=v.y,z=v.z;
            v.copy(cu.uRingFace.value).addScaledVector(cu.uRingRight.value,x)
                .addScaledVector(cu.uRingUp.value,y).addScaledVector(cu.uRingForward.value,z);
            const influence = Math.max(1-v.distanceTo(cu.uRingCancelFace.value)*2.25,0)
                *cu.uRingCancel.value*THREE.MathUtils.clamp(v.y,0,1);
            clip.set(v.x,v.y,v.z,1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
            if (clip.w <= 1e-6) {crossesEye=true;continue;}
            const scale = camera.projectionMatrix.elements[11] === -1 ? 1+influence*(Math.abs(clip.w)/depth-1) : 1;
            const sx=clip.x/clip.w*scale,sy=clip.y/clip.w*scale;
            minX=Math.min(minX,sx);maxX=Math.max(maxX,sx);minY=Math.min(minY,sy);maxY=Math.max(maxY,sy);
        }
        if (crossesEye) {minX=minY=-1;maxX=maxY=1;}
        minX=Math.max(-1,minX-4/screen.x);maxX=Math.min(1,maxX+4/screen.x);
        minY=Math.max(-1,minY-4/screen.y);maxY=Math.min(1,maxY+4/screen.y);
        if (maxX<=minX || maxY<=minY) return;
        crop.set((minX+maxX)*.5,(minY+maxY)*.5,(maxX-minX)*.5,(maxY-minY)*.5);
        const oldTarget=renderer.getRenderTarget(), oldCube=renderer.getActiveCubeFace(), oldMip=renderer.getActiveMipmapLevel();
        const oldAlpha=renderer.getClearAlpha(), oldScissor=renderer.getScissorTest(), oldAuto=renderer.autoClear;
        const oldXr=renderer.xr.enabled, oldShadow=renderer.shadowMap.autoUpdate;
        renderer.getViewport(viewport);renderer.getScissor(scissor);renderer.getClearColor(clear);
        try {
            renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.autoClear=true;
            renderer.setRenderTarget(target); // RT viewport is physical pixels; do not apply canvas DPR twice.
            renderer.setClearColor(0,1); // target.scissorTest=false; preserve renderer global scissor state.
            renderer.render(world,camera);
            uniforms.uHeadRingReady.value=1;lastSignature=signature;renders++;error=null;
        } catch(e) {error=String(e);throw e;}
        finally {
            renderer.setRenderTarget(oldTarget,oldCube,oldMip);
            if (!oldTarget) {renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(oldScissor);}renderer.setClearColor(clear,oldAlpha);
            renderer.autoClear=oldAuto;renderer.xr.enabled=oldXr;renderer.shadowMap.autoUpdate=oldShadow;
            renderMs=performance.now()-t0;
        }
    };
    const detachRenderOwner = addHeadSurfaceRenderOwner(scene, render);
    const remove = () => {
        if (removed) return {characterId:curve.characterId,status:'ALREADY_REMOVED',conflicts:[]};
        removed=true;enabled=false;uniforms.uHeadRingReady.value=0;
        const conflicts: string[]=detachRenderOwner();
        for (const r of records) {
            if(r.material.onBeforeCompile===r.wrap)r.material.onBeforeCompile=r.compile;else conflicts.push(r.material.uuid);
            if(r.material.customProgramCacheKey===r.cache)r.material.customProgramCacheKey=r.key;else conflicts.push(r.material.uuid+':key');
            r.undos.forEach(f=>f());r.material.needsUpdate=true;
        }
        target.dispose();geometry.dispose();material.dispose();compiled.clear();
        const callbacks=character.userData.disposeCallbacks,index=callbacks.indexOf(remove);
        if(index>=0)callbacks.splice(index,1);
        onRemove?.(character);
        return {characterId:curve.characterId,status:'REMOVED',conflicts};
    };
    character.userData.disposeCallbacks.push(remove);
    return {enable(){
        if (removed) throw new Error('HEAD_SURFACE_REMOVED');
        // Compile only this actor, against the existing main scene lights. This
        // invokes the real material chain before its first visible draw.
        if (!compiled.size) scene.renderer.compile(character.object,scene.camera,scene.scene);
        enabled=true;
    },remove,statistics:()=>({
        status:removed?'REMOVED':error?'ERROR':enabled?'CLOSED_HEAD_SURFACE_V4':'DISABLED',error,
        renders,renderMs,carrierTriangles:geometry.index!.count/3,textureBytes:RESOLUTION*RESOLUTION*4,
        mapping:'head-attached finite closed surface; yaw only; closest surface including dark caps',
        humanAccepted:false,
    }), geometry, uniforms, carrierUniforms, render};
}
