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
    if "from './stageFidelity'" not in text:
        text = replace_once(
            text,
            "import { resolveStageAnchor } from './stageHierarchy'\n",
            "import { resolveStageAnchor } from './stageHierarchy'\n"
            "import {\n"
            "    setupStageFidelityPanel,\n"
            "    updateStageFidelityPanel,\n"
            "    type StageFidelityComponentEvidence,\n"
            "} from './stageFidelity'\n",
            'stage fidelity import',
        )
    if 'fidelity?: {' not in text:
        text = replace_once(
            text,
            "    runtime?: StageRuntimeProfile\n",
            "    runtime?: StageRuntimeProfile\n"
            "    fidelity?: {\n"
            "        components?: StageFidelityComponentEvidence\n"
            "        sourceRevision?: string\n"
            "        generated?: boolean\n"
            "    }\n",
            'StageDefinition fidelity field',
        )
    if 'setupStageFidelityPanel()' not in text:
        text = replace_once(
            text,
            "export async function setupStageSelector() {\n",
            "export async function setupStageSelector() {\n"
            "    setupStageFidelityPanel()\n",
            'setup fidelity panel',
        )
    assignment = 'updateStageFidelityPanel(definition)'
    if text.count(assignment) == 0:
        text = replace_once(
            text,
            "            stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null\n"
            "            stageRoot.userData.stageDynamic = definition.dynamic ?? null\n"
            "            return\n",
            "            stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null\n"
            "            stageRoot.userData.stageDynamic = definition.dynamic ?? null\n"
            "            updateStageFidelityPanel(definition)\n"
            "            return\n",
            'none-stage fidelity update',
        )
        text = replace_once(
            text,
            "        stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null\n"
            "        stageRoot.userData.reDriveVolume = definition.renderProfile?.reDriveVolume ?? null\n",
            "        stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null\n"
            "        updateStageFidelityPanel(definition)\n"
            "        stageRoot.userData.reDriveVolume = definition.renderProfile?.reDriveVolume ?? null\n",
            'loaded-stage fidelity update',
        )
    elif text.count(assignment) != 2:
        raise RuntimeError('expected exactly two stage fidelity updates')
    path.write_text(text, encoding='utf-8')


def patch_style() -> None:
    path = Path('src/viewer/style/index.css')
    text = path.read_text(encoding='utf-8')
    line = "@import url('./stageFidelity.css');\n"
    if line not in text:
        text += '\n' + line
    path.write_text(text, encoding='utf-8')


def patch_localization() -> None:
    path = Path('src/viewer/localization/zhCN.ts')
    text = path.read_text(encoding='utf-8')
    marker = "    'Stage Runtime': '场景运行时',\n"
    if "'Stage fidelity / evidence'" not in text:
        addition = (
            marker
            + "    'Stage fidelity / evidence': '场景还原度／证据',\n"
            + "    'Inspect recovered scene provenance and remaining fidelity gaps': '检查场景来源证据与尚未还原的效果',\n"
            + "    'Stage ID': '场景 ID',\n"
            + "    'Category': '类别',\n"
            + "    'Official asset': '官方资源',\n"
            + "    'Dynamic status': '动态还原状态',\n"
            + "    'Region': '地区版本',\n"
            + "    'AssetBundle': 'AssetBundle',\n"
            + "    'Manifest sources': 'Manifest 来源数',\n"
            + "    'Direct dependencies': '直接依赖',\n"
            + "    'Dependency closure': '完整依赖闭包',\n"
            + "    'Closure SHA-256': '依赖闭包 SHA-256',\n"
            + "    'Render profile': '渲染配置来源',\n"
            + "    'Recovered components': '已恢复组件',\n"
            + "    'Lightmap': '光照贴图',\n"
            + "    'Environment map': '环境反射贴图',\n"
            + "    'Runtime clips': '运行时动画片段',\n"
            + "    'Typetree errors': 'Typetree 解析错误',\n"
            + "    'Manifest provenance': 'Manifest 来源证据',\n"
            + "    'Remaining fidelity gaps': '尚未还原的效果',\n"
            + "    'Recovered evidence': '已恢复证据',\n"
            + "    'No declared dynamic gaps': '没有已声明的动态缺口',\n"
            + "    'No structured gap list': '尚无结构化缺口清单',\n"
            + "    'No evidence attached': '尚未附加证据',\n"
            + "    'Yes': '是',\n"
            + "    'No': '否',\n"
        )
        text = replace_once(text, marker, addition, 'stage fidelity localization')
    if "Stage fidelity / evidence —" not in text:
        pattern_anchor = "const uiTextPatterns: ReadonlyArray<readonly [RegExp, string]> = [\n"
        pattern = (
            pattern_anchor
            + "    [/^Stage fidelity \/ evidence — (.+)$/, '场景还原度／证据 — $1'],\n"
        )
        text = replace_once(text, pattern_anchor, pattern, 'stage fidelity status pattern')
    path.write_text(text, encoding='utf-8')


def patch_package() -> None:
    path = Path('package.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    script = data['scripts']['test:release']
    test_name = 'stageFidelity.test.mjs'
    if test_name not in script:
        parts = script.split()
        parts.insert(parts.index('--test') + 1, test_name)
        data['scripts']['test:release'] = ' '.join(parts)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    patch_stages()
    patch_style()
    patch_localization()
    patch_package()
    print('Applied stage fidelity inspector integration patch')
