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
    if "from './stageHierarchy'" not in text:
        text = replace_once(
            text,
            "import { loadStageCatalogTree } from './stageCatalog'\n",
            "import { loadStageCatalogTree } from './stageCatalog'\n"
            "import { resolveStageAnchor } from './stageHierarchy'\n",
            'stageHierarchy import',
        )
    if 'anchorPath?: string' not in text:
        text = replace_once(
            text,
            "    /** Existing FBX node whose converted transform drives this light. */\n"
            "    anchorNode?: string\n",
            "    /** Legacy loose FBX node-name anchor. */\n"
            "    anchorNode?: string\n"
            "    /** Exact serialized Unity hierarchy path; preferred when available. */\n"
            "    anchorPath?: string\n",
            'StageLightProfile anchorPath',
        )
    old_anchor = """        const anchor = profile.anchorNode
            ? stageObject.getObjectByName(profile.anchorNode)
            : undefined
"""
    new_anchor = """        const anchor = resolveStageAnchor(stageObject, profile)
"""
    if old_anchor in text:
        text = replace_once(text, old_anchor, new_anchor, 'light anchor resolver')
    elif 'resolveStageAnchor(stageObject, profile)' not in text:
        raise RuntimeError('light anchor resolver anchor missing')

    if 'anchorPath: string | null' not in text:
        text = replace_once(
            text,
            "        anchorNode: string | null\n"
            "        anchorResolved: boolean\n",
            "        anchorNode: string | null\n"
            "        anchorPath: string | null\n"
            "        anchorResolved: boolean\n",
            'debug anchorPath type',
        )
        text = replace_once(
            text,
            "            anchorNode: profile.anchorNode ?? null,\n"
            "            anchorResolved: profile.anchorNode == undefined || anchor != undefined,\n",
            "            anchorNode: profile.anchorNode ?? null,\n"
            "            anchorPath: profile.anchorPath ?? null,\n"
            "            anchorResolved:\n"
            "                (profile.anchorPath == undefined && profile.anchorNode == undefined)\n"
            "                || anchor != undefined,\n",
            'debug anchor resolution',
        )
    path.write_text(text, encoding='utf-8')


def patch_package() -> None:
    path = Path('package.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    script = data['scripts']['test:release']
    test_name = 'stageHierarchy.test.mjs'
    if test_name not in script:
        parts = script.split()
        parts.insert(parts.index('--test') + 1, test_name)
        data['scripts']['test:release'] = ' '.join(parts)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    patch_stages()
    patch_package()
    print('Applied exact stage hierarchy-anchor patch')
