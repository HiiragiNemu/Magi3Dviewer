import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const script = join(root, 'scripts', 'build-official-stage-audit.py')
const raw = join(
  root,
  'artifacts',
  'research',
  '20260817-stage600-01-00-001-truth',
  'raw-truth.json',
)
const shader = join(
  root,
  'research',
  'official-stage-audits',
  'battle-600-01-00-001-bguber-lightmap.json',
)

function run(rawPath, outJson, outMarkdown) {
  return spawnSync(
    'python',
    [
      script,
      '--raw',
      rawPath,
      '--shader-evidence',
      shader,
      '--out-json',
      outJson,
      '--out-md',
      outMarkdown,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  )
}

test('builds a deterministic fail-closed audit for JP battle 600-01-00-001', () => {
  const temp = mkdtempSync(join(tmpdir(), 'stage600-audit-'))
  try {
    const firstJson = join(temp, 'first.json')
    const firstMarkdown = join(temp, 'first.md')
    const secondJson = join(temp, 'second.json')
    const secondMarkdown = join(temp, 'second.md')

    const first = run(raw, firstJson, firstMarkdown)
    assert.equal(first.status, 0, first.stderr)
    const status = JSON.parse(first.stdout)
    assert.equal(status.stageId, 'battle-600-01-00-001')
    assert.equal(status.state, 'evidence-complete-runtime-blocked')
    assert.equal(status.deploymentSafe, false)
    assert.equal(status.blockerCount, 4)

    const audit = JSON.parse(readFileSync(firstJson, 'utf8'))
    assert.equal(audit.releaseProfile, 'jp-android-3.13.0')
    assert.equal(audit.unityVersion, '2022.3.62f2')
    assert.equal(audit.hierarchy.objects, 2071)
    assert.equal(audit.materials.materialCount, 14)
    assert.equal(audit.materials.rendererCount, 353)
    assert.equal(audit.uv1AndLightmaps.validSourceMeshCount, 258)
    assert.equal(audit.uv1AndLightmaps.lightmappedUniqueMeshCount, 225)
    assert.equal(audit.uv1AndLightmaps.sourceUv1MeshCount, 0)
    assert.equal(audit.uv1AndLightmaps.rendererBindingCount, 319)
    assert.equal(audit.uv1AndLightmaps.lightmapCount, 1)
    assert.equal(audit.uv1AndLightmaps.directionalLightmapCount, 0)
    assert.equal(audit.uv1AndLightmaps.shadowMaskCount, 0)
    assert.equal(audit.uv1AndLightmaps.prefabLightmapData.rendererInfoCount, 319)
    assert.equal(audit.uv1AndLightmaps.prefabLightmapData.containsUvCarrierField, false)
    assert.equal(
      audit.uv1AndLightmaps.compiledShaderEvidence.lightmapUvFormula,
      'UV1 * unity_LightmapST.xy + unity_LightmapST.zw',
    )
    assert.equal(audit.dynamicComponents.animators.length, 3)
    assert.equal(audit.dynamicComponents.controllers.length, 2)
    assert.deepEqual(audit.dynamicComponents.controllers[0].clipPathIds, [
      '6556947399969015217',
    ])
    assert.equal(audit.dynamicComponents.clips.length, 2)
    assert.equal(audit.dynamicComponents.clips[0].streamed.keyCount, 12)
    assert.equal(audit.dynamicComponents.clips[1].streamed.keyCount, 1644)
    assert.ok(statSync(firstJson).size < 2_000_000)

    const second = run(raw, secondJson, secondMarkdown)
    assert.equal(second.status, 0, second.stderr)
    assert.deepEqual(readFileSync(secondJson), readFileSync(firstJson))
    assert.deepEqual(readFileSync(secondMarkdown), readFileSync(firstMarkdown))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fails closed when the raw stage identity changes', () => {
  const temp = mkdtempSync(join(tmpdir(), 'stage600-audit-invalid-'))
  try {
    const changed = JSON.parse(readFileSync(raw, 'utf8'))
    changed.stageId = 'battle-600-01-00-999'
    const changedRaw = join(temp, 'changed.json')
    writeFileSync(changedRaw, `${JSON.stringify(changed)}\n`, 'utf8')
    const result = run(changedRaw, join(temp, 'out.json'), join(temp, 'out.md'))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unexpected stageId/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
