import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=fs.readFileSync('src/viewer/index.ts','utf8'),build=fs.readFileSync('scripts/build-deployment.mjs','utf8');
function expression(text,name){const match=text.match(new RegExp('const '+name+' = ([^\\r\\n]+)'));assert.ok(match,name);return match[1];}
const available=new Function('env','return '+expression(source,'garmentContactsAvailable').replaceAll('import.meta.env','env'));
const nativeGravity=new Function('env','return '+expression(source,'poseGravityAvailable').replaceAll('import.meta.env','env'));
const buildPolicy=new Function('process','return '+expression(build,'garmentContacts'));
const gravityPolicy=new Function('process','return '+expression(build,'poseGravity'));
for(const value of [undefined,null,'','off','true','1','on'])test(`db8e279 contact defaults on with explicit build opt-out: ${String(value)}`,()=>{
 const allowed=available({VITE_MAGIUS_GARMENT_CONTACTS:value});assert.equal(allowed,value!=='off');
 // Execute the actual setter's Boolean guard even with a stale saved 'on'.
 const guard=source.match(/value=Boolean\((value&&garmentContactsAvailable)\)/);assert.ok(guard);
 const enable=new Function('value','garmentContactsAvailable','return Boolean('+guard[1]+')');assert.equal(enable(true,allowed),value!=='off');
});
test('unconfigured production build uses the user-selected db8e279 contacts, while native pose gravity stays available independently',()=>{
 assert.equal(buildPolicy({env:{}}),'on');assert.equal(gravityPolicy({env:{}}),'on');
 assert.equal(buildPolicy({env:{MAGIUS_GARMENT_CONTACTS:'off',VITE_MAGIUS_GARMENT_CONTACTS:'on'}}),'off');
 assert.equal(buildPolicy({env:{MAGIUS_GARMENT_CONTACTS:'on'}}),'on');
 assert.equal(nativeGravity({VITE_MAGIUS_GARMENT_CONTACTS:'off'}),true);
 assert.equal(nativeGravity({VITE_MAGIUS_POSE_GRAVITY:'off'}),false);
 assert.match(source,/gravity\.disabled=!poseGravityAvailable/);assert.match(source,/gravity\.checked&&poseGravityAvailable/);
 assert.match(source,/native-only-build-disabled/);assert.match(build,/native-only-build-disabled/);
});
