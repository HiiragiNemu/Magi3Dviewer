#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def patch_stages() -> None:
    path = Path('src/viewer/stages.ts')
    text = path.read_text(encoding='utf-8')

    if "from './stageCatalog'" not in text:
        text = replace_once(
            text,
            "import { gui } from './controllers/GUI'\n",
            "import { gui } from './controllers/GUI'\n"
            "import { loadStageCatalogTree } from './stageCatalog'\n",
            'stageCatalog import',
        )

    interface = """interface StageCatalog {
    version: number
    generatedAt?: string
    sourceRevision?: string
    /** Optional modular entries keep large official catalogs incremental. */
    entries?: string[]
    stages: StageDefinition[]
}

"""
    if interface in text:
        text = text.replace(interface, '', 1)

    old_setup = """export async function setupStageSelector() {
    try {
        const response = await fetch('./stages/catalog.json', { cache: 'no-cache' })
        if (response.ok) {
            const catalog = await response.json() as StageCatalog
            const modularStages: StageDefinition[] = []
            for (const entryUrl of catalog.entries ?? []) {
                try {
                    const entryResponse = await fetch(entryUrl, { cache: 'no-cache' })
                    if (!entryResponse.ok) {
                        throw new Error(`${entryResponse.status} ${entryResponse.statusText}`)
                    }
                    modularStages.push(
                        await entryResponse.json() as StageDefinition,
                    )
                } catch (error) {
                    console.warn(
                        `Could not load stage catalog entry ${entryUrl}:`,
                        error,
                    )
                }
            }
            const catalogStages = [
                ...(catalog.stages ?? []),
                ...modularStages,
            ].filter((stage, index, all) =>
                all.findIndex(candidate => candidate.id === stage.id) === index
            )
            for (const stage of catalogStages) {
                if (!stage.bundleProvenance) continue
                stage.bundleProvenance = normalizeStageBundleProvenance(
                    stage.bundleProvenance,
                )
                validateStageBundleProvenance(
                    stage.bundleProvenance,
                    stage.assetBundleName,
                )
            }
            definitions = [
                ...builtInStages,
                ...catalogStages.filter(stage =>
                    !builtInStages.some(builtIn => builtIn.id === stage.id)
                ),
            ]
            console.log('Loaded stage catalog:', {
                version: catalog.version,
                generatedAt: catalog.generatedAt,
                sourceRevision: catalog.sourceRevision,
                total: catalogStages.length,
                modular: modularStages.length,
                official: catalogStages.filter(stage => stage.official).length,
            })
        }
    } catch (error) {
        console.warn('Could not load external stage catalog:', error)
    }

    stageSelector.replaceChildren(...definitions.map(definition => {
"""
    new_setup = """export async function setupStageSelector() {
    try {
        const loaded = await loadStageCatalogTree<StageDefinition>(
            './stages/catalog.json',
        )
        const catalog = loaded.root
        for (const error of loaded.errors) {
            console.warn(
                `Could not load stage ${error.kind} ${error.url}: ${error.message}`,
            )
        }
        const catalogStages = loaded.stages.filter((stage, index, all) =>
            all.findIndex(candidate => candidate.id === stage.id) === index
        )
        for (const stage of catalogStages) {
            if (!stage.bundleProvenance) continue
            stage.bundleProvenance = normalizeStageBundleProvenance(
                stage.bundleProvenance,
            )
            validateStageBundleProvenance(
                stage.bundleProvenance,
                stage.assetBundleName,
            )
        }
        definitions = [
            ...builtInStages,
            ...catalogStages.filter(stage =>
                !builtInStages.some(builtIn => builtIn.id === stage.id)
            ),
        ]
        console.log('Loaded stage catalog tree:', {
            version: catalog.version,
            generatedAt: catalog.generatedAt,
            sourceRevision: catalog.sourceRevision,
            catalogs: loaded.catalogCount,
            entries: loaded.entryCount,
            errors: loaded.errors.length,
            total: catalogStages.length,
            official: catalogStages.filter(stage => stage.official).length,
            dynamicRecovered: catalogStages.filter(
                stage => stage.dynamic?.status === 'recovered'
            ).length,
            dynamicPartial: catalogStages.filter(
                stage => stage.dynamic?.status === 'partial'
            ).length,
            dynamicPending: catalogStages.filter(
                stage => stage.dynamic?.status === 'pending'
            ).length,
        })
    } catch (error) {
        console.warn('Could not load external stage catalog:', error)
    }

    stageSelector.replaceChildren(...definitions.map(definition => {
"""
    if old_setup in text:
        text = replace_once(text, old_setup, new_setup, 'setupStageSelector tree loader')
    elif "Loaded stage catalog tree:" not in text:
        raise RuntimeError('setupStageSelector legacy block missing')

    path.write_text(text, encoding='utf-8')


def patch_package() -> None:
    path = Path('package.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    script = data['scripts']['test:release']
    test_name = 'stageCatalog.test.mjs'
    if test_name not in script:
        parts = script.split()
        parts.insert(parts.index('--test') + 1, test_name)
        data['scripts']['test:release'] = ' '.join(parts)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    patch_stages()
    patch_package()
    print('Applied recursive modular scene-corpus loader patch')
