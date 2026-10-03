import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse} from 'yaml'

const workflow = parse(fs.readFileSync('.github/workflows/site-delivery.yml', 'utf8'))
const build = workflow.jobs.build
const steps = build.steps
const publishIndex = steps.findIndex(step => step.uses === 'cloudflare/wrangler-action@v4')

test('private publication uses the same fully tested package without large intermediate Actions artifacts', () => {
    assert.ok(publishIndex > 0)
    assert.equal(build.environment.name, 'magius3dviewer-live')
    assert.equal(build.needs, 'configuration')
    assert.ok(steps[publishIndex].if.includes("needs.configuration.result == 'success'"))
    assert.ok(steps[publishIndex].if.includes('success()'))
    assert.match(steps[publishIndex].with.command, /pages deploy dist-deploy/)
    for (const command of ['npm run test:website', 'tsc --noEmit', 'scripts/build-deployment.mjs',
        'scripts/site-smoke-pose.mjs', 'scripts/site-smoke-cloudflare.mjs', 'scripts/site-smoke-viewport.mjs']) {
        const index = steps.findIndex(step => step.run?.includes(command))
        assert.ok(index >= 0 && index < publishIndex, 'Missing mandatory pre-publication gate: ' + command)
        assert.notEqual(steps[index]['continue-on-error'], true)
        assert.equal(steps[index].if, undefined)
    }
    const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))
    assert.equal(uploads.length, 1)
    assert.equal(uploads[0].with.path, '/tmp/site-evidence/')
    assert.ok(uploads[0].with['retention-days'] <= 7)
    assert.equal(uploads[0].if, 'always()')
    assert.ok(!steps.some(step => step.uses?.startsWith('actions/download-artifact@')))
})

test('publication still verifies actual production revision, HTML and real browser behavior', () => {
    const after = steps.slice(publishIndex + 1)
    const version = after.find(step => step.run?.includes("assert.equal(v.revision,process.env.GITHUB_SHA)"))
    assert.ok(version)
    assert.match(version.run, /hash\(fs.readFileSync\('dist-deploy\/index.html'\)\)/)
    const browser = after.find(step => step.env?.MAGIUS_SITE_URL === 'https://magius3dviewer.pages.dev/')
    assert.ok(browser)
    for (const name of ['site-smoke-cloudflare', 'site-smoke-viewport', 'site-smoke-entry-landing']) assert.ok(browser.run.includes(name))
    assert.ok(browser.run.includes('/tmp/site-evidence/production-viewport'))
    assert.ok(!browser.run.includes('> package.json'))
})
