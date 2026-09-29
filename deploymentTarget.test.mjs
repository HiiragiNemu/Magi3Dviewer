import assert from 'node:assert/strict'
import test from 'node:test'
import {resolveDeploymentTarget} from './scripts/copy-deployment-public.mjs'
for (const value of [undefined,'','cloudflare']) test('website packaging defaults to Cloudflare: '+String(value),()=>assert.equal(resolveDeploymentTarget(value),'cloudflare'))
test('GitHub Pages size rules remain available only by explicit target selection',()=>assert.equal(resolveDeploymentTarget('github-pages'),'github-pages'))
for (const value of ['cloudflrae','false',null,0,'github']) test('invalid deployment target is not silently accepted: '+String(value),()=>assert.throws(()=>resolveDeploymentTarget(value),/Unsupported deployment target/))
