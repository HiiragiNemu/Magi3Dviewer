#!/usr/bin/env python3
from pathlib import Path
import json

STAGES = Path('src/viewer/stages.ts')
CATALOG = Path('public/stages/catalog.json')
STAGE_ID = 'battle-600-00-01-002'
UV1_URL = './stages/official/battle-600-00-01-002/uv1-companion.json'


def replace_once(path: Path, old: str, new: str, label: str):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: {label}: expected 1 literal match, got {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'patched {path}: {label}')


replace_once(
    STAGES,
    """} from './stageLightmaps'\nimport {\n    applyReDriveVolumeRuntime,""",
    """} from './stageLightmaps'\nimport {\n    applyStageUv1Companion,\n    loadStageUv1Companion,\n    type StageUv1Companion,\n} from './stageUv1Companion'\nimport {\n    applyReDriveVolumeRuntime,""",
    'UV1 companion imports',
)

replace_once(
    STAGES,
    """        textureUrl: string\n        bindingsUrl: string\n        encoding: 'unity-rgbm-linear'\n        intensity?: number\n""",
    """        textureUrl: string\n        bindingsUrl: string\n        /** Restores Unity UV1 dropped by the FBX export before lightmap binding. */\n        uv1CompanionUrl?: string\n        encoding: 'unity-rgbm-linear'\n        intensity?: number\n""",
    'lightmap UV1 companion profile field',
)

replace_once(
    STAGES,
    """    lightmap?: THREE.Texture\n    lightmapBindings?: StageLightmapBinding[]\n    lightmapIntensity?: number\n    textures: THREE.Texture[]\n""",
    """    lightmap?: THREE.Texture\n    lightmapBindings?: StageLightmapBinding[]\n    lightmapIntensity?: number\n    uv1Companion?: StageUv1Companion\n    textures: THREE.Texture[]\n""",
    'preloaded UV1 companion field',
)

replace_once(
    STAGES,
    """        updateStageTransform()\n        if (profileTextures.lightmap && profileTextures.lightmapBindings) {\n""",
    """        updateStageTransform()\n        if (profileTextures.uv1Companion) {\n            if (profileTextures.uv1Companion.stageId !== definition.id) {\n                throw new Error(\n                    `Stage UV1 companion targets ${profileTextures.uv1Companion.stageId}, `\n                    + `not ${definition.id}`,\n                )\n            }\n            const uv1Debug = applyStageUv1Companion(\n                object,\n                profileTextures.uv1Companion,\n                { strict: true },\n            )\n            object.userData.stageUv1Companion = uv1Debug\n            stageRoot.userData.stageUv1Companion = uv1Debug\n        }\n        if (profileTextures.lightmap && profileTextures.lightmapBindings) {\n""",
    'inject UV1 before baked lightmap application',
)

replace_once(
    STAGES,
    """        lightmaps:\n            activeStageObject?.userData.stageLightmaps ?? null,\n        officialLights:\n""",
    """        lightmaps:\n            activeStageObject?.userData.stageLightmaps ?? null,\n        uv1Companion:\n            activeStageObject?.userData.stageUv1Companion ?? null,\n        officialLights:\n""",
    'surface UV1 debug state',
)

replace_once(
    STAGES,
    """    stageRoot.userData.stageDynamic = null\n    stageRoot.userData.stageLightmaps = null\n}\n""",
    """    stageRoot.userData.stageDynamic = null\n    stageRoot.userData.stageLightmaps = null\n    stageRoot.userData.stageUv1Companion = null\n}\n""",
    'clear UV1 debug state',
)

replace_once(
    STAGES,
    """            loaded.lightmapBindings = bindingDocument.renderers\n            loaded.lightmapIntensity = profile.lightmap.intensity\n        }\n""",
    """            loaded.lightmapBindings = bindingDocument.renderers\n            loaded.lightmapIntensity = profile.lightmap.intensity\n            if (profile.lightmap.uv1CompanionUrl) {\n                loaded.uv1Companion = await loadStageUv1Companion(\n                    profile.lightmap.uv1CompanionUrl,\n                    signal,\n                )\n            }\n        }\n""",
    'preload UV1 companion document',
)

catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
stages = catalog.get('stages')
if not isinstance(stages, list):
    raise SystemExit('public/stages/catalog.json has no stages array')
matches = [stage for stage in stages if stage.get('id') == STAGE_ID]
if len(matches) != 1:
    raise SystemExit(f'expected exactly one {STAGE_ID} stage, got {len(matches)}')
lightmap = matches[0].get('renderProfile', {}).get('lightmap')
if not isinstance(lightmap, dict):
    raise SystemExit(f'{STAGE_ID} has no renderProfile.lightmap')
if 'uv1CompanionUrl' in lightmap:
    raise SystemExit(f'{STAGE_ID} already has uv1CompanionUrl; refusing duplicate patch')
lightmap['uv1CompanionUrl'] = UV1_URL
CATALOG.write_text(
    json.dumps(catalog, ensure_ascii=False, indent=2) + '\n',
    encoding='utf-8',
)
print(f'patched {CATALOG}: {STAGE_ID} uv1CompanionUrl')

source = STAGES.read_text(encoding='utf-8')
uv1_index = source.find('if (profileTextures.uv1Companion)')
lightmap_index = source.find(
    'if (profileTextures.lightmap && profileTextures.lightmapBindings)',
    uv1_index,
)
if uv1_index < 0 or lightmap_index < 0 or uv1_index >= lightmap_index:
    raise SystemExit('UV1 injection is not ordered before lightmap application')
print('stage 600 UV1 runtime patch complete')
