import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as T from 'three'
import {canonicalViewerEntry} from './src/viewer/entryCoherence.ts'
import {resolveBuildJumpStyle} from './src/viewer/jumpStyle.ts'
import {matchLandingGaitPhase} from './src/viewer/landingGaitPhase.ts'
for(const suffix of ['?runtimeDelivery=release','?runtimeDelivery=release&diagnostic=pose-editor#left','?foo=1&runtimeDelivery=release'])test('canonical production entry '+suffix,()=>{const url=canonicalViewerEntry('https://magius3dviewer.pages.dev/'+suffix);assert.equal(new URL(url).searchParams.has('runtimeDelivery'),false);assert.equal(new URL(url).hash,new URL('https://magius3dviewer.pages.dev/'+suffix).hash)})
test('localhost forced asset delivery and unrelated options remain intact',()=>{for(const href of ['https://localhost:4181/?runtimeDelivery=release','https://example.com/?runtimeDelivery=release','https://magius3dviewer.pages.dev/?foo=one#stage','https://magius3dviewer.pages.dev/?runtimeDelivery=other'])assert.equal(canonicalViewerEntry(href),href)})
test('HTML bypasses storage without disabling caching for large assets',()=>{const headers=fs.readFileSync('public/_headers','utf8').replace(/\r\n/g,'\n');for(const route of ['/', '/index.html']){const block=headers.split('\n'+route+'\n')[1]?.split(/\n\S/)[0];assert.ok(block?.includes('Cache-Control: no-store, max-age=0'));assert.ok(block?.includes('X-Magius-Revision: __MAGIUS_BUILD_REVISION__'))}assert.ok(!headers.includes('/*\n  Cache-Control: no-store'))})
test('rollback exists at deployment level with no page control or saved preference',()=>{assert.equal(resolveBuildJumpStyle(undefined),'expressive');assert.equal(resolveBuildJumpStyle('classic'),'classic');assert.throws(()=>resolveBuildJumpStyle('bad'));const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8');assert.doesNotMatch(source,/jump-style-select|jump-style-control|installJumpStyleSwitch|setViewerJumpStyle|readJumpStyle\(localStorage/);assert.match(source,/resolveBuildJumpStyle\(import\.meta\.env\.VITE_MAGIUS_JUMP_STYLE\)/)})
test('gait phase matches leg orientation without moving or scaling any bone',()=>{
 const root=new T.Group(),left=new T.Bone(),right=new T.Bone();left.name='UpLeg_L';right.name='UpLeg_R';root.add(left,right);left.position.set(0,1,0);right.position.set(.2,1,0)
 const quat=(angle)=>new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),angle).toArray()
 const clip=new T.AnimationClip('Run',1,[new T.QuaternionKeyframeTrack(left.uuid+'.quaternion',[0,.5,1],[...quat(-.5),...quat(.7),...quat(-.5)]),new T.QuaternionKeyframeTrack(right.uuid+'.quaternion',[0,.5,1],[...quat(.5),...quat(-.7),...quat(.5)])])
 left.quaternion.fromArray(quat(.7));right.quaternion.fromArray(quat(-.7));const snapshot=[left,right].map(n=>[n.position.toArray(),n.quaternion.toArray(),n.scale.toArray()])
 const match=matchLandingGaitPhase(root,[clip]);assert.equal(match.phase,.5);assert.ok(match.score<1e-10&&match.zeroPhaseScore>.1);assert.deepEqual([left,right].map(n=>[n.position.toArray(),n.quaternion.toArray(),n.scale.toArray()]),snapshot)
})
test('inapplicable/non-humanoid clips are not given an invented matching pose',()=>{assert.equal(matchLandingGaitPhase(new T.Group(),[]),undefined);assert.equal(matchLandingGaitPhase(new T.Group(),[new T.AnimationClip('NoLegs',1,[])]),undefined)})
