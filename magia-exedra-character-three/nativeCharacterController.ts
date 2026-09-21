import * as THREE from 'three';
import { unityDirectionToThreeFbx, type AngelRingReference, type ReDriveAxis } from './renderProfile';
import type { NativeMaterialPacket, NativeMeshBinding } from './nativeMaterialScope';

type SerializedPPtr = { m_FileID: number; m_PathID: string };
interface ControllerRecord {
    cab: string; pathId: string;
    scriptType: { m_AssemblyName: string; m_Namespace: string; m_ClassName: string };
    tree: Record<string, unknown> & {
        m_Enabled: number; IsCharacter: number;
        reDriveToonRenderers: SerializedPPtr[];
        characterMaterialController: SerializedPPtr;
        headBoneTransform: SerializedPPtr;
        headOffset: number; faceForwardDirection: number; faceUpDirection: number;
        CharacterCancelPerspective: number;
    };
    [key: string]: unknown;
}
/** Raw records stay in their native identity scope, including attachment
 * controllers and fields not consumed by AngelRing. Direction conversion is
 * the existing Unity-to-sealed-FBX convention, not an imported global preset. */
export interface NativeControllerBindings {
    schema: 'magius.native-controller-bindings.v1';
    coordinateMapping: 'unity-x-reflected-fbx';
    controllers: ControllerRecord[];
    transforms: { cab: string; pathId: string; path: string; [key: string]: unknown }[];
    [key: string]: unknown;
}
export interface NativeAngelRingBinding {
    reference?: AngelRingReference;
    diagnostic: {
        status: 'BOUND' | 'BLANK'; reason?: string;
        rendererKey?: string; controllerKey?: string; headTransformKey?: string; headPath?: string;
    };
}
const directionAxes: readonly ReDriveAxis[] = ['x', 'y', 'z', '-x', '-y', '-z'];
const localPointer = (p: SerializedPPtr | undefined) => p?.m_FileID === 0 && typeof p.m_PathID === 'string' && p.m_PathID !== '0';

/** Resolve only a unique serialized renderer owner and its exact Head PPtr.
 * Missing carrier, external PPtr, or ambiguous hierarchy remains BLANK. */
export function resolveNativeAngelRingReference(
    root: THREE.Object3D, packet: NativeMaterialPacket, mesh: NativeMeshBinding,
): NativeAngelRingBinding {
    const blank = (reason: string): NativeAngelRingBinding => ({ diagnostic: { status: 'BLANK', reason } });
    const carrier = packet.controllerBindings;
    if (!carrier) return blank('native controller carrier absent');
    if (carrier.schema !== 'magius.native-controller-bindings.v1' || carrier.coordinateMapping !== 'unity-x-reflected-fbx') return blank('native controller schema/coordinate mapping missing');
    const controllers = carrier.controllers.filter(row =>
        row.scriptType?.m_ClassName === 'ReDriveToonMaterialController'
        && row.scriptType.m_Namespace === 'ReDrive.Creative.ReDriveToon'
        && row.scriptType.m_AssemblyName === 'Assembly-CSharp');
    const owners = controllers.filter(row => row.cab === mesh.sourceCab
        && row.tree.m_Enabled === 1
        && row.tree.reDriveToonRenderers.some(p => localPointer(p) && p.m_PathID === mesh.rendererPathId));
    if (owners.length !== 1) return blank('exact renderer controller missing/ambiguous');
    let controller = owners[0];
    const seen = new Set<string>();
    while (controller.tree.IsCharacter !== 1) {
        const key = `${controller.cab}:${controller.pathId}`;
        if (seen.has(key)) return blank('controller parent cycle');
        seen.add(key);
        const parent = controller.tree.characterMaterialController;
        if (!localPointer(parent)) return blank('character controller parent PPtr missing/external');
        const parents = controllers.filter(row => row.cab === controller.cab && row.pathId === parent.m_PathID && row.tree.m_Enabled === 1);
        if (parents.length !== 1) return blank('character controller parent missing/ambiguous');
        controller = parents[0];
    }
    const tree = controller.tree, pointer = tree.headBoneTransform;
    if (!localPointer(pointer)) return blank('Head Transform PPtr missing/external');
    const transforms = carrier.transforms.filter(row => row.cab === controller.cab && row.pathId === pointer.m_PathID);
    if (transforms.length !== 1 || !transforms[0].path) return blank('exact Head Transform path missing/ambiguous');
    const headPath = transforms[0].path;
    const nodes: THREE.Object3D[] = [];
    root.traverse(node => {
        const parts: string[] = [];
        for (let cursor: THREE.Object3D | null = node; cursor; cursor = cursor.parent) {
            if (cursor.name) parts.push(cursor.name);
            if (cursor === root) break;
        }
        if (parts.reverse().join('/') === headPath) nodes.push(node);
    });
    if (nodes.length !== 1) return blank('exact imported Head path missing/ambiguous');
    const axes = [tree.faceForwardDirection, tree.faceUpDirection];
    if (!axes.every(axis => Number.isInteger(axis) && axis >= 0 && axis < directionAxes.length)
        || !Number.isFinite(tree.headOffset) || !Number.isFinite(tree.CharacterCancelPerspective)) return blank('serialized Head direction/offset/perspective field BLANK');
    return {
        reference: {
            headBone: nodes[0],
            localForward: unityDirectionToThreeFbx(directionAxes[tree.faceForwardDirection]),
            localUp: unityDirectionToThreeFbx(directionAxes[tree.faceUpDirection]),
            headOffset: tree.headOffset,
            characterCancelPerspective: tree.CharacterCancelPerspective,
        },
        diagnostic: {
            status: 'BOUND', rendererKey: `${mesh.sourceCab}:${mesh.rendererPathId}`,
            controllerKey: `${controller.cab}:${controller.pathId}`,
            headTransformKey: `${controller.cab}:${pointer.m_PathID}`, headPath,
        },
    };
}
