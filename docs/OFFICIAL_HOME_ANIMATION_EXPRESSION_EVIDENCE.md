# Official Home Animation and Expression Evidence

Deterministically generated from four verified JP bundles and the Android AssetBundleManifest. This is source evidence, not a Viewer integration or visual-parity claim.

## Profile

- Release profile: `jp-android-3.13.0`
- Unity: `2022.3.62f2`
- Parser: Python `3.14.6`, UnityPy `1.25.2`
- Every JSON PPtr pathId is a decimal string and carries sourceArtifactId.

## Sources

| ID | Artifact | Bytes | Preverified SHA-256 | Embedded engine | Fallback |
|---|---|---:|---|---|---|
| battle-unit-100107 | `gamedata/AssetBundles/battle/character/chara_100107_battle_unit` | 3139872 | `3146ceffabe46f70c5edbe31f18d1f6ef5a3a7cfc77744207b1e2cdf4df0f326` | `0.0.0` | true |
| battle-unit-101901 | `gamedata/AssetBundles/battle/character/chara_101901_battle_unit` | 4036502 | `15ecddac1e282f63441eed640f47610d5d312ca2d2d98aaccf72976a9f7ece84` | `0.0.0` | true |
| home-10010701 | `gamedata/AssetBundles/home/doll_house/chara_10010701_home` | 334719 | `8940fb2c215f67d2ed2ef50e86140b654e13c0ba147993e51c977aeba30d4e07` | `2022.3.21f1` | false |
| home-10190101 | `gamedata/AssetBundles/home/doll_house/chara_10190101_home` | 231234 | `c46ec96c81a4fc33e41276677f718b4dbe88759baf19032fe391764d7fce6826` | `2022.3.21f1` | false |
| android-manifest | `gamedata/AssetBundles/Android` | 465351 | `c243499e1d304cc14cd1e0abe15f6992d71937e90365e89b03ecbf035cf7b3c8` | `0.0.0` | true |

## Manifest

| Index | Bundle | Hash128 | Dependencies |
|---:|---|---|---|
| 1625 | `battle/character/chara_100107_battle_unit` | `b16b693bacc97dcaf8433d17c3b693a6` | `shader/redrive_toon`, `shader/common/texture/face_ctrl_nose`, `shader/common/texture/matcap_soft_metallic`, `shader/common/texture/face_ctrl_base` |
| 10922 | `home/doll_house/chara_10010701_home` | `f5acf34076ff8cac442010e39917912d` | none |
| 10338 | `battle/character/chara_101901_battle_unit` | `0bfc7b3a725dea3025f33e008af98a8f` | `shader/redrive_toon`, `shader/common/texture/face_ctrl_nose`, `shader/common/texture/matcap_soft_metallic`, `shader/common/texture/face_ctrl_base` |
| 5788 | `home/doll_house/chara_10190101_home` | `aa421842cfc62a10ce5f1ede2d7ca036` | none |

## Shared controller

- Controller raw SHA-256: `273acc4de552374abf2764a9f4954a2283ca8844c6075388062422c624588917` (byte-identical across both homes).
- Weapon A override raw SHA-256: `36321e6f256e4e5b5a08c26ab3fa48f0ac36216c756564f8b45941ab00ee7990`.
- Face path `chara/Face_Mesh` → `2264444960`; weapon path `weapon_a_joint_gp` → `2201715703`.

| Layer | States | Weight | IK | State | Motion PPtr | Loop | Speed | Write defaults |
|---|---:|---:|---|---|---|---|---:|---|
| Main Layer | 16 | 0 | true | Home_Wait01_Loop | `0:6714381589683974879` `HomeWait01Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Wait02_Loop | `0:-980495031503972675` `HomeWait02Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique01_Loop | `0:-2284279228260178658` `HomeUnique01Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique01_Start | `0:5964215842908342138` `HomeUnique01Start` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique02_Loop | `0:7872885287722949501` `HomeUnique02Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique02_Start | `0:-8355316301200657341` `HomeUnique02Start` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique03_Loop | `0:1701777247380773504` `HomeUnique03Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique03_Start | `0:-385882559108824188` `HomeUnique03Start` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique04_Loop | `0:-557659075411433390` `HomeUnique04Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique04_Start | `0:4020364164866771038` `HomeUnique04Start` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Wait01_Loop 0 | `0:6714381589683974879` `HomeWait01Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Wait02_Loop 0 | `0:-980495031503972675` `HomeWait02Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique01_Loop 0 | `0:-2284279228260178658` `HomeUnique01Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique02_Loop 0 | `0:7872885287722949501` `HomeUnique02Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique03_Loop 0 | `0:1701777247380773504` `HomeUnique03Loop` | true | 1 | true |
| Main Layer | 16 | 0 | true | Home_Unique04_Loop 0 | `0:-557659075411433390` `HomeUnique04Loop` | true | 1 | true |
| FaceDefaultLayer | 1 | 1 | false | HomeFaceBase | `0:3548142657838772111` `HomeFace00_Default` | false | 1 | false |
| FaceLayer | 19 | 1 | false | Home_Eye_Empty | `0:-4140605705276937505` `HomeEyeBlinkEmpty` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Home_Eye_Blink | `0:-5274004204392237578` `HomeEyeBlink` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Home_Eye_Empty_1 | `0:-4140605705276937505` `HomeEyeBlinkEmpty` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Home_Eye_BlinkInterval | `0:-4140605705276937505` `HomeEyeBlinkEmpty` | true | 0.400000006 | false |
| FaceLayer | 19 | 1 | false | Face01_Smile | `0:-2137321938390001434` `HomeFace01_Smile` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face02_Smiling | `0:-6116823009687617283` `HomeFace02_Smiling` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face03_Serious | `0:-6625823970581463693` `HomeFace03_Serious` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face04_Annoyed | `0:-3819957614516103561` `HomeFace04_Annoyed` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face05_Furious | `0:-1134722895686562705` `HomeFace05_Furious` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face06_Sorrow | `0:1276941924148744027` `HomeFace06_Sorrow` | false | 1 | false |
| FaceLayer | 19 | 1 | false | Face07_Sadness | `0:1188210925867390764` `HomeFace07_Sadness` | false | 1 | false |
| FaceLayer | 19 | 1 | false | Face08_Troubled | `0:-4760186877790378150` `HomeFace08_Troubled` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face09_Wry | `0:1180628568834169636` `HomeFace09_Wry` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face10_Dumbfounded | `0:-8686780459748704472` `HomeFace10_Dumbfounded` | false | 1 | false |
| FaceLayer | 19 | 1 | false | Face11_Surprised | `0:-1659078003006190974` `HomeFace11_Surprised` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face12_Astonished | `0:4491255320154091954` `HomeFace12_Astonished` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face13_Damage | `0:3963361041692096048` `HomeFace13_Damage` | false | 1 | false |
| FaceLayer | 19 | 1 | false | Face14_Expressionless | `0:-8602570641570351343` `HomeFace14_Expressionless` | true | 1 | false |
| FaceLayer | 19 | 1 | false | Face15_Despair | `0:1786065787060300673` `HomeFace15_Despair` | true | 1 | false |
| MouthLayer | 2 | 1 | false | Home Face Mouth Close | `0:2611841009725937309` `HomeMouthClose` | true | 1 | false |
| MouthLayer | 2 | 1 | false | Home Face Mouth Open | `0:-4379366417813106970` `HomeMouthOpen` | true | 1 | false |

## Character 10010701

- Face hierarchy: `chara_100107_battle_unit/VisualRoot/chara_100107_model/chara_100101/chara/Face_Mesh`
- Face GO `0:2743841755177934764` `Face_Mesh`; SMR `0:2471595367123953118`; Mesh `0:-226490309322120006` `Face_Mesh`.
- 2042 vertices, 60 blend-shape channels, 7308 delta vertices; initial weights `[]`.
- Normal home controller `0:-6733920064041556469` `HomeOverrideController`; Weapon A `0:8613344357354292224` `HomeOverrideControllerWeaponA`; Weapon B `0:0`.

### Override maps

- `HomeOverrideController`: 30 mappings, 10 null.
  - `0:5964215842908342138` `HomeUnique01Start` → `0:2862664547879158896` `HomeUnique01_S`
  - `0:-2284279228260178658` `HomeUnique01Loop` → `0:-3643542253704726174` `HomeUnique01_L`
  - `0:6714381589683974879` `HomeWait01Loop` → `0:-3190735283754005862` `HomeWait01_L`
  - `0:-980495031503972675` `HomeWait02Loop` → `0:3636292846161954040` `HomeWait02_L`
  - `0:3548142657838772111` `HomeFace00_Default` → `0:-7083695359123258505` `Smile`
  - `0:-2137321938390001434` `HomeFace01_Smile` → `0:-7083695359123258505` `Smile`
  - `0:-6116823009687617283` `HomeFace02_Smiling` → `0:-812731270061643128` `Smiling`
  - `0:-6625823970581463693` `HomeFace03_Serious` → `0:3444287688792646781` `Serious`
  - `0:-3819957614516103561` `HomeFace04_Annoyed` → `0:-2176793589294869952` `Annoyed`
  - `0:-1134722895686562705` `HomeFace05_Furious` → `0:2682713001865002935` `Furious`
  - `0:1276941924148744027` `HomeFace06_Sorrow` → `0:-7403956795581118081` `Sorrow`
  - `0:1188210925867390764` `HomeFace07_Sadness` → `0:-5099413555578561315` `Sadness`
  - `0:-4760186877790378150` `HomeFace08_Troubled` → `0:-684164007981734486` `Troubled`
  - `0:-8686780459748704472` `HomeFace10_Dumbfounded` → `0:-393990100613300284` `Dumbfounded`
  - `0:1180628568834169636` `HomeFace09_Wry` → `0:2289400038274700901` `Wry`
  - `0:-1659078003006190974` `HomeFace11_Surprised` → `0:3515543779021431326` `Surprised`
  - `0:4491255320154091954` `HomeFace12_Astonished` → `0:-1402296669702007428` `Astonished`
  - `0:3963361041692096048` `HomeFace13_Damage` → `0:8784790279287087612` `Damage`
  - `0:-8602570641570351343` `HomeFace14_Expressionless` → `0:-346307360800694355` `Expressionless`
  - `0:1786065787060300673` `HomeFace15_Despair` → `0:-8118126183428066204` `Despair`
- `HomeOverrideControllerWeaponA`: 30 mappings, 20 null.
  - `0:5964215842908342138` `HomeUnique01Start` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-2284279228260178658` `HomeUnique01Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:7872885287722949501` `HomeUnique02Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:1701777247380773504` `HomeUnique03Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-557659075411433390` `HomeUnique04Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-8355316301200657341` `HomeUnique02Start` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-385882559108824188` `HomeUnique03Start` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:4020364164866771038` `HomeUnique04Start` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:6714381589683974879` `HomeWait01Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-980495031503972675` `HomeWait02Loop` → `0:-8648084330172903075` `HomeWeaponAHide`

### Expression signatures

Omitted channels are exactly zero; listed constants have min=max=value.

| Expression(s) | Range | Non-zero weights |
|---|---|---|
| Smile, Serious, Furious, Dumbfounded, Damage, Despair | [0, 100] | Bs.Tooth_Back=100 |
| Smiling | [0, 100] | Bs.Eyebrows_Smile_L=90; Bs.Eyebrows_Smile_R=90; Bs.Eyebrows_Down_L=26; Bs.Eyebrows_Down_R=26; Bs.Eyelid_Close_Smile_L=100; Bs.Eyelid_Close_Smile_R=100; Bs.Mouth_Up_L=70; Bs.Mouth_Up_R=70; Bs.Mouth_Narrow=30.0000019; Bs.Tooth_Back=100 |
| Annoyed | [0, 100] | Bs.Eyebrows_Forward_L=35; Bs.Eyebrows_Forward_R=35; Bs.Eyebrows_Down_L=14; Bs.Eyebrows_Down_R=14; Bs.Eyebrows_Outside_Up_L=46; Bs.Eyebrows_Outside_Up_R=46; Bs.Eyebrows_InsideLong_Down_L=72; Bs.Eyebrows_InsideLong_Down_R=72; Bs.Eyelid_Anger_L=100; Bs.Eyelid_Anger_R=100; Bs.Mouth_Down_L=100; Bs.Mouth_Down_R=100; Bs.Mouth_Narrow=100; Bs.Tooth_Back=100 |
| Sorrow | [0, 100] | Bs.Eyebrows_Sad_L=100; Bs.Eyebrows_Sad_R=100; Bs.Eyebrows_Down_L=10; Bs.Eyebrows_Down_R=10; Bs.Eyebrows_Outside_Up_L=8; Bs.Eyebrows_Outside_Up_R=8; Bs.Eyelid_Close_L=16; Bs.Eyelid_Close_R=15.000001; Bs.Eyelid_Sad_L=24; Bs.Eyelid_Sad_R=24; Bs.Mouth_Down_L=80; Bs.Mouth_Down_R=80; Bs.Mouth_Narrow=100; Bs.Tooth_Back=100 |
| Sadness | [0, 100] | Bs.Eyebrows_Sad_L=100; Bs.Eyebrows_Sad_R=100; Bs.Eyebrows_Down_L=52.9999962; Bs.Eyebrows_Down_R=52.9999962; Bs.Eyebrows_Outside_Up_L=8; Bs.Eyebrows_Outside_Up_R=8; Bs.Eyelid_Close_Smile_L=5; Bs.Eyelid_Close_Smile_R=5; Bs.Eyelid_Close_L=20; Bs.Eyelid_Close_R=18.5; Bs.Eyelid_Sad_L=24; Bs.Eyelid_Sad_R=24; Bs.Mouth_Up_L=34; Bs.Mouth_Up_R=34; Bs.Mouth_Down_L=100; Bs.Mouth_Down_R=100; Bs.Mouth_Wide=30.0000019; Bs.Tooth_Back=100 |
| Troubled | [0, 100] | Bs.Eyebrows_Sad_L=100; Bs.Eyebrows_Sad_R=100; Bs.Eyebrows_Up_L=20; Bs.Eyebrows_Up_R=20; Bs.Eyebrows_Inside_Up_L=40; Bs.Eyebrows_Inside_Up_R=40; Bs.Eyebrows_Inside_Down_L=28; Bs.Eyebrows_Inside_Down_R=28; Bs.Eyelid_Sad_L=30.0000019; Bs.Eyelid_Sad_R=30.0000019; Bs.Mouth_Down_L=100; Bs.Mouth_Down_R=100; Bs.Mouth_Narrow=100; Bs.Tooth_Back=100 |
| Wry | [0, 100] | Bs.Eyebrows_Sad_L=100; Bs.Eyebrows_Sad_R=100; Bs.Eyebrows_Down_L=18; Bs.Eyebrows_Down_R=18; Bs.Eyebrows_Outside_Up_L=8; Bs.Eyebrows_Outside_Up_R=8; Bs.Eyebrows_Outside_Down_L=25; Bs.Eyebrows_Outside_Down_R=25; Bs.Eyelid_Close_Smile_L=100; Bs.Eyelid_Close_Smile_R=100; Bs.Mouth_Up_L=45; Bs.Mouth_Up_R=45; Bs.Mouth_Wide=33; Bs.Tooth_Back=100 |
| Surprised | [0, 100] | Bs.Eyebrows_Up_L=18; Bs.Eyebrows_Up_R=18; Bs.Eyelid_Smilethinly_L=20; Bs.Eyelid_Smilethinly_R=20; Bs.Mouth_Down_L=100; Bs.Mouth_Down_R=100; Bs.Mouth_Narrow=100; Bs.Tooth_Back=100 |
| Astonished | [0, 100] | Bs.Eyebrows_Sad_L=100; Bs.Eyebrows_Sad_R=100; Bs.Eyebrows_Up_L=15.000001; Bs.Eyebrows_Up_R=15.000001; Bs.Eyebrows_Outside_Down_L=25; Bs.Eyebrows_Outside_Down_R=25; Bs.Eyebrows_Inside_Up_L=45; Bs.Eyebrows_Inside_Up_R=45; Bs.Eyelid_Smilethinly_L=35; Bs.Eyelid_Smilethinly_R=35; Bs.Pupil_Upset=25; Bs.Mouth_Down_L=48.6033516; Bs.Mouth_Down_R=48.6033516; Bs.Mouth_Narrow=85; Bs.Mouth_OpenVertically_Up=29.0502777; Bs.Mouth_OpenVertically_Down=9.49720669; Bs.Tooth_Back=100 |
| Expressionless | [0, 100] | Bs.Eyebrows_Down_L=8; Bs.Eyebrows_Down_R=8; Bs.Eyelid_Sad_L=22; Bs.Eyelid_Sad_R=22; Bs.Mouth_Down_L=75; Bs.Mouth_Down_R=75; Bs.Mouth_Narrow=100; Bs.Tooth_Back=100 |

### Common face clips

| Clip | pathId | Curves | Stop | Non-zero/explicit ranges |
|---|---:|---:|---:|---|
| HomeFace00_Default | `3548142657838772111` | 62 | 0.133333325 | all zero |
| HomeEyeBlink | `-5274004204392237578` | 4 | 0.100000001 | Bs.Eyelid_Close_L=[100,100]; Bs.Eyelid_Close_R=[100,100]; Bs.Blink_Eyebrows_Down_L=[30.0000019,30.0000019]; Bs.Blink_Eyebrows_Down_R=[30.0000019,30.0000019] |
| HomeEyeBlinkEmpty | `-4140605705276937505` | 2 | 1 | Bs.Eyelid_Close_L=[0,0]; Bs.Eyelid_Close_R=[0,0] |
| HomeMouthOpen | `-4379366417813106970` | 5 | 0.416666657 | Bs.Mouth_OpenVertically=[0,50]; Bs.Tooth_OutUpper=[100,100]; Bs.Tooth_OutUnder=[100,100]; 3651414215=[100,100]; 598414756=[100,100] |
| HomeMouthClose | `2611841009725937309` | 0 | 1 | all zero |

### Transform-only clips

| Clip | pathId | Stop | Bindings/paths | Stored scalar range |
|---|---:|---:|---:|---|
| HomeUnique01_S | `2862664547879158896` | 1.83333337 | 525/175 | [-58.2887459, 6.4351759] |
| HomeUnique01_L | `-3643542253704726174` | 6.14999962 | 525/175 | [-5.90398884, 2.03174615] |
| HomeWait01_L | `-3190735283754005862` | 7.6500001 | 525/175 | [-34.4202499, 4.69470596] |
| HomeWait02_L | `3636292846161954040` | 6.2833333 | 525/175 | [-59.9994431, 16.2453823] |
| HomeWeaponAHide | `-8648084330172903075` | 0.5 | 2/1 | [-10, 0.00999999978] |

## Character 10190101

- Face hierarchy: `chara_101901_battle_unit/VisualRoot/chara_101901_model/chara_101901/chara/Face_Mesh`
- Face GO `0:8294215199608059410` `Face_Mesh`; SMR `0:1041523317171648015`; Mesh `0:1072971811147799282` `Face_Mesh`.
- 2214 vertices, 66 blend-shape channels, 9189 delta vertices; initial weights `[]`.
- Normal home controller `0:-6316830355533956865` `HomeOverrideController`; Weapon A `0:8569661455629535208` `HomeOverrideControllerWeaponA`; Weapon B `0:0`.

### Override maps

- `HomeOverrideController`: 20 mappings, 0 null.
  - `0:5964215842908342138` `HomeUnique01Start` → `0:3950251185120571916` `HomeUnique01_S`
  - `0:6714381589683974879` `HomeWait01Loop` → `0:5020072304884666706` `HomeWait01_L`
  - `0:-980495031503972675` `HomeWait02Loop` → `0:-6120801369692877768` `HomeWait02_L`
  - `0:3548142657838772111` `HomeFace00_Default` → `0:-572487113531304181` `Smile`
  - `0:-2137321938390001434` `HomeFace01_Smile` → `0:-572487113531304181` `Smile`
  - `0:-6116823009687617283` `HomeFace02_Smiling` → `0:-992474747987151196` `Smiling`
  - `0:-6625823970581463693` `HomeFace03_Serious` → `0:-1362993349403603977` `Serious`
  - `0:-3819957614516103561` `HomeFace04_Annoyed` → `0:7267708017452522266` `Annoyed`
  - `0:-1134722895686562705` `HomeFace05_Furious` → `0:-8808279521673516999` `Furious`
  - `0:1276941924148744027` `HomeFace06_Sorrow` → `0:-7272436544998971021` `Sorrow`
  - `0:1188210925867390764` `HomeFace07_Sadness` → `0:1619055946898897934` `Sadness`
  - `0:-4760186877790378150` `HomeFace08_Troubled` → `0:8489166602574992643` `Troubled`
  - `0:-8686780459748704472` `HomeFace10_Dumbfounded` → `0:6905905613681436476` `Dumbfounded`
  - `0:1180628568834169636` `HomeFace09_Wry` → `0:-5931255071167932974` `Wry`
  - `0:-1659078003006190974` `HomeFace11_Surprised` → `0:-5484061153455889835` `Surprised`
  - `0:4491255320154091954` `HomeFace12_Astonished` → `0:1306298501368670706` `Astonished`
  - `0:3963361041692096048` `HomeFace13_Damage` → `0:1973562633832632436` `Damage`
  - `0:-8602570641570351343` `HomeFace14_Expressionless` → `0:8383134052509214689` `Expressionless`
  - `0:1786065787060300673` `HomeFace15_Despair` → `0:7626247204267376723` `Despair`
  - `0:-2284279228260178658` `HomeUnique01Loop` → `0:63976120519086320` `HomeUnique01_L`
- `HomeOverrideControllerWeaponA`: 30 mappings, 20 null.
  - `0:5964215842908342138` `HomeUnique01Start` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-2284279228260178658` `HomeUnique01Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:7872885287722949501` `HomeUnique02Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:1701777247380773504` `HomeUnique03Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-557659075411433390` `HomeUnique04Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-8355316301200657341` `HomeUnique02Start` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-385882559108824188` `HomeUnique03Start` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:4020364164866771038` `HomeUnique04Start` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:6714381589683974879` `HomeWait01Loop` → `0:-8648084330172903075` `HomeWeaponAHide`
  - `0:-980495031503972675` `HomeWait02Loop` → `0:-8648084330172903075` `HomeWeaponAHide`

### Expression signatures

Omitted channels are exactly zero; listed constants have min=max=value.

| Expression(s) | Range | Non-zero weights |
|---|---|---|
| Smile, Serious, Furious, Sadness, Troubled, Wry, Dumbfounded, Astonished, Damage, Expressionless, Despair | [0, 100] | Bs.Eyebrows_Forward_L=50; Bs.Eyebrows_Forward_R=50; Bs.Eyebrows_Smile_L=100; Bs.Eyebrows_Smile_R=100; Bs.Mouth_Up_L=50; Bs.Mouth_Up_R=50; Bs.Mouth_Wide=33.2999992; Bs.Tooth_Back=100 |
| Smiling | [0, 100] | Bs.Eyebrows_Forward_L=8; Bs.Eyebrows_Forward_R=8; Bs.Eyebrows_Smile_L=100; Bs.Eyebrows_Smile_R=100; Bs.Eyebrows_Down_L=32.4137917; Bs.Eyebrows_Down_R=32.4137917; Bs.Eyelid_Close_Smile_L=100; Bs.Eyelid_Close_Smile_R=100; Bs.Mouth_Up_L=100; Bs.Mouth_Up_R=100; Bs.Mouth_Wide=100; Bs.Tooth_Back=100 |
| Annoyed | [0, 100] | Bs.Eyebrows_Forward_L=29.6551743; Bs.Eyebrows_Forward_R=29.6551743; Bs.Eyebrows_Anger_L=100; Bs.Eyebrows_Anger_R=100; Bs.Eyebrows_Up_L=16.5517235; Bs.Eyebrows_Up_R=16.5517235; Bs.Eyelid_Anger_L=100; Bs.Eyelid_Anger_R=100; Bs.Mouth_Down_L=100; Bs.Mouth_Down_R=100; Bs.Tooth_Back=100 |
| Sorrow | [0, 100] | Bs.Eyebrows_Forward_L=15.8620682; Bs.Eyebrows_Forward_R=15.8620682; Bs.Eyebrows_Up_L=11.034483; Bs.Eyebrows_Up_R=11.034483; Bs.Mouth_Down_L=100; Bs.Mouth_Down_R=100; Bs.Mouth_Wide=35.862072; Bs.Tooth_Back=100; Bs.Unique_01=100 |
| Surprised | [0, 100] | Bs.Eyebrows_Forward_L=24.6575336; Bs.Eyebrows_Forward_R=24.6575336; Bs.Eyebrows_Smilethinly_L=23.4482765; Bs.Eyebrows_Smilethinly_R=23.4482765; Bs.Eyebrows_Smile_L=100; Bs.Eyebrows_Smile_R=100; Bs.Eyebrows_Up_L=8.27586174; Bs.Eyebrows_Up_R=8.27586174; Bs.Eyelid_Open_L=100; Bs.Eyelid_Open_R=100; Bs.Eyelid_Anger_L=60.6896591; Bs.Eyelid_Anger_R=60.6896591; Bs.Eyelid_Forward_L=100; Bs.Eyelid_Forward_R=100; Bs.Pupil_Upset=23.9726028; Bs.Mouth_Down_L=54.7945213; Bs.Mouth_Down_R=54.7945213; Bs.Mouth_Narrow=75.3424683; Bs.Tooth_Back=100 |

### Common face clips

| Clip | pathId | Curves | Stop | Non-zero/explicit ranges |
|---|---:|---:|---:|---|
| HomeFace00_Default | `3548142657838772111` | 62 | 0.133333325 | all zero |
| HomeEyeBlink | `-5274004204392237578` | 4 | 0.100000001 | Bs.Eyelid_Close_L=[100,100]; Bs.Eyelid_Close_R=[100,100]; Bs.Blink_Eyebrows_Down_L=[30.0000019,30.0000019]; Bs.Blink_Eyebrows_Down_R=[30.0000019,30.0000019] |
| HomeEyeBlinkEmpty | `-4140605705276937505` | 2 | 1 | Bs.Eyelid_Close_L=[0,0]; Bs.Eyelid_Close_R=[0,0] |
| HomeMouthOpen | `-4379366417813106970` | 5 | 0.416666657 | Bs.Mouth_OpenVertically=[0,50]; Bs.Tooth_OutUpper=[100,100]; Bs.Tooth_OutUnder=[100,100]; 3651414215=[100,100]; 598414756=[100,100] |
| HomeMouthClose | `2611841009725937309` | 0 | 1 | all zero |

### Transform-only clips

| Clip | pathId | Stop | Bindings/paths | Stored scalar range |
|---|---:|---:|---:|---|
| HomeUnique01_S | `3950251185120571916` | 1.89999998 | 567/189 | [-103, 45.0914459] |
| HomeUnique01_L | `63976120519086320` | 2.83333302 | 567/189 | [-103, 45.5198975] |
| HomeWait01_L | `5020072304884666706` | 3.98333335 | 567/189 | [-27.682703, 2.58342934] |
| HomeWait02_L | `-6120801369692877768` | 3.6500001 | 567/189 | [-102.976768, 92.7194595] |
| HomeWeaponAHide | `-8648084330172903075` | 0.5 | 2/1 | [-10, 0.00999999978] |

## Boundaries

- All reported PPtrs are bundle-local FileID 0 and pathId values are decimal strings.
- The shared home controller has four layers and 38 states.
- Expression overrides are constant Face_Mesh snapshots: 60 channels for 100107 and 66 for 101901.
- HomeEyeBlink and HomeMouthOpen are shared state clips; HomeMouthClose is empty.
- Home body clips are Transform-only and contain no blend-shape bindings.
- HomeWeaponAHide targets weapon_a_joint_gp with position and scale bindings.
- Stored curve ranges describe serialized constants and keys, not evaluated cubic extrema unless constant.

## Reproduce

```powershell
python scripts/extract-official-home-animation-evidence.py --asset-root D:\magia\ma-ex-data
```
