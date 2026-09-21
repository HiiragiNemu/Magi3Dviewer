import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
const source = fs.readFileSync('src/viewer/index.ts','utf8')
test('performance toggle mounts global workspace using existing editor and viewer', () => {
    assert.ok(source.includes("const workspace = document.getElementById('workspace')"))
    assert.ok(source.includes('workspace.append(panel)'))
    assert.match(source,/layout = mountPerformanceWorkspace\(\{\s*workspace, panel: performanceEditorController.panel, toggle/)
})
test('ordinary mode exits through runtime stop rather than a floating dock resize', () => {
    assert.match(source,/onExit: \(\) => performanceEditorController\?\.runtime.stop\(\)/)
    assert.doesNotMatch(source,/const dockModes =|panel.style.width = dock/)
})
test('layout restores nodes before editor disposal and removes its mount and toggle', () => {
    assert.match(source,/layout\?\.dispose\(\)\s*framing\?\.dispose\(\)\s*jointNodes\?\.dispose\(\)\s*performanceEditorController\?\.dispose\(\)/)
    assert.ok(source.includes('panel.remove(); toggle.remove()'))
})
test('visible joint layer uses selected actor, final-pose frames and existing pointer/lease owner',()=>{
    assert.match(source,/jointNodes = createJointNodeLayer\(/)
    assert.match(source,/selection: editor.panel.getPoseSelection/)
    assert.match(source,/subscribeFinalPoseBeforeCamera\(listener\)/)
    assert.match(source,/onOpenChange: open => \{ framing\?\.setEnabled\(open\); jointNodes\?\.setEnabled\(open\) \}/)
    assert.match(source,/onFrameActor: \(\) => framing\?\.frame\(\)/)
    assert.match(source,/beginJointPointerDrag\(control, scene.renderer.domElement, performanceJointPointer, request.mode\)/)
    assert.match(source,/editor.panel.selectJointFromCanvas\(identity\)/)
})
