import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {collectBundledEnemyTextures,bundledEnemyModelNames,requiredDirectoryClosures,assertEnemyTextureArchiveClosure} from './scripts/copy-deployment-public.mjs'
const root=path.dirname(fileURLToPath(import.meta.url))
test('two exact new witch closures accompany all 41 required platform-qualified texture products',async()=>{
 assert.deepEqual(bundledEnemyModelNames,['enemy_605025_battle_unit','enemy_605026_battle_unit'])
 for(const name of bundledEnemyModelNames)assert.ok(requiredDirectoryClosures.some(c=>c.source===`public/enemies/models/${name}`&&c.output===`enemies/models/${name}`))
 const rows=await collectBundledEnemyTextures();assert.equal(rows.length,41);assert.equal(rows.reduce((n,r)=>n+r.bytes,0),11991287)
 assert.equal(new Set(rows.map(r=>r.output)).size,41)
 for(const r of rows){assert.match(r.output,/^enemies\/textures\/android-jp-20260916\/[a-z0-9_-]+\.png$/);assert.equal(createHash('sha256').update(await fs.readFile(r.source)).digest('hex'),r.sha256)}
})
test('all historical 493 remote model archives retain their exact separate closure',async()=>{
 const catalog=JSON.parse(await fs.readFile(path.join(root,'public/catalogs/runtime-product-delivery.v1.json'),'utf8'))
 const result=assertEnemyTextureArchiveClosure(catalog)
 assert.equal(result.modelProducts,493);assert.equal(result.globalUniqueTextureAuthorities,1969);assert.equal(result.sharedTextureAuthorityBytes,564810901)
 assert.equal(result.packedBytes,3202610710)
})
test('manifest identity conflicts remain rejected before any deployment copy',async()=>{
 const temp=await fs.mkdtemp(path.join(root,'node_modules/.cache/enemy-closure-negative-'))
 await fs.mkdir(path.join(temp,'public/enemies/models/enemy_605025_battle_unit'),{recursive:true})
 await fs.writeFile(path.join(temp,'public/enemies/texture-runtime-products.v1.json'),JSON.stringify({entries:[]}))
 await fs.writeFile(path.join(temp,'public/enemies/models/enemy_605025_battle_unit/material-profile.v1.json'),JSON.stringify({profiles:[{textures:{_MainTex:{stableKey:'wrong',runtimeUrl:'/enemies/textures/legacy.png'}}}]}))
 await assert.rejects(collectBundledEnemyTextures(temp),/identity mismatch/)
})
