import 'three';
import type { Object3DEventMap } from 'three';

declare module 'three' {
    /**
     * Three's runtime onBeforeRender final argument is the BufferGeometry draw
     * group and contains materialIndex, while the current declaration resolves
     * it as Object3D Group. Expose the runtime field used for per-slot ReDrive
     * material uniforms.
     */
    interface Group<TEventMap extends Object3DEventMap = Object3DEventMap> {
        materialIndex?: number;
    }
}
