import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  evaluateHomeExpression,
  evaluateHomeExpressionCurve,
  parseHomeExpressionSchema2,
  resolveHomeExpression,
} from './magia-exedra-character-three/homeExpressionSchema2.ts'
import { adaptHomeExpressionSchema2 } from './magia-exedra-character-three/homeRuntime.ts'
import { CharacterExpressionController } from './magia-exedra-character-three/homeRuntime.ts'
import * as THREE from 'three'

const sourcePath = 'C:/Users/proje/Documents/Codex/2026-09-02/steam-exedra-runtime-capture-lab-20260902/outputs/20260905-101002-isolated-model-home-export-v1/candidate/home-expressions.json'
const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
source.schema = 'home-expression-schema2'

test('schema2 validates the exact 101002 expression authority and aliases', () => {
  const schema = parseHomeExpressionSchema2(source)
  assert.equal(schema.characterId, 101002)
  assert.equal(schema.styleId, 10100201)
  assert.equal(schema.morphTargetCount, 64)
  assert.equal(schema.expressionOrder.length, 15)
  assert.equal(Object.keys(schema.aliases).length, 16)
  assert.equal(schema.expressions.Annoyed.sourceStreamedCurveCount, 2)
  assert.equal(resolveHomeExpression(schema, 'HomeFace04_Annoyed')?.sourcePathId, schema.expressions.Annoyed.sourcePathId)
})

test('schema2 preserves cubic dt semantics and clamps the timeline', () => {
  const schema = parseHomeExpressionSchema2(source)
  const annoyed = schema.expressions.Annoyed
  const track = annoyed.curveTracks[0]
  assert.equal(evaluateHomeExpressionCurve(track, track.segments[0].time), 1)
  assert.ok(evaluateHomeExpressionCurve(track, 0.11) > 1)
  const start = evaluateHomeExpression(schema, 'HomeFace04_Annoyed', -1)
  const end = evaluateHomeExpression(schema, 'HomeFace04_Annoyed', 999)
  assert.equal(start['Bs.Mouth_Down_L'], 1)
  assert.equal(end['Bs.Mouth_Down_L'], 0.5)
  assert.equal(start['Bs.Eyebrows_Anger_L'], annoyed.constantWeights['Bs.Eyebrows_Anger_L'])
})

test('schema2 rejects malformed or incomplete expression authorities', () => {
  const malformed = structuredClone(source)
  delete malformed.expressions.Smile
  assert.throws(() => parseHomeExpressionSchema2(malformed), /missing expression Smile/)
  const invalidCurve = structuredClone(source)
  invalidCurve.expressions.Annoyed.curveTracks[0].segments[1].coeff = [1, 2]
  assert.throws(() => parseHomeExpressionSchema2(invalidCurve), /curve coefficients/)
})

test('schema2 adapter preserves streamed curves for the existing expression controller', () => {
  const schema = parseHomeExpressionSchema2(source)
  const runtime = adaptHomeExpressionSchema2(schema, { nodePaths: {} })
  assert.equal(runtime.schema, 2)
  assert.equal(runtime.characterId, 101002)
  assert.equal(runtime.expressions.Annoyed.curves?.['Bs.Mouth_Down_L']?.length, 4)
  assert.equal(runtime.expressions.Annoyed.curves?.['Bs.Mouth_Down_L']?.[3].coeff[3], 0.5)
  assert.deepEqual(runtime.expressions.Annoyed.weights, schema.expressions.Annoyed.constantWeights)
})

test('existing controller normalizes raw numeric schema2 at the loader boundary', () => {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
  mesh.morphTargetDictionary = { 'Bs.Mouth_Down_L': 0 }
  mesh.morphTargetInfluences = [0]
  const raw = structuredClone(source)
  raw.schema = 2
  const controller = new CharacterExpressionController([mesh], raw)
  assert.equal(controller.runtime.schema, 2)
  assert.equal(controller.runtime.characterId, 101002)
  assert.ok(controller.runtime.expressions.Annoyed.curves?.['Bs.Mouth_Down_L'])
  mesh.geometry.dispose()
  mesh.material.dispose()
})
