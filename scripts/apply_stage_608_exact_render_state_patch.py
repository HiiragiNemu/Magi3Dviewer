from pathlib import Path
import json

runtime = Path('src/viewer/stageMaterialBindings.ts')
text = runtime.read_text(encoding='utf-8')

old_interface = "    transparent?: boolean\n    unlitness?: number\n"
new_interface = "    transparent?: boolean\n    /** Exact Unity ZWrite state when serialized evidence is available. */\n    depthWrite?: boolean\n    unlitness?: number\n"
if text.count(old_interface) != 1:
    raise SystemExit(f'expected one StageMaterialBinding interface insertion point, got {text.count(old_interface)}')
text = text.replace(old_interface, new_interface, 1)

old_common = "        transparent: binding.transparent ?? false,\n        side,\n"
new_common = "        transparent: binding.transparent ?? false,\n        depthWrite: binding.depthWrite ?? true,\n        side,\n"
if text.count(old_common) != 1:
    raise SystemExit(f'expected one bound-material depthWrite insertion point, got {text.count(old_common)}')
text = text.replace(old_common, new_common, 1)
runtime.write_text(text, encoding='utf-8')
print('patched StageMaterialBinding depthWrite parity')

catalog_path = Path('public/stages/catalog/battle-608-00-00-001.json')
catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
by_name = {entry.get('materialName'): entry for entry in catalog['materialBindings']}

required = {
    'bg3d608_00_blue_ChairCD',
    'mt_bg3d608_00_red_MusicNoteA',
    'mt_bg3d608_00_red_MusicNoteB',
    'mt_bg3d608_00_red_MusicNoteC',
    'mt_bg3d608_00_red_violinCol',
    'mt_bg3d608_00_red_violinShdLine',
}
missing = required.difference(by_name)
if missing:
    raise SystemExit(f'missing 608 material bindings: {sorted(missing)}')

# Current-JP BG Uber serialized render states. Unity Cull=2 is back-face
# culling, i.e. Three FrontSide. Queue 2450 materials are opaque alpha-clipped;
# queue 3000 materials use the normal SrcAlpha/OneMinusSrcAlpha transparent path.
chair = by_name['bg3d608_00_blue_ChairCD']
chair.update({
    'transparent': True,
    'depthWrite': False,
    'side': 'front',
    'alphaToCoverage': False,
})

note_a = by_name['mt_bg3d608_00_red_MusicNoteA']
note_a.update({
    'transparent': False,
    'depthWrite': True,
    'side': 'front',
    'alphaToCoverage': True,
})

for name in ('mt_bg3d608_00_red_MusicNoteB', 'mt_bg3d608_00_red_MusicNoteC'):
    entry = by_name[name]
    entry.update({
        'transparent': False,
        'depthWrite': True,
        'side': 'front',
        'alphaToCoverage': False,
    })

violin_col = by_name['mt_bg3d608_00_red_violinCol']
violin_col.update({
    'transparent': False,
    'depthWrite': True,
    'side': 'front',
    'alphaToCoverage': True,
})

violin_shadow = by_name['mt_bg3d608_00_red_violinShdLine']
violin_shadow.update({
    'transparent': True,
    'depthWrite': False,
    'side': 'front',
    'alphaToCoverage': False,
})

# Keep the existing alpha thresholds and flipbook data intact.
expected_alpha = {
    'bg3d608_00_blue_ChairCD': 0.8999999761581421,
    'mt_bg3d608_00_red_MusicNoteA': 0.10000000149011612,
    'mt_bg3d608_00_red_MusicNoteB': 0.5,
    'mt_bg3d608_00_red_MusicNoteC': 0.699999988079071,
    'mt_bg3d608_00_red_violinCol': 0.5,
    'mt_bg3d608_00_red_violinShdLine': 0.5,
}
for name, alpha in expected_alpha.items():
    actual = by_name[name].get('alphaTest')
    if actual != alpha:
        raise SystemExit(f'{name}: alphaTest changed unexpectedly: {actual!r} != {alpha!r}')

for name in ('mt_bg3d608_00_red_violinCol', 'mt_bg3d608_00_red_violinShdLine'):
    if by_name[name].get('atlas') != {
        'columns': 4,
        'rows': 4,
        'offset': 0,
        'framesPerSecond': 8,
    }:
        raise SystemExit(f'{name}: current-JP flipbook profile was lost')

catalog_path.write_text(
    json.dumps(catalog, ensure_ascii=False, indent=2) + '\n',
    encoding='utf-8',
)
print('patched 608 current-JP render states')
