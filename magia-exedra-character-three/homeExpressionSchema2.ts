export type HomeExpressionCurveSegment = {
  time: number
  coeff: readonly [number, number, number, number]
}

export type HomeExpressionCurveTrack = {
  morphTarget: string
  serializedAttribute: number
  sourceCurveIndex: number
  segments: readonly HomeExpressionCurveSegment[]
}

export type HomeExpression = {
  sourcePathId: string
  duration: number
  constantWeights: Readonly<Record<string, number>>
  curveTracks: readonly HomeExpressionCurveTrack[]
  unresolvedAttributes: readonly string[]
  sourceBindingCount: number
  sourceStreamedCurveCount: number
  sourceConstantCount: number
}

export type HomeAuxiliaryClip = {
  sourcePathId: string
  duration: number
  constantWeights: Readonly<Record<string, number>>
  curveTracks: readonly HomeExpressionCurveTrack[]
  unresolvedAttributes: readonly unknown[]
  sourceBindingCount: number
  sourceStreamedCurveCount: number
  sourceConstantCount: number
}

export type HomeExpressionSchema2 = {
  schema: 'home-expression-schema2'
  characterId: number
  styleId: number
  morphTargetCount: number
  defaultExpression: string
  aliases: Readonly<Record<string, string>>
  expressionOrder: readonly string[]
  expressions: Readonly<Record<string, HomeExpression>>
  curveSemantics: string
  auxiliaryClips?: Readonly<Record<string, HomeAuxiliaryClip>>
  blinkControllerStates?: Readonly<Record<string, unknown>>
  mouthCurveTarget?: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`invalid home expression schema2: ${message}`)
}

function parseCurveSegment(value: unknown): HomeExpressionCurveSegment {
  assert(isRecord(value), 'curve segment must be an object')
  assert(finite(value.time), 'curve segment time must be finite')
  assert(Array.isArray(value.coeff) && value.coeff.length === 4 && value.coeff.every(finite), 'curve coefficients must be four finite numbers')
  return { time: value.time, coeff: value.coeff as [number, number, number, number] }
}

function parseExpression(name: string, value: unknown): HomeExpression {
  assert(isRecord(value), `expression ${name} must be an object`)
  assert(typeof value.sourcePathId === 'string', `${name}.sourcePathId`)
  assert(finite(value.duration) && value.duration >= 0, `${name}.duration`)
  assert(isRecord(value.constantWeights), `${name}.constantWeights`)
  const constantWeights: Record<string, number> = {}
  for (const [key, weight] of Object.entries(value.constantWeights)) {
    assert(finite(weight), `${name}.constantWeights.${key}`)
    constantWeights[key] = weight
  }
  assert(Array.isArray(value.curveTracks), `${name}.curveTracks`)
  const curveTracks = value.curveTracks.map((track, index) => {
    assert(isRecord(track), `${name}.curveTracks[${index}]`)
    assert(typeof track.morphTarget === 'string', `${name}.curveTracks[${index}].morphTarget`)
    const serializedAttribute = track.serializedAttribute
    const sourceCurveIndex = track.sourceCurveIndex
    assert(Number.isInteger(serializedAttribute), `${name}.curveTracks[${index}].serializedAttribute`)
    assert(Number.isInteger(sourceCurveIndex), `${name}.curveTracks[${index}].sourceCurveIndex`)
    assert(Array.isArray(track.segments) && track.segments.length > 0, `${name}.curveTracks[${index}].segments`)
    const segments = track.segments.map(parseCurveSegment)
    for (let i = 1; i < segments.length; i += 1) assert(segments[i].time >= segments[i - 1].time, `${name}.curveTracks[${index}] segments not ordered`)
    return { morphTarget: track.morphTarget, serializedAttribute: serializedAttribute as number, sourceCurveIndex: sourceCurveIndex as number, segments }
  })
  assert(Array.isArray(value.unresolvedAttributes) && value.unresolvedAttributes.every((entry) => typeof entry === 'string'), `${name}.unresolvedAttributes`)
  const sourceBindingCount = value.sourceBindingCount
  const sourceStreamedCurveCount = value.sourceStreamedCurveCount
  const sourceConstantCount = value.sourceConstantCount
  assert(Number.isInteger(sourceBindingCount) && Number.isInteger(sourceStreamedCurveCount) && Number.isInteger(sourceConstantCount), `${name}.source counts`)
  assert(sourceBindingCount === Object.keys(constantWeights).length + (sourceStreamedCurveCount as number), `${name}.source binding count`)
  assert(sourceConstantCount === Object.keys(constantWeights).length, `${name}.source constant count`)
  return { sourcePathId: value.sourcePathId, duration: value.duration, constantWeights, curveTracks, unresolvedAttributes: value.unresolvedAttributes, sourceBindingCount: sourceBindingCount as number, sourceStreamedCurveCount: sourceStreamedCurveCount as number, sourceConstantCount: sourceConstantCount as number }
}

export function parseHomeExpressionSchema2(value: unknown): HomeExpressionSchema2 {
  assert(isRecord(value), 'root must be an object')
  assert(value.schema === 'home-expression-schema2', 'schema')
  assert(Number.isInteger(value.characterId) && Number.isInteger(value.styleId), 'character/style id')
  const morphTargetCount = value.morphTargetCount
  assert(Number.isInteger(morphTargetCount) && (morphTargetCount as number) > 0, 'morphTargetCount')
  assert(typeof value.defaultExpression === 'string', 'defaultExpression')
  assert(isRecord(value.aliases) && Object.values(value.aliases).every((entry) => typeof entry === 'string'), 'aliases')
  const aliases: Record<string, string> = {}
  for (const [alias, target] of Object.entries(value.aliases)) aliases[alias] = target as string
  assert(Array.isArray(value.expressionOrder) && value.expressionOrder.every((entry) => typeof entry === 'string'), 'expressionOrder')
  assert(isRecord(value.expressions), 'expressions')
  const expressions: Record<string, HomeExpression> = {}
  for (const name of value.expressionOrder) {
    assert(value.expressions[name] !== undefined, `missing expression ${name}`)
    expressions[name] = parseExpression(name, value.expressions[name])
  }
  assert(Object.keys(expressions).length === value.expressionOrder.length, 'duplicate expression names')
  assert(expressions[value.defaultExpression] !== undefined, 'default expression missing')
  for (const [alias, target] of Object.entries(aliases)) assert(expressions[target] !== undefined, `alias ${alias} target`)
  assert(typeof value.curveSemantics === 'string' && value.curveSemantics.includes('cubic'), 'curveSemantics')
  const auxiliaryClips: Record<string, HomeAuxiliaryClip> = {}
  if (isRecord(value.auxiliaryClips)) {
    for (const [name, raw] of Object.entries(value.auxiliaryClips)) {
      assert(isRecord(raw), `auxiliary clip ${name}`)
      assert(typeof raw.sourcePathId === 'string' && finite(raw.duration), `auxiliary clip ${name} identity`)
      assert(Array.isArray(raw.curveTracks), `auxiliary clip ${name}.curveTracks`)
      const curveTracks = raw.curveTracks.map((track, index) => {
        assert(isRecord(track) && typeof track.morphTarget === 'string', `auxiliary clip ${name}.curveTracks[${index}]`)
        assert(Number.isInteger(track.serializedAttribute) && Number.isInteger(track.sourceCurveIndex), `auxiliary clip ${name}.curveTracks[${index}] identity`)
        assert(Array.isArray(track.segments) && track.segments.length > 0, `auxiliary clip ${name}.curveTracks[${index}].segments`)
        return { morphTarget: track.morphTarget, serializedAttribute: track.serializedAttribute as number, sourceCurveIndex: track.sourceCurveIndex as number, segments: track.segments.map(parseCurveSegment) }
      })
      assert(isRecord(raw.constantWeights) && Object.values(raw.constantWeights).every(finite), `auxiliary clip ${name}.constantWeights`)
      const constantWeights = raw.constantWeights as Record<string, number>
      const unresolvedAttributes = Array.isArray(raw.unresolvedAttributes) ? raw.unresolvedAttributes : []
      assert(Number.isInteger(raw.sourceBindingCount) && Number.isInteger(raw.sourceStreamedCurveCount) && Number.isInteger(raw.sourceConstantCount), `auxiliary clip ${name}.source counts`)
      auxiliaryClips[name] = { sourcePathId: raw.sourcePathId, duration: raw.duration as number, constantWeights: { ...constantWeights }, curveTracks, unresolvedAttributes, sourceBindingCount: raw.sourceBindingCount as number, sourceStreamedCurveCount: raw.sourceStreamedCurveCount as number, sourceConstantCount: raw.sourceConstantCount as number }
    }
  }
  return { schema: 'home-expression-schema2', characterId: value.characterId as number, styleId: value.styleId as number, morphTargetCount: morphTargetCount as number, defaultExpression: value.defaultExpression, aliases, expressionOrder: value.expressionOrder as string[], expressions, curveSemantics: value.curveSemantics, ...(Object.keys(auxiliaryClips).length ? { auxiliaryClips } : {}), ...(isRecord(value.blinkControllerStates) ? { blinkControllerStates: value.blinkControllerStates } : {}), ...(typeof value.mouthCurveTarget === 'string' ? { mouthCurveTarget: value.mouthCurveTarget } : {}) }
}

export function resolveHomeExpression(schema: HomeExpressionSchema2, aliasOrName: string): HomeExpression | undefined {
  const name = schema.aliases[aliasOrName] ?? aliasOrName
  return schema.expressions[name]
}

export function evaluateHomeExpressionCurve(track: HomeExpressionCurveTrack, time: number): number {
  const clampedTime = Math.max(0, time)
  let segment = track.segments[0]
  for (const candidate of track.segments) {
    if (candidate.time <= clampedTime) segment = candidate
    else break
  }
  const dt = clampedTime - segment.time
  const [a, b, c, d] = segment.coeff
  return (a * dt ** 3 + b * dt ** 2 + c * dt + d) / 100
}

export function evaluateHomeExpression(schema: HomeExpressionSchema2, aliasOrName: string, time: number): Record<string, number> {
  const expression = resolveHomeExpression(schema, aliasOrName)
  if (!expression) throw new Error(`unknown home expression: ${aliasOrName}`)
  const result = { ...expression.constantWeights }
  for (const track of expression.curveTracks) result[track.morphTarget] = evaluateHomeExpressionCurve(track, Math.min(Math.max(0, time), expression.duration))
  return result
}
