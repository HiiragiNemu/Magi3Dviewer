import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import ts from 'typescript'

// In-memory compiler: no native asset fixture or generated scratch file required.
export function loadStageTransformModules() {
    const cache = new Map()
    function load(name) {
        if (name === 'three') return THREE
        if (cache.has(name)) return cache.get(name)
        const source = readFileSync(new URL(`../../src/viewer/${name.replace('./', '')}.ts`, import.meta.url), 'utf8')
        const module = { exports: {} }
        cache.set(name, module.exports)
        const compiled = ts.transpileModule(source, { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        } }).outputText
        Function('exports', 'require', 'module', compiled)(module.exports, load, module)
        return module.exports
    }
    return { THREE, bridge: load('./stageTransformAnimations'), batching: load('./stageStaticBatching') }
}
