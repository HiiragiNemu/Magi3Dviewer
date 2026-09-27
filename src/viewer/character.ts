import MagiaExedraCharacterThree from "magia-exedra-character-three"
import type { LoadCharacterCallbacks } from 'magia-exedra-character-three/loader'
import { characterAssetLoadError, throwIfCharacterLoadAborted } from 'magia-exedra-character-three/utils'
import { getNonBattleCharacterRuntimeMetadata } from 'magia-exedra-character-three/nonBattleCharacterLoader'
import {
    attachViewerCharacterPhysics,
    findViewerCharacterPhysicsAttachment,
    getViewerCharacterPhysicsAttachment,
    listViewerCharacterPhysicsDebugState,
} from './characterPhysics'

class PhysicsEnabledCharacterManager extends MagiaExedraCharacterThree {
    override async loadCharacterById(
        id: number | string,
        callbacks?: Partial<LoadCharacterCallbacks>,
    ) {
        const signal = callbacks?.signal
        const character = await super.loadCharacterById(id, callbacks)
        const nonBattle = getNonBattleCharacterRuntimeMetadata(character)
        if (nonBattle && !nonBattle.physics) {
            if (typeof document !== 'undefined') {
                document.documentElement.dataset.magiusCharacterPhysicsProduction = JSON.stringify({
                    source: 'typed-nonbattle-character-loader',
                    characterResourceId: character.userData.characterId,
                    status: 'not-applicable',
                    stableKey: nonBattle.stableKey,
                    sourceFamily: nonBattle.sourceFamily,
                })
            }
            return character
        }
        const physicsUrl = `magius:character-physics/${character.userData.characterId}`
        try {
            throwIfCharacterLoadAborted(signal, 'physics-attach', physicsUrl)
            const attachment = await attachViewerCharacterPhysics(character)
            throwIfCharacterLoadAborted(signal, 'physics-attach', physicsUrl)
            if (
                nonBattle?.physics
                && (
                    attachment.status !== 'ready'
                    || attachment.diagnostics?.profileStableKey
                        !== nonBattle.physics.profileStableKey
                    || attachment.diagnostics.clothTeams
                        !== nonBattle.physics.expectedClothTeams
                    || attachment.diagnostics.magicaColliders
                        !== nonBattle.physics.expectedMagicaColliders
                    || (
                        nonBattle.physics.expectedNativeColliders !== undefined
                        && attachment.diagnostics.bodyColliders
                            !== nonBattle.physics.expectedNativeColliders
                    )
                )
            ) {
                throw new Error(
                    `Required nonbattle physics contract mismatch: ${nonBattle.stableKey}`,
                )
            }
            if (typeof document !== 'undefined') {
                document.documentElement.dataset.magiusCharacterPhysicsProduction = JSON.stringify({
                    source: 'production-character-loader',
                    ...(nonBattle ? {
                        source: 'typed-nonbattle-existing-character-physics',
                    } : {}),
                    characterResourceId: character.userData.characterId,
                    status: attachment.status,
                    stableKey: nonBattle?.stableKey,
                    sourceFamily: nonBattle?.sourceFamily,
                    failClosedReasons: attachment.failClosedReasons,
                    profileStableKey: attachment.diagnostics?.profileStableKey,
                    writableBones: attachment.diagnostics?.writableBones,
                    nonFiniteCorrections: attachment.diagnostics?.nonFiniteCorrections,
                })
            }
        } catch (error) {
            character.dispose()
            throw characterAssetLoadError('physics-attach', physicsUrl, error)
        }
        return character
    }
}

export const characters = new PhysicsEnabledCharacterManager(import.meta.glob([
    '../../node_modules/magia-exedra-character-three/models/**/*.fbx*',
    '../../node_modules/magia-exedra-character-three/models/**/redrive-baked-normals.bin*',
    '../../node_modules/magia-exedra-character-three/models/**/redrive-baked-normal.bin*',
    '../../node_modules/magia-exedra-character-three/models/**/runtime-material-channel.json*',
    '../../node_modules/magia-exedra-character-three/models/**/model-binding-contract.json*',
    '../../node_modules/magia-exedra-character-three/models/**/native-extra-channels.bin*',
    '../../node_modules/magia-exedra-character-three/models/**/*.corner-indices.bin*',
    '../../node_modules/magia-exedra-character-three/models/**/*.png',
    '../../node_modules/magia-exedra-character-three/models/**/home-*.json*',
    '../../node_modules/magia-exedra-character-three/nonbattle-models/**/*'
], { query: '?url', import: 'default', eager: true }))

Object.assign(window, {
    characters,
    magiusCharacterPhysics: {
        get: getViewerCharacterPhysicsAttachment,
        find: findViewerCharacterPhysicsAttachment,
        list: listViewerCharacterPhysicsDebugState,
    },
})
console.log('Imported character files:', characters.files)
