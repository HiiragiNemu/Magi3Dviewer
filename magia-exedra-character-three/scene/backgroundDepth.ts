import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';

export interface BackgroundDepthConsumer {
    object: THREE.Object3D;
    depthTextureUniform: THREE.IUniform<THREE.Texture | null>;
    resolutionUniform: THREE.IUniform<THREE.Vector2>;
}

/**
 * Captures the official stage's opaque/depth-writing result before transparent
 * VLB geometry is drawn. Sampling the depth attachment of the framebuffer
 * currently being rendered would be a WebGL feedback loop, so this bounded
 * prepass owns an independent depth texture and is enabled only while a scene
 * declares a depth consumer.
 */
export class BackgroundDepthPass extends Pass {
    readonly renderTarget: THREE.WebGLRenderTarget;
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly consumers = new Set<BackgroundDepthConsumer>();
    private readonly resolution = new THREE.Vector2(1, 1);

    constructor(scene: THREE.Scene, camera: THREE.Camera) {
        super();
        this.scene = scene;
        this.camera = camera;
        const depthTexture = new THREE.DepthTexture(
            1,
            1,
            THREE.UnsignedIntType,
        );
        depthTexture.format = THREE.DepthFormat;
        depthTexture.minFilter = THREE.NearestFilter;
        depthTexture.magFilter = THREE.NearestFilter;
        depthTexture.name = 'ReDriveBackgroundDepth';
        this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
            depthBuffer: true,
            stencilBuffer: false,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        });
        this.renderTarget.texture.name = 'ReDriveBackgroundDepthDiscardedColor';
        this.renderTarget.depthTexture = depthTexture;
        this.needsSwap = false;
        this.enabled = false;
    }

    register(consumer: BackgroundDepthConsumer) {
        this.consumers.add(consumer);
        consumer.depthTextureUniform.value = this.renderTarget.depthTexture;
        consumer.resolutionUniform.value.copy(this.resolution);
        this.enabled = this.consumers.size > 0;
        return () => {
            this.consumers.delete(consumer);
            consumer.depthTextureUniform.value = null;
            this.enabled = this.consumers.size > 0;
        };
    }

    setSize(width: number, height: number) {
        const safeWidth = Math.max(1, Math.round(width));
        const safeHeight = Math.max(1, Math.round(height));
        this.resolution.set(safeWidth, safeHeight);
        this.renderTarget.setSize(safeWidth, safeHeight);
        for (const consumer of this.consumers) {
            consumer.resolutionUniform.value.copy(this.resolution);
        }
    }

    render(renderer: THREE.WebGLRenderer) {
        if (this.consumers.size === 0) return;

        const previousTarget = renderer.getRenderTarget();
        const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
        const previousShadowNeedsUpdate = renderer.shadowMap.needsUpdate;
        const previousAutoClear = renderer.autoClear;
        const visibility = [...this.consumers].map(consumer => ({
            object: consumer.object,
            visible: consumer.object.visible,
        }));
        try {
            for (const entry of visibility) entry.object.visible = false;
            // Only this depth target is consumed; normal colour rendering owns
            // light-shadow updates with the original caster materials restored.
            renderer.shadowMap.autoUpdate = false;
            renderer.shadowMap.needsUpdate = false;
            renderer.autoClear = true;
            renderer.setRenderTarget(this.renderTarget);
            renderer.clear(true, true, false);
            renderer.render(this.scene, this.camera);
        } finally {
            for (const entry of visibility) entry.object.visible = entry.visible;
            renderer.setRenderTarget(previousTarget);
            renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
            renderer.shadowMap.needsUpdate = previousShadowNeedsUpdate;
            renderer.autoClear = previousAutoClear;
        }
    }

    dispose() {
        this.renderTarget.depthTexture?.dispose();
        this.renderTarget.dispose();
        this.consumers.clear();
    }
}
