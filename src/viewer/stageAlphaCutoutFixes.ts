import * as THREE from 'three'
import { scene } from './scene'

interface StageAlphaCutoutRule {
    stageId: string
    materialPattern: RegExp
    alphaTest: number
}

/**
 * AssetStudio's FBX material export does not retain Unity's alpha-clipping
 * keyword. The affected materials use RGBA `*Alpha_col` atlases on large
 * front/back tree cards. Rendering those cards with alphaTest=0 turns the
 * transparent atlas background into an opaque rectangle that can cover most
 * or all of the camera view.
 *
 * Keep this list deliberately narrow. Other stage textures may use the alpha
 * channel for smoothness or blend masks and must not be globally clipped.
 */
const OFFICIAL_STAGE_ALPHA_CUTOUT_RULES: StageAlphaCutoutRule[] = [
    {
        stageId: 'battle-600-00-01-001',
        materialPattern: /^mt_bg3d600A_01_01_propB(?:\.\d+)?$/,
        alphaTest: 0.5,
    },
    {
        stageId: 'battle-600-00-01-002',
        materialPattern: /^mt_bg3d600A_01_02_propA(?:\.\d+)?$/,
        alphaTest: 0.5,
    },
]

function forEachMaterial(
    object: THREE.Object3D,
    callback: (material: THREE.Material) => void,
) {
    object.traverse(candidate => {
        if (!(candidate instanceof THREE.Mesh)) return
        const materials = Array.isArray(candidate.material)
            ? candidate.material
            : [candidate.material]
        materials.forEach(callback)
    })
}

export function applyOfficialStageAlphaCutoutFixes() {
    const stageRoot = scene.backgroundScene.getObjectByName(
        'Magius3DviewerStageRoot',
    )
    if (!stageRoot) return 0

    const stageId = stageRoot.userData.stageDefinition?.id
    if (typeof stageId !== 'string') return 0

    const stageObject = stageRoot.getObjectByName(`Stage:${stageId}`)
    if (!stageObject) return 0

    const rules = OFFICIAL_STAGE_ALPHA_CUTOUT_RULES.filter(
        rule => rule.stageId === stageId,
    )
    if (rules.length === 0) return 0

    let changed = 0
    forEachMaterial(stageObject, material => {
        const rule = rules.find(candidate =>
            candidate.materialPattern.test(material.name),
        )
        if (!rule) return

        const alphaTest = Math.max(material.alphaTest, rule.alphaTest)
        const requiresUpdate =
            material.alphaTest !== alphaTest
            || material.alphaToCoverage !== true

        material.alphaTest = alphaTest
        material.alphaToCoverage = true
        // Unity cutout materials remain in the opaque render queue and write
        // depth only for fragments that survive the alpha test.
        material.transparent = false
        material.depthWrite = true

        if (requiresUpdate) {
            material.needsUpdate = true
            changed++
        }
    })

    stageObject.userData.stageAlphaCutoutFixes = {
        stageId,
        changed,
        rules: rules.map(rule => rule.materialPattern.source),
    }
    return changed
}

export function installOfficialStageAlphaCutoutFixes() {
    const selector = document.getElementById(
        'stage-selector',
    ) as HTMLSelectElement | null
    if (!selector) return () => undefined

    let scheduled = false
    const schedule = () => {
        if (scheduled || selector.disabled) return
        scheduled = true
        requestAnimationFrame(() => {
            scheduled = false
            applyOfficialStageAlphaCutoutFixes()
        })
    }

    const observer = new MutationObserver(schedule)
    observer.observe(selector, {
        attributes: true,
        attributeFilter: ['disabled'],
    })
    selector.addEventListener('change', schedule)
    schedule()

    return () => {
        observer.disconnect()
        selector.removeEventListener('change', schedule)
    }
}
