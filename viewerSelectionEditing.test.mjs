import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=process.env.MAGIUS_TEST_SOURCE_ROOT??path.dirname(fileURLToPath(import.meta.url));
const runtime=process.env.MAGIUS_TEST_RUNTIME_ROOT??root;
const req=createRequire(path.join(runtime,'package.json')),ts=req('typescript');
const T=await import(pathToFileURL(req.resolve('three')).href);
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const ast=(name,s)=>ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true);
const js=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const sceneSource=read('magia-exedra-character-three/scene/index.ts'),sceneAst=ast('scene.ts',sceneSource);
const sceneClass=sceneAst.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='MagiaExedraScene3D');
const members=sceneClass.members.filter(n=>['characterSelected','characterTransformEditing','characterSelectionVisible','shouldUseComposer','renderCurrentFrame'].includes(n.name?.getText(sceneAst)));
const Replay=Function(js('class Replay {'+members.map(n=>n.getText(sceneAst)).join('\n')+'}; return Replay;'))();
const gate=Function(js(sceneSource.match(/this\.effects\.outlinePass\.enabled = false[\s\S]*?this\.transformControlsHelper\.visible = transformVisible/)[0]));
const indexSource=read('src/viewer/index.ts'),indexAst=ast('viewer.ts',indexSource);
function extract(tree,names){const found=[];function visit(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))found.push(n.getText(tree).replace(/^export /,''));ts.forEachChild(n,visit);}visit(tree);assert.equal(found.length,names.length);return found.join('\n');}
const controlSource=extract(indexAst,['setupSingleCharacterTransformControls','activateObjectTransform','clearSingleCharacterTransform','closeObjectTransform','setTransformMode','updateTransformModeButtons']);
const inputSource=extract(indexAst,['mouseClickHandler','mouseDoubleClickHandler','tpsMoveKeepsCharacterSelectedOnEmptyViewerClick','selectCharacterByMouse']);
const tpsAst=ast('tps.ts',fs.readFileSync(path.join(runtime,'src/viewer/viewerLocomotion.ts'),'utf8'));
const selectedBindingSource=extract(tpsAst,['selectedBinding']);
const names=['controls/TransformControls','postprocessing/EffectComposer','postprocessing/RenderPass','postprocessing/OutlinePass','postprocessing/SMAAPass','postprocessing/OutputPass'];
const [{TransformControls},{EffectComposer},{RenderPass},{OutlinePass},{SMAAPass},{OutputPass}]=await Promise.all(names.map(n=>import(pathToFileURL(path.join(runtime,'node_modules/three/examples/jsm',n+'.js')))));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'selection-edit-test-'));
await req('esbuild').build({entryPoints:[path.join(runtime,'src/viewer/characterLocomotion.ts')],outfile:path.join(tmp,'core.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'three',setup(b){b.onResolve({filter:/^three$/},()=>({path:pathToFileURL(req.resolve('three')).href,external:true}))}}]});
const {CharacterLocomotionController,FlatGroundCollisionWorld}=await import(pathToFileURL(path.join(tmp,'core.mjs')));
const highlightFile=path.join(tmp,'highlight.mjs');
fs.writeFileSync(highlightFile,ts.transpileModule(read('src/viewer/selectionHighlight.ts').replace("from 'three'", "from '"+pathToFileURL(req.resolve('three')).href+"'"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {SelectionHighlight}=await import(pathToFileURL(highlightFile));

test('actor selection, edit overlay dismissal and TPS ownership are independent',()=>{
 const baseline=false;
 const scene=new Replay();scene.selectionHighlight=new SelectionHighlight();const actors=[0,1].map(i=>{const object=new T.Group();object.add(new T.Mesh(new T.BoxGeometry(),new T.ShaderMaterial({uniforms:{uSelectionWeight:{value:0}}})));object.position.x=i*2;return {character:{object}};});
 scene.scene=new T.Scene();scene.camera=new T.PerspectiveCamera(40,16/9,.01,100);scene.camera.position.set(0,1.5,3);scene.camera.lookAt(0,.8,0);scene.camera.updateMatrixWorld(true);
 actors.forEach(a=>scene.scene.add(a.character.object));scene.characters=[...actors];scene.composerEnabled='Auto';scene.backgroundSceneEnabled=false;scene.foregroundCaptureActive=false;scene.controls={enabled:true};
 scene.transformControls=new TransformControls(scene.camera);scene.transformControlsHelper=scene.transformControls.getHelper();scene.scene.add(scene.transformControlsHelper);
 let draws=[],target=null;scene.renderer={autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,outputColorSpace:T.SRGBColorSpace,toneMapping:T.NoToneMapping,toneMappingExposure:1,getPixelRatio:()=>1,getSize:v=>v.set(1536,864),getClearColor:c=>c.set(0),getClearAlpha:()=>1,setClearColor(){},setClearAlpha(){},getRenderTarget:()=>target,setRenderTarget:t=>target=t,clear(){},clearDepth(){},render(s){draws.push(s===scene.scene?'scene':'fullscreen');if(s===scene.scene)s.updateMatrixWorld();}};
 // SMAA image decoding and renderer calls are instrumented boundaries, not GPU pixels.
 const previousImage=globalThis.Image;globalThis.Image=class {set src(v){this.srcValue=v;}};
 const composer=new EffectComposer(scene.renderer),outlinePass=new OutlinePass(new T.Vector2(1536,864),scene.scene,scene.camera),smaaPass=new SMAAPass();
 globalThis.Image=previousImage;
 const off=()=>({enabled:false});scene.effects={composer,outlinePass,renderPass:new RenderPass(scene.scene,scene.camera),smaaPass,outputPass:new OutputPass(),taaRenderPass:off(),bloomPass:off(),urpBloomPass:off(),backgroundColorAdjustPass:off(),paraffinPass:off(),volumePostProcessPass:off(),combatVfxScreenPass:off(),effectiveAntiAliasing:'SMAA',syncBackgroundSceneState(){},syncParaffinLightDirection(){}};
 for(const p of [scene.effects.renderPass,outlinePass,smaaPass,scene.effects.outputPass])composer.addPass(p);
 const classes=new Set(),document={body:{classList:{contains:c=>classes.has(c)}}};
 const button=()=>({hidden:true,style:{display:'',removeProperty(k){delete this[k];}}});
 const controls=Function('scene','TransformControls','document','button',js(`let viewportEditor;const editorGround={capture(){},constrainObject(){}};function setDirectPoseEditing(){};let singleCharacterTransformControls,singleCharacterTransformControlsHelper,singleCharacterTransformActive=false,singleObjectTransformOnChange,singleCharacterTransformOrbitWasEnabled=true,directPoseEditingEnabled=false,performanceGizmoActive=false,objectTransformUiPending=false;const performanceExternalLeases=new Map(),transformCloseBtn=button(),transformTranslateBtn=button(),transformRotateBtn=button();${controlSource};setupSingleCharacterTransformControls();return {activate:activateObjectTransform,close:closeObjectTransform,refresh:updateTransformModeButtons,get single(){return singleCharacterTransformControls},get helper(){return singleCharacterTransformControlsHelper},get closeHidden(){return transformCloseBtn.hidden}};`))(scene,TransformControls,document,button);
 const bindings=new Map(actors.map(a=>[a,{controller:new CharacterLocomotionController({characterId:'test',transform:a.character.object,animation:{listClips:()=>[],play(){},setRootMotionEnabled(){}},initiallyGrounded:true,collisionWorld:new FlatGroundCollisionWorld(),config:{walkSpeed:1,runSpeed:3,groundAcceleration:100}})}]));
 const selectedBinding=Function('scene','attachViewerLocomotion',js(selectedBindingSource+';return selectedBinding;'))(scene,a=>bindings.get(a));
 let picked,selectionCalls=0;
 const input=Function('scene','document','pickObject','selectCharacter','deselectCharacter','closeObjectTransform','activateObjectTransform','singleCharacterTransformControls',js(`let mouseMoveX=0,mouseMoveY=0,directPoseEditingEnabled=false,performanceGizmoActive=false;${inputSource};return {click:mouseClickHandler,doubleClick:mouseDoubleClickHandler};`))(scene,document,()=>picked,a=>{scene.characterSelected=a;selectionCalls++;},()=>{scene.characterSelected=undefined;},controls.close,controls.activate,controls.single);
 scene.getIntersectedCharacter=()=>undefined;
 const select=i=>{controls.close();scene.characterSelected=actors[i];selectionCalls++;};
 const event={offsetX:0,offsetY:0,preventDefault(){},stopPropagation(){}};
 const rows=[];
 const frame=label=>{gate.call(scene);controls.refresh();draws=[];scene.renderCurrentFrame();const row={label,actorCount:scene.characters.length,selected:actors.indexOf(scene.characterSelected),outline:!!outlinePass.enabled,highlight:scene.selectionHighlight.materialCount>0,mainGizmo:scene.transformControlsHelper.visible,singleGizmo:controls.helper.visible,closeHidden:controls.closeHidden,renderCalls:draws.length,tpsSelected:!!selectedBinding(),orbitEnabled:scene.controls.enabled};rows.push(row);return row;};
 const silent=console.log;console.log=()=>{};
 try {
  assert.equal(frame('two-unselected').renderCalls,5);
  picked={object:actors[0].character.object,select:()=>select(0),refresh(){}};input.click(event);
  let row=frame('two-single-click');assert.equal(row.outline,baseline);assert.equal(row.renderCalls,baseline?14:5);assert.equal(row.tpsSelected,true);assert.equal(row.actorCount,2);
  input.doubleClick(event);row=frame('two-explicit-edit');assert.equal(row.outline,false);assert.equal(row.highlight,true);assert.equal(row.renderCalls,5);assert.equal(row.singleGizmo,true);assert.equal(row.closeHidden,false);
  // Enter TPS after edit opened with Orbit enabled: closing must not revive Orbit.
  classes.add('locomotion-mode-enabled');scene.controls.enabled=false;
  controls.single.dragging=true;controls.single.dragging=false;
  if(!baseline)assert.equal(scene.controls.enabled,false,'TPS owns camera after gizmo drag ends');
  const retained=scene.characterSelected,binding=selectedBinding();controls.close();row=frame('two-close-edit-tps');
  assert.equal(scene.characterSelected,retained);assert.equal(selectedBinding(),binding);assert.equal(scene.characters.length,2);assert.equal(row.singleGizmo,false);assert.equal(row.mainGizmo,false);assert.equal(row.closeHidden,true);assert.equal(row.outline,baseline);assert.equal(row.renderCalls,baseline?14:5);if(!baseline)assert.equal(scene.controls.enabled,false);
  for(let i=0;i<120;i++)gate.call(scene);assert.equal(!!outlinePass.enabled,baseline,'closure survives later frames');
  const before=retained.character.object.position.clone();binding.controller.setInput({moveX:0,moveZ:1,run:false,jumpPressed:false});for(let i=0;i<30;i++)binding.controller.advance(1/60);assert.ok(before.distanceTo(retained.character.object.position)>.1,'TPS selected actor still walks after close');
  picked=undefined;input.click(event);assert.equal(scene.characterSelected,retained,'TPS empty click retains selection');
  picked={object:actors[1].character.object,select:()=>select(1),refresh(){}};input.click(event);row=frame('two-switch-actor-tps');assert.equal(row.outline,baseline);assert.equal(selectedBinding(),bindings.get(actors[1]));
  const otherBefore=actors[1].character.object.position.clone();selectedBinding().controller.setInput({moveX:1,moveZ:0,run:true,jumpPressed:false});for(let i=0;i<30;i++)selectedBinding().controller.advance(1/60);assert.ok(otherBefore.distanceTo(actors[1].character.object.position)>.1,'second selected actor runs without edit overlay');
  controls.activate(actors[1].character.object);frame('two-reopen');controls.close();assert.equal(frame('two-close-again').outline,baseline);
  if(!baseline){
   classes.add('locomotion-mode-enabled');scene.controls.enabled=false;controls.activate(actors[1].character.object);controls.single.dragging=true;
   classes.delete('locomotion-mode-enabled');scene.controls.enabled=true;controls.close();
   assert.equal(scene.controls.enabled,true,'TPS exit during an active drag retains restored Orbit after close');
   assert.equal(selectedBinding(),bindings.get(actors[1]));assert.equal(frame('tps-exit-mid-drag-then-close').outline,false);
   classes.add('locomotion-mode-enabled');scene.controls.enabled=false;controls.activate(actors[1].character.object);controls.single.dragging=true;
   classes.delete('locomotion-mode-enabled');scene.controls.enabled=true;controls.single.dragging=false;
   assert.equal(scene.controls.enabled,true,'TPS exit during drag retains restored Orbit after pointerup');controls.close();
   classes.add('locomotion-mode-enabled');scene.controls.enabled=false;
  }
  const prop=new T.Group();scene.scene.add(prop);controls.activate(prop);row=frame('independent-prop-edit');assert.equal(row.singleGizmo,true);if(!baseline)assert.equal(row.outline,false,'prop edit does not highlight unrelated selected actor');controls.close();
  scene.effects.effectiveAntiAliasing='None';smaaPass.enabled=false;assert.equal(frame('two-aa-none-selected').renderCalls,baseline?11:1);
  scene.effects.effectiveAntiAliasing='SMAA';smaaPass.enabled=true;scene.characters=[actors[1]];scene.characterSelected=actors[1];assert.equal(frame('single-selected').outline,false);controls.activate(actors[1].character.object);assert.equal(frame('single-explicit-edit').highlight,true);assert.equal(frame('single-edit-no-extra-passes').renderCalls,5);controls.close();assert.equal(frame('single-closed').outline,false);
  controls.activate(actors[1].character.object);classes.delete('locomotion-mode-enabled');scene.controls.enabled=true;controls.close();if(!baseline)assert.equal(scene.controls.enabled,true,'closing stale edit UI after TPS exit keeps Orbit enabled');
  scene.controls.enabled=true;controls.activate(actors[1].character.object);controls.single.dragging=true;assert.equal(scene.controls.enabled,false);controls.close();assert.equal(scene.controls.enabled,true,'closing a real drag restores Orbit when TPS is off');
 } finally {console.log=silent;for(const p of composer.passes)p.dispose?.();composer.dispose();for(const a of actors)a.character.object.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});}
 const report={baseline,rows,selectionCalls,checks:'Actual extracted selection, click, transform close and TPS selectedBinding functions; real Three postprocessing passes and locomotion controller. DOM hit-testing and GPU output are not covered.'};
 if(process.env.MAGIUS_SELECTION_REPORT)fs.writeFileSync(process.env.MAGIUS_SELECTION_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
});
