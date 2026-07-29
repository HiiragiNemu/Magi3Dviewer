import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const evidencePath = process.argv[2]
const outputPath = process.argv[3] ?? path.resolve(
    'magia-exedra-character-three/renderProfile.ts',
)

if (!evidencePath) {
    throw new Error(
        'Usage: node scripts/generate-jp-character-profiles.mjs '
        + '<jp-redrive-character-evidence.json> [renderProfile.ts]',
    )
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
const axisNames = new Map([
    [0, 'x'],
    [1, 'y'],
    [2, 'z'],
    [3, '-x'],
    [4, '-y'],
    [5, '-z'],
])

const quote = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
const bool = value => value ? 'true' : 'false'

const profiles = Object.values(evidence.characters)
    .filter(character => character.officialHeadProfile)
    .sort((a, b) => a.resourceCharacterId - b.resourceCharacterId)
    .map(character => {
        const head = character.officialHeadProfile
        const hairMaterials = character.materials.filter(
            material => material.savedProperties?.floats?._IsHair === 1,
        )
        const hairUvAngelRing = hairMaterials.some(
            material => material.savedProperties?.floats?._YuugenHighlight === 1,
        )
        const fields = [
            `characterId: ${character.resourceCharacterId}`,
            `styleId: ${character.style3dCharacterMstId}`,
            "source: 'official-export'",
            "headBoneName: 'Head'",
            `faceForwardAxis: ${quote(axisNames.get(head.faceForwardDirection))}`,
            `faceUpAxis: ${quote(axisNames.get(head.faceUpDirection))}`,
            `faceRightAxis: ${quote(axisNames.get(head.faceRightDirection))}`,
            `headOffset: ${head.headOffset}`,
            `angelRingEnabled: ${bool(character.readiness?.angelRing)}`,
            `hairUvAngelRing: ${bool(hairUvAngelRing)}`,
        ]
        return `    [${character.resourceCharacterId}, { ${fields.join(', ')} }],`
    })

const source = fs.readFileSync(outputPath, 'utf8')
const begin = '    // BEGIN GENERATED JP CHARACTER PROFILES'
const end = '    // END GENERATED JP CHARACTER PROFILES'
const startIndex = source.indexOf(begin)
const endIndex = source.indexOf(end)

if (startIndex < 0 || endIndex < startIndex) {
    throw new Error(`Generated profile markers are missing from ${outputPath}`)
}

const replacement = [
    begin,
    ...profiles,
    `    // ${profiles.length} resource-character profiles from ${path.basename(evidencePath)}.`,
    end,
].join('\n')

fs.writeFileSync(
    outputPath,
    source.slice(0, startIndex) + replacement + source.slice(endIndex + end.length),
)

console.log(`Wrote ${profiles.length} official profiles to ${outputPath}`)
