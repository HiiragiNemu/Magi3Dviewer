import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
const source = fs.readFileSync(new URL('./src/viewer/index.ts', import.meta.url), 'utf8')
test('direct pose weighted-mesh path is rotation-only', () => {
    assert.match(source, /let directPoseTransformMode: DirectPoseTransformMode = 'rotate'/)
    assert.match(source, /actionDirectTranslate\.disabled = true/)
    assert.doesNotMatch(source, /positionOffsets\.copy\([^\n]*\.add\(/)
    assert.doesNotMatch(source, /startPositionOffsets/)
    const pointer = source.slice(source.indexOf('canvas.addEventListener(\'pointermove\''), source.indexOf('const stopPointerDrag'))
    assert.doesNotMatch(pointer, /positionOffsets|directPoseScreenTranslationDelta/)
})
test('direct pose keeps root/IK translation boundary explicit', () => {
    assert.match(source, /Joint translation is unavailable; use Root placement or IK target/)
    assert.match(source, /request\.mode === 'joint' \? 'rotate' : 'translate'/)
})
