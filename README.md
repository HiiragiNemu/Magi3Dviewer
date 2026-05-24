# Magi3Dviewer

View Magia Exedra 3D character models in the web browser  
Includes all characters from Madoka Magica and Magia Record

Built with [three.js](https://github.com/mrdoob/three.js/)

**Demo: [magi3dviewer.haojiezhe12345.top](https://magi3dviewer.haojiezhe12345.top)**

## Features
- View all 3D character models from the game
- Add multiple characters to the scene, and arrange them
- Play and seek animations, or T-pose without animations
- Custom lighting, includes color, strength and angle
- Take photos with the characters in the real world with camera mode
  - Light changes dynamically with the camera
  - Up to 4K photo quality depending on your hardware
  - Color filters with brightness, contrast, saturation
  - And additionally, AR mode
- Export and share presets

## Screenshots

<img width="520" alt="Screenshot" src="https://github.com/user-attachments/assets/ccebda22-7908-448f-a0dd-e91ba2df4464" />
<img width="280" alt="Camera mode" src="https://github.com/user-attachments/assets/e4b41d5a-b3d3-4243-8d85-328de11374e9" />

## Shaders

### General shader

Source: [general.ts](magia-exedra-character-three/shaders/general.ts)

Each mesh has 3 kinds of material: `color`, `shadow` and `ctrl`.

`color` material is brighter, `shadow` is darker.  
`color` is displayed where light casts upon, otherwise, `shadow` is displayed.

`ctrl` color channel specifications:
- Red: Controls the pre-mix of `color` and `shadow`, to make the diffuse color more cartoonic
- Green: Inverted roughness
- Blue: Metalness
- Alpha: The alpha map for the mesh

The alpha map can be the alpha channel of either `shadow` or `ctrl`, depending on the character.

### Face shader

Source: [face.ts](magia-exedra-character-three/shaders/face.ts)

The face has an additional material `eyehighlight_ctrl`, a grayscale texture containing eye highlight and blushes.  
It uses UV2 (or, UV1 if exported with AssetStudio option "Export all UVs as diffuse maps").
- For eye highlight, pixels that have brightness below 50% are discarded
- For the blush, subtract green + blue from the face material to make it appear red

Face `ctrl` (WIP)

### Hair shader

Source: [hair.ts](magia-exedra-character-three/shaders/hair.ts)

Angel ring (WIP)

### Outline shader

Source: [outline.ts](magia-exedra-character-three/shaders/outline.ts)

### Special shaders

- "Portal" effect inside Ultimate Madoka & Akuma Homura's dresses: [BodyInside.ts](magia-exedra-character-three/shaders/BodyInside.ts)

## Animation

Source: [character.ts](magia-exedra-character-three/character.ts)

Character and its weapon have separate animations.

For example:

```
CommonWait_L    - for body  
CommonWait_L_1  - for weapon 1
CommonWait_L_2  - for weapon 2 (if available)
```

If you want to play `CommonWait`, you should play all the animations above.

Naming:
- `_L` - Animations that play in infinite loops (idle animation)
- `_SE` - Transitions between two idle animations (two `_L`s)

## Reverse engineering

From decrypted asset bundle files, these files may be useful:

| Files | Contains |
| --- | --- |
| `/battle/character/chara_XXXXXX_battle_unit` | Most of the character model files |
| `/dungeon/character/XXXXXX` | Has Madoka School Uniform in earlier versions, but removed later |
| `/shader/` | Shader materials such as `RDToon_AngelRingMap`, `face_ctrl_base` and `face_ctrl_nose` |

Almost everything we need can be exported with [AssetStudio](https://github.com/aelurum/AssetStudio)
- Unity version is `2022.3.21f1`, some of the assets may have the version stripped
- To export models, enable `Export all UVs as diffuse maps`, load a model asset file and select everything in `Asset list`, then use `Export -> Animator + selected AnimationClips`

## Character list

Source: [getStyle3dCharacterMstList.json](magia-exedra-character-three/getStyle3dCharacterMstList.json)

The list may not be up to date with the repository

- 100101 - Madoka Kaname (Magical Girl)
- 100107 - 鹿目まどか/魔法少女
- 113701 - アルティメットまどか/魔法少女
- 100106 - 鹿目まどか/水着
- 100103 - 鹿目まどか/晴着
- 100102 - 鹿目まどか/制服
- 100202 - 暁美ほむら/魔法少女
- 100201 - 暁美ほむら/魔法少女(眼鏡)
- 100203 - 暁美ほむら/魔法少女(リボン)
- 100205 - 暁美ほむら/制服(眼鏡)
- 113801 - 悪魔ほむら/魔法少女
- 100301 - 巴マミ/魔法少女
- 100303 - 巴マミ/水着
- 113901 - ホーリーマミ/魔法少女
- 100302 - 巴マミ/ハロウィン
- 100304 - 巴マミ/パティシエール
- 100305 - 巴マミ/ドッペル
- 100401 - 美樹さやか/魔法少女
- 100402 - 美樹さやか/水着
- 100403 - 美樹さやか/クリスマス
- 100501 - 佐倉杏子/魔法少女
- 100503 - 佐倉杏子/クリスマス
- 100504 - 佐倉杏子/パティシエール
- 100601 - 百江なぎさ/魔法少女
- 100701 - 愛生まばゆ/魔法少女
- 100702 - 愛生まばゆ/魔法少女2
- 100801 - 環いろは/魔法少女
- 100805 - 環いろは/魔法少女(ドッペル)
- 100901 - 七海やちよ/魔法少女
- 101001 - 由比鶴乃/魔法少女
- 101101 - 二葉さな/魔法少女
- 101201 - 深月フェリシア/魔法少女
- 101301 - 梓みふゆ/魔法少女
- 101401 - 十咎ももこ/魔法少女
- 101501 - 水波レナ/魔法少女
- 101601 - 秋野かえで/魔法少女
- 101701 - 御園かりん/魔法少女
- 101801 - 竜城明日香/魔法少女
- 101901 - 里見灯花/魔法少女
- 102001 - 柊ねむ/魔法少女
- 102101 - アリナ・グレイ/魔法少女
- 102102 - アリナ・グレイ/ハロウィン
- 102201 - 環うい/魔法少女
- 102301 - 和泉十七夜/魔法少女
- 102401 - 八雲みたま/魔法少女
- 102501 - 天音月夜/魔法少女
- 102601 - 天音月咲/魔法少女
- 105801 - 空穂夏希/魔法少女
- 106101 - 常盤ななか/魔法少女
- 106701 - 夏目かこ/魔法少女
- 106801 - 純美雨/魔法少女
- 106901 - 伊吹れいら/魔法少女
- 107001 - 桑水せいか/魔法少女
- 107101 - 相野みと/魔法少女
- 107201 - 粟根こころ/魔法少女
- 107401 - 更紗帆奈/魔法少女
- 107601 - 眞尾ひみか/魔法少女
- 108001 - 五十鈴れん/魔法少女
- 108002 - 五十鈴れん/クリスマス
- 108101 - 静海このは/魔法少女
- 108201 - 遊佐葉月/魔法少女
- 108301 - 三栗あやめ/魔法少女
- 108401 - 加賀見まさら/魔法少女
- 108601 - 綾野梨花/魔法少女
- 108602 - 綾野梨花/クリスマス
- 109001 - 千秋理子/魔法少女
- 109201 - 安名メル/魔法少女
- 109801 - 万年桜のウワサ/魔法少女
- 110401 - 雪野かなえ/魔法少女
- 110701 - アシュリー・テイラー/魔法少女
- 111401 - 入名クシュ/魔法少女
- 111501 - タルト/魔法少女
- 114401 - タルトver.Final
- 111601 - リズ・ホークウッド/魔法少女
- 111701 - メリッサ・ド・ヴィニョル/魔法少女
- 112001 - コルボー/魔法少女
- 112401 - 美国織莉子/魔法少女
- 112501 - 呉キリカ/魔法少女
- 112601 - 千歳ゆま/魔法少女
- 113301 - 浅古小糸/魔法少女
- 114501 - 夜明すみれ/魔法少女
- 114601 - 日暮ふうか/魔法少女
- 114901 - 斧乃木余接/魔法少女 (WIP)
- 115001 - 八九寺真宵/魔法少女
- 115101 - 忍野忍/魔法少女
- 115201 - まどか先輩/魔法少女 (WIP)
