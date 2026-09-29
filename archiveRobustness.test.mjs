import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {gzipSync,gunzipSync,zipSync,unzipSync,strToU8} from 'fflate'
const root=path.dirname(fileURLToPath(import.meta.url))
test('updated archive library retains exact gzip resource bytes',()=>{const data=strToU8('current scene/animation payload\n'.repeat(500));assert.deepEqual(gunzipSync(gzipSync(data)),data)})
test('updated archive library retains file identity and bytes in ordinary ZIPs',()=>{const files={'scene.json':strToU8('{"current":true}'),'textures/a.bin':new Uint8Array([0,255,1,4])};const extracted=unzipSync(zipSync(files));assert.deepEqual(extracted,files)})
test('malformed ZIP64 metadata terminates with an error instead of hanging the viewer',()=>{
 // A separate bounded process ensures that a future dependency regression
 // cannot hang the entire suite. This is an in-memory local robustness check.
 const code=`import assert from 'node:assert/strict';import {zipSync,unzipSync,strToU8} from 'fflate';
 const ordinary=zipSync({'sample.txt':strToU8('safe local fixture')});const old=new DataView(ordinary.buffer,ordinary.byteOffset,ordinary.byteLength);
 const end=ordinary.length-22,directory=old.getUint32(end+16,true),directorySize=old.getUint32(end+12,true);
 assert.equal(old.getUint32(directory,true),0x02014b50);
 const bytes=new Uint8Array(ordinary.length+76);bytes.set(ordinary.subarray(0,end));bytes.set(ordinary.subarray(end),end+76);
 const view=new DataView(bytes.buffer);
 // A real ZIP64 end record and locator require ZIP64 size metadata. Omit that
 // extra field in the central entry: the parser must reject, never spin.
 view.setUint32(directory+20,0xffffffff,true);
 view.setUint32(end,0x06064b50,true);view.setUint32(end+4,44,true);
 view.setUint16(end+12,45,true);view.setUint16(end+14,45,true);
 view.setUint32(end+24,1,true);view.setUint32(end+32,1,true);
 view.setUint32(end+40,directorySize,true);view.setUint32(end+48,directory,true);
 view.setUint32(end+56,0x07064b50,true);view.setUint32(end+64,end,true);view.setUint32(end+72,1,true);
 assert.throws(()=>unzipSync(bytes),error=>error.code===13);`
 assert.doesNotThrow(()=>execFileSync(process.execPath,['--input-type=module','--eval',code],{cwd:root,timeout:3000,stdio:'pipe'}))
})
