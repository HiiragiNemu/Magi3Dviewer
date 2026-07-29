import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const evidencePath = process.argv[2]
const outputPath = process.argv[3] ?? path.resolve(
    'magia-exedra-character-three/faceProfile.ts',
)

if (!evidencePath) {
    throw new Error(
        'Usage: node scripts/generate-jp-face-profiles.mjs '
        + '<jp-redrive-character-evidence.json> [faceProfile.ts]',
    )
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))

function scoreFaceMaterial(material) {
    const name = material.name.toLowerCase()
    const floats = material.savedProperties?.floats ?? {}
    let score = floats._UseFaceGradientMap === 1 ? 50 : 0
    if (/_face$/.test(name)) score += 100
    else if (/_face_[a-z0-9]+$/.test(name)) score += 80
    if (name.includes('eye') || name.includes('eyebrow') || name.includes('mask')) {
        score -= 100
    }
    return score
}

function number(value, fallback) {
    return Number.isFinite(value) ? value : fallback
}

const profiles = Object.values(evidence.characters)
    .filter(character => Number.isInteger(character.resourceCharacterId))
    .map(character => {
        const faceMaterials = character.materials
            .filter(material => material.savedProperties?.floats?._IsFace === 1)
            .sort((a, b) => scoreFaceMaterial(b) - scoreFaceMaterial(a))
        if (faceMaterials.length === 0) return undefined

        const floats = faceMaterials[0].savedProperties.floats
        const fields = [
            `characterId: ${character.resourceCharacterId}`,
            "source: 'official-export'",
            `useFaceGradientMap: ${floats._UseFaceGradientMap === 1}`,
            `faceShadowGradientMapYOffset: ${number(floats._FaceShadowGradientMapYOffset, 0)}`,
            `noseShadowGradientMapYOffset: ${number(floats._NoseShadowGradientMapYOffset, 0)}`,
            `cheekValue: ${number(floats._CheekValue, 1)}`,
            `shadowOffset: ${number(floats._ShadowOffset, 0.3)}`,
            `shadowFeather: ${number(floats._ShadowFeather, 0)}`,
            `faceAreaCameraDepthTextureZWriteOffset: ${number(floats._FaceAreaCameraDepthTextureZWriteOffset, 0.05)}`,
            `faceOutlineAdjust: ${number(floats._FaceOutlineAdjust, 3.3)}`,
        ]
        return {
            characterId: character.resourceCharacterId,
            line: `    [${character.resourceCharacterId}, { ${fields.join(', ')} }],`,
        }
    })
    .filter(Boolean)
    .sort((a, b) => a.characterId - b.characterId)

const source = fs.readFileSync(outputPath, 'utf8')
const begin = '    // BEGIN GENERATED JP FACE PROFILES'
const end = '    // END GENERATED JP FACE PROFILES'
const startIndex = source.indexOf(begin)
const endIndex = source.indexOf(end)

if (startIndex < 0 || endIndex < startIndex) {
    throw new Error(`Generated face profile markers are missing from ${outputPath}`)
}

const replacement = [
    begin,
    ...profiles.map(profile => profile.line),
    `    // ${profiles.length} resource-character profiles from ${path.basename(evidencePath)}.`,
    end,
].join('\n')

fs.writeFileSync(
    outputPath,
    source.slice(0, startIndex)
        + replacement
        + source.slice(endIndex + end.length),
)

console.log(`Wrote ${profiles.length} official face profiles to ${outputPath}`)
