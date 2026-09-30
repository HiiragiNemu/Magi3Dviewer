import assert from 'node:assert/strict'
import test from 'node:test'
import {TpsViewGesture} from './src/viewer/TpsViewTouch.ts'
import {layoutViewportBranches} from './src/viewer/viewportBranchLayout.ts'

const intersect=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
for(const [width,height] of [[360,620],[430,730],[932,330],[1366,800]])test(`branch menus outside a framed actor at ${width}x${height}`,()=>{
 const view={x:0,y:100,width,height},body={x:width/2-45,y:160,width:90,height:Math.min(320,height-90)}
 const p=layoutViewportBranches(view,body,210,240)
 for(const box of [p.left,p.right]){assert.equal(intersect(box,body),0);assert.ok(box.x>=0&&box.x+box.width<=width);assert.ok(box.y>=view.y&&box.y+box.height<=view.y+height)}
 assert.ok(p.left.width<110&&p.right.width<110)
})
test('single finger, pinch and return to single finger have no coordinate jump',()=>{
 const rotations=[],ratios=[],g=new TpsViewGesture({rotate:(x,y)=>rotations.push([x,y]),pinch:r=>ratios.push(r)})
 g.begin({id:1,x:100,y:100});g.move([{id:1,x:120,y:105}]);assert.deepEqual(rotations,[[20,5]])
 g.begin({id:2,x:200,y:105});g.move([{id:2,x:240,y:105}]);assert.deepEqual(ratios,[80/120]);assert.equal(rotations.length,1)
 g.end([2]);g.move([{id:1,x:125,y:105}]);assert.deepEqual(rotations.at(-1),[5,0])
})
test('joystick identifiers and cancelled fingers cannot rotate or zoom camera',()=>{
 const events=[],g=new TpsViewGesture({rotate:(...x)=>events.push(x),pinch:r=>events.push(r)})
 g.begin({id:8,x:50,y:50});g.move([{id:1,x:100,y:100}]);assert.deepEqual(events,[[0,0]])
 g.end([1]);assert.equal(g.size,1);g.end([8]);g.move([{id:8,x:500,y:500}]);assert.equal(events.length,1)
})
test('zero spans and malformed coordinates cannot corrupt zoom',()=>{
 const ratios=[],g=new TpsViewGesture({rotate(){},pinch:r=>ratios.push(r)})
 g.begin({id:1,x:10,y:10});g.begin({id:2,x:10,y:10});g.move([{id:1,x:NaN,y:2},{id:2,x:10,y:10}]);assert.deepEqual(ratios,[])
 g.reset();assert.equal(g.size,0)
})
test('touch re-entry and orientation reset leave no held view gesture',()=>{
 const events=[],g=new TpsViewGesture({rotate:(...x)=>events.push(x),pinch:r=>events.push(r)})
 g.begin({id:1,x:50,y:50});g.reset();g.move([{id:1,x:60,y:80}]);assert.deepEqual(events,[])
 g.begin({id:1,x:500,y:400});g.move([{id:1,x:505,y:400}]);assert.deepEqual(events,[[5,0]])
})
