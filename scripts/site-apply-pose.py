"""One-shot, hash-checked source migration for the existing production branch.
The workflow commits the resulting source, not a build-time overlay.
"""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path.cwd()
expected = {
    'magia-exedra-character-three/scene/index.ts': ('357694ecbf30de48d0999f6ed5b214b750cc44caf5a33719e894a038e45a91a5', '6db5dd8e433a89ba275db31e9f816881d30c734394842e11c7225e5f63e139ed'),
    'magia-exedra-character-three/shaders/outline.ts': ('4501229bb63a31242b70ce4f148252743fbb1d8b9b07a2055d83aa87abdaf6ef', '75a317f544ab834152d4885ca689cac67c5d6e9f1c141d69c016db960e2903d6'),
    'src/viewer/directPoseTarget.ts': ('2d5bcd6366b189c9ed2d9098cf4ca8608ec0cc4435839d2a4dc633659552b0fd', '8a37311964757fb55c0689ea6aa136a0844a44d7c442d81d043715901d904b87'),
    'src/viewer/index.ts': ('ae8f2720e1d4d731a1028f8a1befc622fdb0ca1d0e32408ac899a738a1a92cc3', '7ca637923d4183edf7480dd7eab69453393e8f38a6da1e19fc533124733bc228'),
}
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
for name, (before, _) in expected.items():
    p = root / name
    text = p.read_text()
    if sha(text) != before:
        raise RuntimeError('Source changed before repair: ' + name)
    p.write_text(text)
for patch in sorted((root / '.github/repairs').glob('*.patch')):
    subprocess.run(['git', 'apply', '--recount', '--whitespace=nowarn', str(patch)], check=True)
for name, (_, after) in expected.items():
    if sha((root / name).read_text()) != after:
        raise RuntimeError('Post-repair checksum mismatch: ' + name)

def replace(s, a, b):
    if s.count(a) != 1:
        raise RuntimeError('Ambiguous replacement: ' + a[:100])
    return s.replace(a, b)

def edit(name, fn):
    p = root / name
    p.write_text(fn(p.read_text()))

# The real production functions remain under test; update their fixture bindings.
def direct(s):
    s = replace(s, "const source = fs.readFileSync(path.join(root, 'src/viewer/index.ts'), 'utf8')", """const toolsModule = path.join(cache, 'directPoseTools.mjs')
fs.writeFileSync(toolsModule, ts.transpileModule(fs.readFileSync(path.join(root, 'src/viewer/directPoseTools.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText)
const { DirectPoseHistory, findDirectPoseParts } = await import(pathToFileURL(toolsModule))
const source = fs.readFileSync(path.join(root, 'src/viewer/index.ts'), 'utf8')""")
    s = replace(s, "'setupDirectPoseEditing', 'pauseSelectedAnimation']", "'setupDirectPoseEditing', 'pauseSelectedAnimation', 'captureDirectPose', 'getDirectPoseHistory', 'commitDirectPoseHistory', 'restoreDirectPose', 'undoDirectPose']")
    s = replace(s, 'THREE: T, TransformControls, DirectPoseTarget, scene, document, window,', 'THREE: T, TransformControls, DirectPoseTarget, DirectPoseHistory, scene, document, window,')
    s = replace(s, '        const directPoseDragBases = new Map();', '        const directPoseDragBases = new Map(), directPoseHistories = new WeakMap();\n        let directPoseToolsUi, directPoseKeepOrientation = false, directPoseBendEditing = false;')
    s = replace(s, 'reset:resetActionParameters, mode:setDirectPoseTransformMode,', 'reset:resetActionParameters, undo:undoDirectPose, mode:setDirectPoseTransformMode,')
    return s + r'''

test('undo/redo restore a completed gesture without resizing joints', () => {
    const f=fixture();f.choose();const before=f.hand.quaternion.clone()
    f.startBody();f.direct('pointermove',f.event(655,425));f.render();f.direct('pointerup',f.event())
    const after=f.hand.quaternion.clone();assert.ok(!sameRotation(before,after))
    f.api.undo();assert.ok(sameRotation(f.hand.quaternion,before))
    f.api.undo(true);assert.ok(sameRotation(f.hand.quaternion,after));f.noStretch();f.cleanup()
})
test('history is bounded and identical clicks do not consume an undo slot',()=>{
    const h=new DirectPoseHistory(),p=new Map([['a',[0,0,0]]]);h.begin(p);h.finish(p);assert.equal(h.canUndo,false)
    for(let i=0;i<55;i++){h.begin(p);p.set('a',[i+1,0,0]);h.finish(p)}
    let count=0,current=p;while(h.canUndo){current=h.undo(current);count++}assert.equal(count,40);assert.equal(current.get('a')[0],15)
    assert.equal(h.redo(current).get('a')[0],16)
})
test('hand orientation lock preserves wrist world rotation and all bone lengths',()=>{
    const f=fixture();f.choose();const t=f.api.target;t.preserveEndOrientation=true
    const q=f.hand.getWorldQuaternion(new T.Quaternion());assert.ok(t.begin('translate'))
    t.handle.position.add(new T.Vector3(-.25,.2,.2));t.queue();t.flush()
    assert.ok(sameRotation(q,f.hand.getWorldQuaternion(new T.Quaternion())));f.noStretch();f.cleanup()
})
test('bend adjustment rotates the elbow around a fixed reachable hand target',()=>{
    const f=fixture();f.lower.rotation.z=.55;f.choose();const t=f.api.target;t.begin('translate')
    const target=t.handle.position.clone();t.queue();t.flush();const first=f.lower.getWorldPosition(new T.Vector3())
    t.bendAngle=Math.PI/2;t.queue();t.flush();const second=f.lower.getWorldPosition(new T.Vector3())
    assert.ok(first.distanceTo(second)>.1);assert.ok(f.hand.getWorldPosition(new T.Vector3()).distanceTo(target)<1e-6)
    f.noStretch();f.cleanup()
})
test('body part picker uses actual left/right identities, not helper bones',()=>{
    const a=new T.Group(),decoy=new T.Bone(),hand=new T.Bone(),foot=new T.Bone();decoy.name='Hand_R_Twist';hand.name='Hand_R';foot.name='Foot_L';a.add(decoy,hand,foot)
    const parts=findDirectPoseParts(a);assert.equal(parts.find(p=>p.id==='right-hand').bone,hand);assert.equal(parts.find(p=>p.id==='left-foot').bone,foot);assert.ok(!parts.some(p=>p.bone===decoy))
})
test('anatomical IK stops before reverse folding and does not move the root',()=>{
    const f=fixture();f.choose();const t=f.api.target;t.begin('translate');t.handle.position.copy(f.upper.getWorldPosition(new T.Vector3()));t.queue();t.flush()
    const a=f.upper.getWorldPosition(new T.Vector3()),b=f.lower.getWorldPosition(new T.Vector3()),c=f.hand.getWorldPosition(new T.Vector3())
    const angle=b.clone().sub(a).angleTo(c.clone().sub(b))*180/Math.PI;assert.ok(angle<=160.001);f.noStretch();f.cleanup()
})
'''
edit('directPoseManipulation.test.mjs', direct)

def selection(s):
    s = replace(s, r"const gate=Function(js(sceneSource.match(/this\.effects\.outlinePass\.enabled = this\.characterSelectionVisible[\s\S]*?this\.transformControlsHelper\.visible = transformVisible/)[0]));", r"const gate=Function(js(sceneSource.match(/this\.effects\.outlinePass\.enabled = false[\s\S]*?this\.transformControlsHelper\.visible = transformVisible/)[0]));")
    s = replace(s, "const {CharacterLocomotionController,FlatGroundCollisionWorld}=await import(pathToFileURL(path.join(tmp,'core.mjs')));", """const {CharacterLocomotionController,FlatGroundCollisionWorld}=await import(pathToFileURL(path.join(tmp,'core.mjs')));
const highlightFile=path.join(tmp,'highlight.mjs');
fs.writeFileSync(highlightFile,ts.transpileModule(read('src/viewer/selectionHighlight.ts').replace("from 'three'", "from '"+pathToFileURL(req.resolve('three')).href+"'"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {SelectionHighlight}=await import(pathToFileURL(highlightFile));""")
    s = replace(s, ' const scene=new Replay(),actors=', ' const scene=new Replay();scene.selectionHighlight=new SelectionHighlight();const actors=')
    s = replace(s, 'new T.MeshBasicMaterial()));object.position', 'new T.ShaderMaterial({uniforms:{uSelectionWeight:{value:0}}})));object.position')
    s = replace(s, "const baseline=process.env.MAGIUS_SELECTION_BASELINE==='1';", 'const baseline=false;')
    s = replace(s, 'performanceGizmoActive=false;const performanceExternalLeases', 'performanceGizmoActive=false,objectTransformUiPending=false;const performanceExternalLeases')
    s = replace(s, 'outline:!!outlinePass.enabled,mainGizmo:', 'outline:!!outlinePass.enabled,highlight:scene.selectionHighlight.materialCount>0,mainGizmo:')
    s = replace(s, 'assert.equal(row.outline,true);assert.equal(row.singleGizmo,true)', 'assert.equal(row.outline,false);assert.equal(row.highlight,true);assert.equal(row.renderCalls,5);assert.equal(row.singleGizmo,true)')
    s = replace(s, "assert.equal(frame('single-explicit-edit').outline,!baseline)", "assert.equal(frame('single-explicit-edit').highlight,true);assert.equal(frame('single-edit-no-extra-passes').renderCalls,5)")
    return s
edit('viewerSelectionEditing.test.mjs', selection)

strings = {
    'Redo pose': ('重做姿态','ポーズをやり直す'),
    'Reset selected part': ('重置当前部位','選択部位をリセット'),
    'Move whole character': ('移动整个角色','キャラクター全体を移動'),
    'Keep hand / foot orientation': ('保持手掌／脚掌朝向','手・足の向きを維持'),
    'Elbow / knee bend direction': ('肘部／膝盖弯曲方向','肘・膝の曲がる方向'),
    'Choose a hand or foot, then drag the arrows or the body part. Shift: fine adjustment. Alt: depth. W / E: move / rotate. Ctrl+Z: undo.': ('先选择手或脚，再拖动坐标箭头或对应部位。Shift 精细调整；Alt 前后移动；W／E 切换移动／旋转；Ctrl+Z 撤销。超出肢体长度时自动限位，不会拉长骨骼。','手・足を選んで軸や部位をドラッグ。Shift：微調整、Alt：奥行き、W／E：移動／回転、Ctrl+Z：元に戻す。届かない位置でも骨の長さは変わりません。'),
    'Left hand': ('左手','左手'), 'Right hand': ('右手','右手'),
    'Left foot': ('左脚','左足'), 'Right foot': ('右脚','右足'),
    'Left elbow': ('左肘','左肘'), 'Right elbow': ('右肘','右肘'),
    'Left knee': ('左膝','左膝'), 'Right knee': ('右膝','右膝'),
    'Head': ('头部','頭'), 'Chest': ('胸部','胸'),
    'Joint translation is unavailable; use Root placement or IK target': ('此部位不能直接平移；请旋转该关节，或选择手脚使用 IK','この部位は直接移動できません。関節を回転するか、手・足の IK を使用してください。'),
}
for index, name in enumerate(['zhCN','jaJP']):
    p=root / f'src/viewer/localization/{name}.ts'
    s=p.read_text()
    entries=''.join('    '+json.dumps(k,ensure_ascii=False)+': '+json.dumps(v[index],ensure_ascii=False)+',\n' for k,v in strings.items() if json.dumps(k,ensure_ascii=False)+':' not in s and repr(k)+':' not in s)
    anchor='export const '+('zhCnUiText' if index==0 else 'jaJpUiText')+': Readonly<Record<string, string>> = {\n'
    p.write_text(replace(s,anchor,anchor+entries))
css='''
/* Body-part targets remain finger-sized without expensive animation effects. */
.direct-pose-tools { display:grid;gap:.65rem;margin-block:.7rem; }
.direct-pose-parts { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem; }
.direct-pose-parts button,.direct-pose-actions button { min-height:36px;padding:.4rem .65rem;border-radius:6px;font:inherit;cursor:pointer; }
.direct-pose-parts button[aria-pressed="true"] { outline:2px solid currentColor;outline-offset:-2px;font-weight:700; }
.direct-pose-actions { display:flex;flex-wrap:wrap;gap:.4rem; }
.direct-pose-actions button { flex:1 1 7rem; }
.direct-pose-tools>label { display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;font-size:.9em; }
.direct-pose-tools input[type="range"] { min-width:8rem;flex:1 1 8rem; }
.direct-pose-tools input[type="checkbox"] { width:18px;height:18px; }
.direct-pose-hint { margin:0;font-size:.85em;line-height:1.6;opacity:.85; }
button.pose-bone-select { font:inherit;color:inherit;text-align:start;border:0;background:transparent;cursor:pointer;padding:.25rem; }
button.pose-bone-select:hover,button.pose-bone-select:focus-visible { text-decoration:underline; }
.direct-pose-tools button:disabled { cursor:default;opacity:.5; }
@media (pointer:coarse) { .direct-pose-tools button { min-height:44px; } }
'''
p=root/'src/viewer/style/panels.css'
p.write_text(p.read_text()+css)
print('Applied reviewed source changes; existing runtime resource data was not modified.')
