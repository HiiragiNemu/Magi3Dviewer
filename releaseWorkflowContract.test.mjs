import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'

const repo = path.resolve(process.env.S6_WORKFLOW_CONTRACT_ROOT ?? import.meta.dirname)
const legacyFixture = path.join(repo, 'tests/fixtures/s6-release-workflow/request-deploy.retired.yml.txt')
const retired = '.github/workflows/request-deploy.yml'
const research = [
    '.github/workflows/manifest-driven-stage-reconstruction.yml',
    '.github/workflows/validate-stage-608-chair-alpha-cutout-feature.yml',
]
const text = file => fs.readFileSync(file, 'utf8')
const activeWorkflows = () => fs.readdirSync(path.join(repo, '.github/workflows'))
    .filter(name => /\.ya?ml$/.test(name))
    .map(name => ({ name, source: text(path.join(repo, '.github/workflows', name)) }))
const isObsoleteWebsiteDispatcher = source => /createDispatchEvent\s*\(/.test(source)
    && /event_type\s*:\s*['"]deploy-magius3dviewer['"]/.test(source)

async function invokeLegacyFixture(source, ref) {
    const dispatches = [], statuses = []
    if (!source || !/branches:\s*\['magius3dviewer'\]/.test(source) || ref !== 'refs/heads/magius3dviewer') {
        return { dispatches, statuses }
    }
    const lines = source.split(/\r?\n/)
    const start = lines.findIndex(line => /^\s+script:\s*\|\s*$/.test(line))
    assert.ok(start >= 0)
    const body = lines.slice(start + 1).filter(line => line.trim()).map(line => line.replace(/^ {12}/, '')).join('\n')
    const sandbox = {
        context: { serverUrl: 'https://fixture.invalid', repo: { owner: 'fixture', repo: 'viewer' }, runId: 1, ref, sha: 'fixture-commit' },
        github: { rest: { repos: {
            async createDispatchEvent(value) { dispatches.push(value) },
            async createCommitStatus(value) { statuses.push(value) },
        } } },
    }
    // No process, filesystem, fetch or live GitHub client is exposed to this script.
    await vm.runInNewContext(`(async () => {${body}\n})()`, sandbox, { timeout: 1000 })
    return { dispatches, statuses }
}

test('obsolete branch-based website workflow is absent from active source', () => {
    assert.equal(fs.existsSync(path.join(repo, retired)), false)
})

test('historical remote deploy.yml is not resurrected into local source authority', () => {
    assert.equal(fs.existsSync(path.join(repo, '.github/workflows/deploy.yml')), false)
})

test('research workflows are permitted without becoming the retired website dispatcher', () => {
    for (const relative of research) {
        assert.equal(isObsoleteWebsiteDispatcher(text(path.join(repo, relative))), false)
    }
    // Research branches and build jobs remain permitted; their bytes are not frozen here.
    assert.equal(isObsoleteWebsiteDispatcher("on:\n  push:\n    branches: ['feature/research']\njobs:\n  build:\n    steps:\n      - run: npm run build\n"), false)
})

test('legacy behavior fixture is durable source data outside active workflow YAML', () => {
    assert.equal(path.relative(repo, legacyFixture).split(path.sep).join('/'), 'tests/fixtures/s6-release-workflow/request-deploy.retired.yml.txt')
    assert.equal(path.extname(legacyFixture), '.txt')
    assert.equal(fs.statSync(legacyFixture).isFile(), true)
    assert.equal(isObsoleteWebsiteDispatcher(text(legacyFixture)), true)
})

test('active workflow set has no renamed copy of the precise obsolete website dispatcher', () => {
    assert.deepEqual(activeWorkflows().filter(row => isObsoleteWebsiteDispatcher(row.source)).map(row => row.name), [])
    const baseline = text(legacyFixture)
    assert.equal(isObsoleteWebsiteDispatcher(baseline), true)
    // Research feature refs are expressly allowed; this is not a global no-branch assertion.
    assert.equal(isObsoleteWebsiteDispatcher("on:\n  push:\n    branches: ['feature/research']\njobs: {}\n"), false)
})

test('preserved original proves legacy dispatch and misleading Pages status using only mocked calls', async () => {
    const baseline = text(legacyFixture)
    const result = await invokeLegacyFixture(baseline, 'refs/heads/magius3dviewer')
    assert.equal(result.dispatches.length, 1)
    assert.equal(result.dispatches[0].event_type, 'deploy-magius3dviewer')
    assert.equal(result.dispatches[0].client_payload.source_branch, 'magius3dviewer')
    assert.equal(result.statuses.length, 1)
    assert.equal(result.statuses[0].description, 'Protected-main Pages deployment requested')
    assert.equal((await invokeLegacyFixture(baseline, 'refs/heads/main')).dispatches.length, 0)
})

test('retirement leaves no website request handler for either old-branch or main push', async () => {
    const source = fs.existsSync(path.join(repo, retired)) ? text(path.join(repo, retired)) : null
    for (const ref of ['refs/heads/magius3dviewer', 'refs/heads/main']) {
        const result = await invokeLegacyFixture(source, ref)
        assert.equal(result.dispatches.length, 0)
        assert.equal(result.statuses.length, 0)
    }
})

function documentedContract() {
    const doc = text(path.join(repo, 'docs/s6-sealed-release-workflow.md'))
    const match = /<!-- s6-release-contract -->\s*```json\s*([\s\S]*?)```/.exec(doc)
    assert.ok(match, 'review contract JSON is present')
    return { doc, contract: JSON.parse(match[1]) }
}

test('manual website contract binds main source and the same sealed artifact, not dispatch or rebuild', () => {
    const { doc, contract } = documentedContract()
    assert.equal(contract.sourceBranch, 'main')
    assert.equal(contract.artifactPolicy, 'same-sealed-bytes')
    assert.deepEqual(contract.website, { provider: 'cloudflare-pages', project: 'magius3dviewer', publication: 'manual-direct-upload' })
    assert.equal(contract.githubPages, false)
    assert.equal(contract.repositoryDispatch, false)
    assert.equal(contract.rebuildAtDeployment, false)
    assert.match(doc, /Historical predeploy heads and version IDs[\s\S]*check them afresh/)
    assert.match(doc, /review contract, not an executable authorization/)
})

test('documented review fixture remains incomplete when any human/freshness/source gate is absent', () => {
    const { contract } = documentedContract()
    const expected = ['owners-aligned', 'technical-gates-passed', 'human-accepted', 'release-approved', 'fresh-predeploy-checked', 'sealed-bytes-exact']
    assert.deepEqual(contract.requiredGates, expected)
    const complete = gates => contract.requiredGates.every(name => gates[name] === true)
    const approved = Object.fromEntries(expected.map(name => [name, true]))
    assert.equal(complete(approved), true)
    for (const gate of expected) {
        assert.equal(complete({ ...approved, [gate]: false }), false)
        const absent = { ...approved }; delete absent[gate]
        assert.equal(complete(absent), false)
    }
})
