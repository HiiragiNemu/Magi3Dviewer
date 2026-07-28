import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

let installed = false;

/**
 * AssetStudio exports FBX texture references as `/texture.png`. Browsers resolve
 * that against the site root, while the matching PNG is stored beside the FBX in
 * `stages/official/<stage>/`. Patch only official-stage FBX parsing and rewrite
 * those root-relative references to the current stage directory.
 */
export function installOfficialStageTextureResolver() {
    if (installed) return;
    installed = true;

    const prototype = FBXLoader.prototype as FBXLoader & {
        parse: (content: ArrayBuffer | string, path: string) => THREE.Group;
    };
    const originalParse = prototype.parse;

    prototype.parse = function (
        this: FBXLoader,
        content: ArrayBuffer | string,
        path: string,
    ) {
        const isOfficialStage = typeof path === 'string' && /\/stages\/official\//i.test(path);
        if (!isOfficialStage) return originalParse.call(this, content, path);

        const manager = this.manager;
        const stageBase = new URL(path, document.baseURI);
        manager.setURLModifier(requestedUrl => {
            if (/^(data:|blob:)/i.test(requestedUrl)) return requestedUrl;
            const decoded = decodeURIComponent(requestedUrl).replace(/\\/g, '/');
            const fileName = decoded.split('/').filter(Boolean).at(-1);
            if (!fileName) return requestedUrl;
            return new URL(encodeURIComponent(fileName).replace(/%2F/gi, '/'), stageBase).href;
        });

        try {
            return originalParse.call(this, content, path);
        } finally {
            // TextureLoader asks the manager for the URL synchronously during
            // parse. Restore identity immediately so later character/profile
            // loads cannot inherit the previous stage directory.
            manager.setURLModifier(url => url);
        }
    };
}
