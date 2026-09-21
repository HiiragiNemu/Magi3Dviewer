import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const sourcePath = new URL('./src/viewer/viewerLocomotion.ts', import.meta.url)
const sourceText = fs.readFileSync(sourcePath, 'utf8')
const sourceFile = ts.createSourceFile(
    sourcePath.pathname,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
)

function namedFunction(name) {
    let match
    function visit(node) {
        if (
            ts.isFunctionDeclaration(node)
            && node.name?.text === name
        ) match = node
        if (!match) ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    assert.ok(match, `missing function ${name}`)
    return match
}

function callsNamed(root, name) {
    const matches = []
    function visit(node) {
        if (ts.isCallExpression(node)) {
            const expression = node.expression
            const calledName = ts.isIdentifier(expression)
                ? expression.text
                : ts.isPropertyAccessExpression(expression)
                    ? expression.name.text
                    : ''
            if (calledName === name) matches.push(node)
        }
        ts.forEachChild(node, visit)
    }
    visit(root)
    return matches
}

function nodeText(node) {
    return node.getText(sourceFile)
}

test('catalog action keeps one official preview playback and emits one matching cue after playback starts', () => {
    const trigger = namedFunction('triggerAction')
    const catalogBranch = trigger.body.statements.find(statement => (
        ts.isIfStatement(statement)
        && nodeText(statement.expression).includes('binding && catalogActionId')
    ))
    assert.ok(catalogBranch, 'missing catalogActionId branch')
    assert.equal(callsNamed(catalogBranch, 'playViewerCharacterAction').length, 1)
    assert.equal(callsNamed(catalogBranch, 'emitCatalogActionEffectCue').length, 0)
    assert.equal(callsNamed(catalogBranch, 'requestAction').length, 0)
    const play = namedFunction('playViewerCharacterAction')
    assert.equal(callsNamed(play, 'emitStartedViewerCharacterActionCue').length, 1)
    assert.equal(callsNamed(play, 'started').length, 4)
    const cue = namedFunction('emitStartedViewerCharacterActionCue')
    assert.equal(callsNamed(cue, 'requestAction').length, 0)
    assert.equal(callsNamed(cue, 'play').length, 0)
    assert.match(nodeText(cue), /characterActionPlayback.status !== 'playing'/)
    assert.equal(callsNamed(cue, 'nativeCombatActionCue').length, 1)
    assert.match(nodeText(cue), /entries\.filter\(entry => entry\.id === sourceId\)/)
    assert.match(nodeText(play), /let startCueEmitted = false/)
    assert.match(nodeText(play), /if \(!currentRequest\(\) \|\| startCueEmitted\) return/)

})

test('fallback controller path still requests the registered action exactly once', () => {
    const trigger = namedFunction('triggerAction')
    assert.equal(callsNamed(trigger, 'requestAction').length, 1)
    assert.match(nodeText(trigger), /binding\.controller\.requestAction\(`key:\$\{slot\.key\}`\)/)
})

test('catalog cue route is cue-only and dispatches through the existing transport once', () => {
    const startedCue = namedFunction('emitStartedViewerCharacterActionCue')
    assert.equal(callsNamed(startedCue, 'nativeCombatActionCue').length, 1)
    assert.equal(callsNamed(startedCue, 'emitViewerCombatEffectCue').length, 1)
    assert.equal(callsNamed(startedCue, 'requestAction').length, 0)
    assert.equal(callsNamed(startedCue, 'play').length, 0)
    assert.match(nodeText(startedCue), /binding\.catalogEffectCueSequence \+= 1/)
    assert.match(nodeText(startedCue), /actionTimeSeconds: native\.cue\.timeSeconds/)

    const transport = namedFunction('emitViewerCombatEffectCue')
    assert.equal(callsNamed(transport, 'emitViewerEvent').length, 1)
    assert.match(nodeText(transport), /emitViewerEvent\('magius:combat-effect-cue', cue\)/)
})

test('registered and catalog routes share the exact zero-time cue definition', () => {
    const cueFactory = namedFunction('registeredCombatEffectCue')
    const registration = namedFunction('registerAction')
    const startedCue = namedFunction('emitStartedViewerCharacterActionCue')
    const controllerFactory = namedFunction('createViewerLocomotionController')

    assert.match(nodeText(cueFactory), /id: `key:\$\{slot\.key\}:vfx-slot`/)
    assert.match(nodeText(cueFactory), /timeSeconds: 0/)
    assert.match(nodeText(cueFactory), /schema: 'magius-viewer-combat-vfx-slot-v1'/)
    assert.match(nodeText(cueFactory), /bundleKey: official\.bundleKey/)
    assert.match(nodeText(registration), /effectCues: \[registeredCombatEffectCue\(slot, official\)\]/)
    assert.equal(callsNamed(startedCue, 'nativeCombatActionCue').length, 1)
    assert.match(nodeText(startedCue), /native\.cue\.timeSeconds/)
    assert.match(nodeText(controllerFactory), /onEffectCue: emitViewerCombatEffectCue/)
})
