import type MagiaExedraCharacter3D from '../character';
import type { MagiaExedraScene3D } from '../scene';
export interface CharacterRingCurve {
    characterId: number;
    status: 'success';
    count: 1024;
    points: number[][];
    curveSha256: string;
    inputSha256: string;
}
export interface CharacterRingController {
    enable(): void;
    remove(): { characterId: number; status: string; conflicts: string[] };
    statistics(): { status: string; error: string | null; [key: string]: unknown };
}
export function createCharacterRingController(
    scene: MagiaExedraScene3D,
    character: MagiaExedraCharacter3D,
    curve: CharacterRingCurve,
    options?: { onRemove?: (character: MagiaExedraCharacter3D) => void },
): CharacterRingController;
