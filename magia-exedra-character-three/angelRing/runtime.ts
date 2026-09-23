import type * as THREE from 'three';
import type MagiaExedraCharacter3D from '../character';
import type { MagiaExedraScene3D } from '../scene';
import { createCharacterRingController } from './controller.mjs';
import type { CharacterRingController, CharacterRingCurve } from './controller.mjs';
import manifest from './manifest.json';

const curveUrls = import.meta.glob('./curves/*.json', {
    query: '?url', import: 'default', eager: true,
}) as Record<string, string>;
const pending = new WeakMap<MagiaExedraCharacter3D, Promise<void>>();

function hasProjectedCommonHair(character: MagiaExedraCharacter3D): boolean {
    let found = false;
    character.object.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        found ||= materials.some(material => {
            const ring = material?.userData?.officialMaterialProfile?.angelRing;
            return ring?.isHair && ring.enabled && !ring.uvMode && ring.map === 'common';
        });
    });
    return found;
}

function requireCurrent(character: MagiaExedraCharacter3D, signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason instanceof Error
        ? signal.reason : new DOMException('AngelRing character load aborted', 'AbortError');
    if (character.disposed) throw new DOMException('AngelRing character already disposed', 'AbortError');
}

/** Pre-commit scene-load stage. Failure releases the uncommitted character. */
export function attachCharacterAngelRing(
    scene: MagiaExedraScene3D,
    character: MagiaExedraCharacter3D,
    signal?: AbortSignal,
): Promise<void> {
    const previous = pending.get(character);
    if (previous) return previous;
    const task = attach(scene, character, signal);
    pending.set(character, task);
    void task.catch(() => pending.delete(character));
    return task;
}

async function attach(
    scene: MagiaExedraScene3D,
    character: MagiaExedraCharacter3D,
    signal?: AbortSignal,
): Promise<void> {
    const id = Number(character.userData.characterId);
    const state: { characterId: number; status: string; error?: string } = {
        characterId: id, status: 'LOADING_CURVE',
    };
    character.object.userData.angelRingCarrier = state;
    let controller: CharacterRingController | undefined;
    try {
        requireCurrent(character, signal);
        if (!hasProjectedCommonHair(character)) {
            state.status = 'NOT_APPLICABLE_ORIGINAL_MATERIALS';
            return;
        }
        const row = manifest.rows.find(entry => entry.characterId === id);
        const url = curveUrls[`./curves/${id}.json`];
        if (row?.status !== 'success' || !url) throw new Error(`ANGEL_RING_CURVE_NOT_CATALOGUED:${id}`);
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`ANGEL_RING_CURVE_HTTP:${id}:${response.status}:${url}`);
        const curve = await response.json() as CharacterRingCurve;
        requireCurrent(character, signal);
        if (curve.characterId !== id || curve.status !== 'success'
            || curve.curveSha256 !== row.curveSha256 || curve.inputSha256 !== row.inputSha256) {
            throw new Error(`ANGEL_RING_CURVE_CONTRACT:${id}`);
        }
        controller = createCharacterRingController(scene, character, curve, {
            onRemove: () => pending.delete(character),
        });
        controller.enable();
        const active = controller;
        character.object.userData.angelRingCarrier = {
            characterId: id,
            curveSha256: curve.curveSha256,
            inputSha256: curve.inputSha256,
            get status() { return active.statistics().status; },
            get error() { return active.statistics().error; },
            getStatus: () => active.statistics(),
        };
    } catch (error) {
        state.status = error instanceof Error && error.name === 'AbortError' ? 'ABORTED' : 'ERROR';
        state.error = String(error);
        controller?.remove();
        if (!character.disposed) character.dispose();
        // switchCharacter's existing loadingTask.fail surfaces this to the normal loading UI.
        throw error;
    }
}
