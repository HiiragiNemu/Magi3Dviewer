import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const repo = path.dirname(fileURLToPath(import.meta.url))
const viewerSource = readFileSync(path.join(repo, 'src/viewer/index.ts'), 'utf8')
const controlsSource = readFileSync(path.join(repo, 'src/viewer/controls.ts'), 'utf8')
const sourceFile = ts.createSourceFile(
  'src/viewer/index.ts',
  viewerSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)

async function loadAbortConsumer() {
  const declaration = sourceFile.statements.find(statement => (
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'consumeExpectedCharacterSelectionAbort'
  ))
  assert.ok(declaration, 'missing selector-boundary AbortError consumer')
  const compiled = ts.transpileModule(
    `export ${declaration.getText(sourceFile)}`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('selector boundary consumes only expected AbortError rejections', async () => {
  const { consumeExpectedCharacterSelectionAbort } = await loadAbortConsumer()
  const completed = { id: '100107' }
  assert.equal(
    await consumeExpectedCharacterSelectionAbort(Promise.resolve(completed)),
    completed,
  )

  const domAbort = new DOMException('superseded selection', 'AbortError')
  assert.equal(
    await consumeExpectedCharacterSelectionAbort(Promise.reject(domAbort)),
    undefined,
  )

  const wrappedAbort = new Error('wrapped loader abort')
  wrappedAbort.name = 'AbortError'
  assert.equal(
    await consumeExpectedCharacterSelectionAbort(Promise.reject(wrappedAbort)),
    undefined,
  )

  const genuine = new Error('genuine character load failure')
  await assert.rejects(
    consumeExpectedCharacterSelectionAbort(Promise.reject(genuine)),
    error => error === genuine,
  )

  const forgedAbort = { name: 'AbortError' }
  await assert.rejects(
    consumeExpectedCharacterSelectionAbort(Promise.reject(forgedAbort)),
    error => error === forgedAbort,
  )
})

test('only the primary selector boundary filters supersession while load internals keep rejection semantics', () => {
  assert.match(
    viewerSource,
    /initSelector\(\s*characterSelector,\s*characterSelectDict,\s*changeCharacterFromSelector\s*\)/,
  )
  assert.match(
    viewerSource,
    /function changeCharacterFromSelector\(id: string\) \{\s*return consumeExpectedCharacterSelectionAbort\(changeCharacter\(id\)\)\s*\}/,
  )

  const changeStart = viewerSource.indexOf('async function changeCharacter(')
  const changeEnd = viewerSource.indexOf('\nfunction removeSelectedCharacter(', changeStart)
  assert.ok(changeStart >= 0 && changeEnd > changeStart)
  const changeBody = viewerSource.slice(changeStart, changeEnd)
  assert.doesNotMatch(changeBody, /AbortError|\.catch\(|try\s*\{/)

  const transactionStart = viewerSource.indexOf('async function addOrChangeCharacter(')
  const transactionEnd = viewerSource.indexOf('\nfunction syncExpressionControls(', transactionStart)
  assert.ok(transactionStart >= 0 && transactionEnd > transactionStart)
  const transactionBody = viewerSource.slice(transactionStart, transactionEnd)
  assert.match(transactionBody, /return scene\.switchCharacter\(/)
  assert.doesNotMatch(transactionBody, /AbortError|\.catch\(|try\s*\{/)

  const selectorStart = controlsSource.indexOf('export function initSelector(')
  const selectorEnd = controlsSource.indexOf('\n}\n', selectorStart) + 2
  assert.ok(selectorStart >= 0 && selectorEnd > selectorStart)
  const selectorBody = controlsSource.slice(selectorStart, selectorEnd)
  assert.match(selectorBody, /onchangeCallback\(\(e!\.target as HTMLSelectElement\)\.value\)/)
  assert.doesNotMatch(selectorBody, /await |\.catch\(|try\s*\{/)
})
