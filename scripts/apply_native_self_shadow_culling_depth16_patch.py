#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'magia-exedra-character-three' / 'scene' / 'selfShadow.ts'
TEST = ROOT / 'nativeSelfShadow.test.mjs'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def patch_source() -> None:
    text = SOURCE.read_text(encoding='utf-8')
    text = replace_once(
        text,
        """        const depthTexture = new THREE.DepthTexture(\n            resolution,\n            resolution,\n            THREE.UnsignedIntType,\n        )\n""",
        """        const depthTexture = new THREE.DepthTexture(\n            resolution,\n            resolution,\n            // Native OnCameraSetup allocates the self-shadow RT with a\n            // 16-bit shadow depth format. Keep the Web target at the same\n            // precision instead of silently upgrading to 32-bit.\n            THREE.UnsignedShortType,\n        )\n""",
        'depth texture format',
    )
    text = replace_once(
        text,
        """    private readonly pelvis = new THREE.Vector3()\n    private readonly shadowPelvis = new THREE.Vector3()\n    private readonly rootPosition = new THREE.Vector3()\n""",
        """    private readonly pelvis = new THREE.Vector3()\n    private readonly shadowPelvis = new THREE.Vector3()\n    private readonly rootPosition = new THREE.Vector3()\n    private readonly cameraViewProjection = new THREE.Matrix4()\n    private readonly cameraFrustum = new THREE.Frustum()\n    private readonly casterBounds = new THREE.Box3()\n    private readonly casterHalfExtents = new THREE.Vector3(\n        officialReDriveSelfShadowSettings.charaBoundSize[0]\n            * officialReDriveSelfShadowSettings.boundSize * 0.5,\n        officialReDriveSelfShadowSettings.charaBoundSize[1]\n            * officialReDriveSelfShadowSettings.boundSize * 0.5,\n        officialReDriveSelfShadowSettings.charaBoundSize[2]\n            * officialReDriveSelfShadowSettings.boundSize * 0.5,\n    )\n""",
        'frustum members',
    )
    text = replace_once(
        text,
        """        this.scene.camera.updateMatrixWorld(true)\n        if (officialReDriveSelfShadowSettings.useMainLightAsCastShadowDirection) {\n""",
        """        this.scene.camera.updateMatrixWorld(true)\n        // Native RenderCharacterSelfShadowmapRT calculates the main camera\n        // frustum first, then calls GeometryUtility.TestPlanesAABB for a\n        // pelvis-centred Bounds whose size is charaBoundSize * boundSize.\n        this.cameraViewProjection.multiplyMatrices(\n            this.scene.camera.projectionMatrix,\n            this.scene.camera.matrixWorldInverse,\n        )\n        this.cameraFrustum.setFromProjectionMatrix(\n            this.cameraViewProjection,\n            THREE.WebGLCoordinateSystem,\n        )\n        if (officialReDriveSelfShadowSettings.useMainLightAsCastShadowDirection) {\n""",
        'camera frustum setup',
    )
    text = replace_once(
        text,
        """        let count = 0\n        let left = Infinity\n""",
        """        let count = 0\n        let frustumRejected = 0\n        let rangeRejected = 0\n        let left = Infinity\n""",
        'culling counters',
    )
    text = replace_once(
        text,
        """            this.getPelvisWorldPosition(root, this.pelvis)\n            this.shadowPelvis.copy(this.pelvis).applyMatrix4(this.boundsView)\n            if (this.shadowPelvis.z - bound > range) continue\n            count++\n""",
        """            this.getPelvisWorldPosition(root, this.pelvis)\n            this.casterBounds.setFromCenterAndSize(\n                this.pelvis,\n                this.casterHalfExtents.clone().multiplyScalar(2),\n            )\n            if (!this.cameraFrustum.intersectsBox(this.casterBounds)) {\n                frustumRejected++\n                continue\n            }\n            this.shadowPelvis.copy(this.pelvis).applyMatrix4(this.boundsView)\n            if (this.shadowPelvis.z - bound > range) {\n                rangeRejected++\n                continue\n            }\n            count++\n""",
        'native frustum AABB test',
    )
    # Avoid per-frame clone allocation from the first version above.
    text = text.replace(
        """            this.casterBounds.setFromCenterAndSize(\n                this.pelvis,\n                this.casterHalfExtents.clone().multiplyScalar(2),\n            )\n""",
        """            this.casterBounds.min.copy(this.pelvis).sub(this.casterHalfExtents)\n            this.casterBounds.max.copy(this.pelvis).add(this.casterHalfExtents)\n""",
        1,
    )
    text = replace_once(
        text,
        """        this.scene.scene.userData.reDriveSelfShadow = this.getDebugState()\n""",
        """        this.scene.scene.userData.reDriveSelfShadow = this.getDebugState({\n            acceptedCasters: count,\n            frustumRejected,\n            rangeRejected,\n        })\n""",
        'debug culling state',
    )
    text = replace_once(
        text,
        """    getDebugState() {\n        return {\n""",
        """    getDebugState(culling?: {\n        acceptedCasters: number\n        frustumRejected: number\n        rangeRejected: number\n    }) {\n        return {\n""",
        'debug signature',
    )
    text = replace_once(
        text,
        """            depthBiasEffective: reDriveSelfShadowUniformState.depthBias.value,\n            worldToClip: reDriveSelfShadowUniformState.worldToClip.value.toArray(),\n""",
        """            depthBiasEffective: reDriveSelfShadowUniformState.depthBias.value,\n            depthFormat: '16-bit',\n            nativeFrustumAabb: {\n                size: officialReDriveSelfShadowSettings.charaBoundSize,\n                ...(culling ?? {}),\n            },\n            worldToClip: reDriveSelfShadowUniformState.worldToClip.value.toArray(),\n""",
        'debug metadata',
    )
    SOURCE.write_text(text, encoding='utf-8')


def patch_test() -> None:
    text = TEST.read_text(encoding='utf-8')
    text = replace_once(
        text,
        """  assert.match(source, /charaBoundSize:\\s*\\[0\\.75, 1\\.5, 0\\.5\\]/)\n  assert.match(source, /RotateX\\(shadowAngle \\* Deg2Rad\\)/)\n""",
        """  assert.match(source, /charaBoundSize:\\s*\\[0\\.75, 1\\.5, 0\\.5\\]/)\n  assert.match(source, /THREE\\.UnsignedShortType/)\n  assert.match(source, /cameraFrustum\\.setFromProjectionMatrix/)\n  assert.match(source, /cameraFrustum\\.intersectsBox\\(this\\.casterBounds\\)/)\n  assert.match(source, /RotateX\\(shadowAngle \\* Deg2Rad\\)/)\n""",
        'test exact depth/culling',
    )
    TEST.write_text(text, encoding='utf-8')


def main() -> int:
    patch_source()
    patch_test()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
