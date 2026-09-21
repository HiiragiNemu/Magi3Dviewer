param(
    [string]$RepositoryRoot = 'D:\magia\MyProducts\Magius3Dviewer-JP',
    [string]$AuthorityPath = 'D:\magia\MyProducts\Magius3Dviewer-JP\artifacts\research\20260824-official-dungeon-character-roster\official-dungeon-character-roster.v1.json',
    [string]$SupplementalCorpusPath = 'D:\magia\MyProducts\Magius3Dviewer-JP\artifacts\research\20260824-official-dungeon-character-roster\official-dungeon-character-corpus.jp-mobile.json',
    [string]$AssetRoot = 'D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles',
    [string]$AssetStudioDirectory = 'D:\magia\ma-ex-data\AssetStudioModCLI',
    [string]$UnityVersion = '2022.3.62f2'
)

$ErrorActionPreference = 'Stop'
$productRoot = Join-Path $RepositoryRoot 'public\character-actions'
$stagingRoot = Join-Path $RepositoryRoot 'artifacts\verification\20260824-native-dungeon-action-product\build'
$nodeBuilder = Join-Path $RepositoryRoot 'tools\build-native-dungeon-runtime.mjs'
$manifestPath = Join-Path $productRoot 'manifest.v1.json'

foreach ($path in @($AuthorityPath, $SupplementalCorpusPath, $nodeBuilder)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required input is missing: $path"
    }
}

$authority = Get-Content -LiteralPath $AuthorityPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($authority.schema -ne 'magius-official-dungeon-character-roster-v1') {
    throw 'Dungeon roster authority schema mismatch'
}
$supplementalCorpus = Get-Content -LiteralPath $SupplementalCorpusPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($supplementalCorpus.schema -ne 'magius-official-dungeon-character-corpus-v1') {
    throw 'Supplemental Dungeon corpus schema mismatch'
}
$authorityRecords = @($authority.records)
$mami = @($supplementalCorpus.records | Where-Object { [int]$_.sourceCharacterId -eq 100301 })
if ($mami.Count -ne 1) { throw "Expected one exact 100301 supplemental record; found $($mami.Count)" }
if (-not @($authorityRecords | Where-Object { [int]$_.dungeonCharacterId -eq 100301 })) {
    $authorityRecords += [pscustomobject][ordered]@{
        dungeonCharacterId = 100301
        logicalKey = $mami[0].logicalKey
        characterMstId = 1003
        names = [pscustomobject][ordered]@{
            zhHantStyle3d = '巴麻美／魔法少女'
            zhHantCharacter = '巴麻美'
            enStyle3d = 'Mami Tomoe - Magical Girl'
            enCharacter = 'Mami Tomoe'
        }
        controller = $mami[0].controllers[0]
        movementClips = $mami[0].locomotionClips
        regionBundlePresence = [pscustomobject][ordered]@{
            jpMobile = $true
            steamJP = $true
            tw = $true
        }
        externalAttachmentPolicy = $mami[0].externalWeaponPolicy
    }
}
if (@($authorityRecords).Count -ne 9) {
    throw "Expected 9 native Dungeon product records including 100301; found $(@($authorityRecords).Count)"
}

New-Item -ItemType Directory -Path $productRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

Get-ChildItem -LiteralPath $AssetStudioDirectory -Filter '*.dll' | ForEach-Object {
    try { [System.Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch {}
}
$load = [AssetStudio.AssetsManager].GetMethod('LoadFilesAndFolders', [type[]]@([string[]]))
$process = [AssetStudio.AssetsManager].GetMethod(
    'ProcessAssets',
    [System.Reflection.BindingFlags]'Instance,NonPublic'
)

function Get-Semantic([string]$name) {
    if ($name -match 'Walk') { return 'walk' }
    if ($name -match 'Run') { return 'run' }
    return 'idle'
}

function Get-RuntimeName([int]$id, [string]$semantic) {
    $title = [char]::ToUpperInvariant($semantic[0]) + $semantic.Substring(1)
    return "OfficialDungeon_${id}_${title}_L"
}

$manifestEntries = @()
$buildRecords = @()
foreach ($record in @($authorityRecords | Sort-Object dungeonCharacterId)) {
    $id = [int]$record.dungeonCharacterId
    $modelRootName = "chara_${id}_battle_unit"
    $modelKey = "battle/character/$modelRootName"
    $modelBundle = Join-Path $AssetRoot "battle\character\$modelRootName"
    $animationBundle = Join-Path $AssetRoot "dungeon\character\$id"
    foreach ($path in @($modelBundle, $animationBundle)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required native bundle is missing: $path"
        }
    }

    $manager = [AssetStudio.AssetsManager]::new()
    try {
        $manager.SpecifyUnityVersion = [AssetStudio.UnityVersion]::new($UnityVersion)
        [string[]]$paths = @($modelBundle, $animationBundle)
        $load.Invoke($manager, [object[]]@(, $paths)) | Out-Null
        $process.Invoke($manager, @()) | Out-Null
        $objects = @($manager.assetsFileList | ForEach-Object { $_.Objects })
        $root = @($objects | Where-Object {
            $_ -is [AssetStudio.GameObject] -and $_.m_Name -eq $modelRootName
        })
        if ($root.Count -ne 1) {
            throw "Expected exactly one model root $modelRootName; found $($root.Count)"
        }

        $selected = @()
        $clipMetadata = @()
        foreach ($clipRecord in @($record.movementClips)) {
            $matches = @($objects | Where-Object {
                $_ -is [AssetStudio.AnimationClip] -and
                [string]$_.m_PathID -eq [string]$clipRecord.pathID
            })
            if ($matches.Count -ne 1) {
                throw "Expected one clip pathID $($clipRecord.pathID) for $id; found $($matches.Count)"
            }
            $clip = $matches[0]
            if ($clip.m_Name -ne $clipRecord.name) {
                throw "Clip name mismatch for $id/$($clipRecord.pathID): $($clip.m_Name)"
            }
            $semantic = Get-Semantic $clip.m_Name
            $runtimeName = Get-RuntimeName $id $semantic
            $actionId = "official-dungeon:${id}:${semantic}:$($clipRecord.pathID)"
            $selected += $clip
            $clipMetadata += [ordered]@{
                semantic = $semantic
                actionId = $actionId
                sourceClipPathId = [string]$clip.m_PathID
                sourceName = $clip.m_Name
                runtimeName = $runtimeName
                durationSeconds = [double]$clip.m_MuscleClip.m_StopTime
                sampleRate = [double]$clip.m_SampleRate
                genericBindings = @($clip.m_ClipBindingConstant.genericBindings).Count
            }
        }
        if (@($clipMetadata.semantic | Sort-Object -Unique).Count -ne 3) {
            throw "Native Dungeon $id does not provide exactly idle/walk/run"
        }

        $fbxPath = Join-Path $stagingRoot "$id\native-dungeon.fbx"
        $metadataPath = Join-Path $stagingRoot "$id\export-metadata.json"
        $rawRuntimePath = Join-Path $stagingRoot "$id\runtime.v1.json"
        $runtimeDirectory = Join-Path $productRoot "native-dungeon\$id"
        $runtimePath = Join-Path $runtimeDirectory 'runtime.v1.json.gz'
        New-Item -ItemType Directory -Path (Split-Path $fbxPath) -Force | Out-Null
        New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

        [AssetStudio.AnimationClip[]]$typedClips = $selected
        $converter = [AssetStudio.ModelConverter]::new(
            $root[0],
            [AssetStudio.ImageFormat]::Png,
            $typedClips
        )
        if ($converter.AnimationList.Count -ne $typedClips.Count) {
            throw "Animation conversion count mismatch for $id"
        }
        [AssetStudio.ModelExporter]::ExportFbx(
            $fbxPath,
            $converter,
            $false,
            [single]0.25,
            $true,
            $true,
            $true,
            $true,
            $false,
            [single]10,
            $false,
            [single]1,
            3,
            $false
        )

        $exportMetadata = [ordered]@{
            schema = 'magius.native-dungeon-export.v1'
            dungeonCharacterId = $id
            characterMstId = [int]$record.characterMstId
            modelKey = $modelKey
            modelRootName = $modelRootName
            sourceModelBundle = $modelBundle
            sourceAnimationBundle = $animationBundle
            controller = $record.controller
            clips = $clipMetadata
        }
        $exportMetadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadataPath -Encoding UTF8
        $literalPath = Join-Path $stagingRoot "$id\runtime-build.literal.txt"
        & node $nodeBuilder $fbxPath $runtimePath $metadataPath $rawRuntimePath 2>&1 |
            Tee-Object -FilePath $literalPath | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Runtime builder failed for $id with exit $LASTEXITCODE" }
        $browserRuntimePath = Join-Path $runtimeDirectory 'runtime.v1.magius-runtime'
        Copy-Item -LiteralPath $runtimePath -Destination $browserRuntimePath -Force
        $runtime = Get-Content -LiteralPath $rawRuntimePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($runtime.schema -ne 'magius.native-dungeon-action-runtime.v1' -or [int]$runtime.dungeonCharacterId -ne $id) {
            throw "Runtime identity mismatch for $id"
        }

        $displayName = $record.names.zhHantCharacter
        if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = $record.names.zhHantStyle3d }
        if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = $record.names.enCharacter }
        if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = $record.names.enStyle3d }
        foreach ($clip in @($runtime.clips)) {
            $semanticLabel = switch ($clip.semantic) {
                'idle' { '待机' }
                'walk' { '步行' }
                'run' { '跑步' }
            }
            $manifestEntries += [ordered]@{
                id = $clip.actionId
                label = "官方探索动作 / $displayName / $semanticLabel"
                group = '官方探索动作'
                groupId = 'official-dungeon-locomotion'
                playback = 'loop'
                characterIdentity = [ordered]@{
                    dungeonCharacterId = $id
                    characterMstId = [int]$record.characterMstId
                    style3dCharacterMstId = $id
                    modelKey = $modelKey
                    modelRootName = $modelRootName
                }
                availability = [ordered]@{
                    runtimeReady = $true
                    tpsLoadable = $true
                    regions = $record.regionBundlePresence
                }
                clip = [ordered]@{
                    semantic = $clip.semantic
                    sourceName = $clip.sourceName
                    runtimeName = $clip.runtimeName
                    pathId = [string]$clip.sourceClipPathId
                    durationSeconds = [double]$clip.sourceDurationSeconds
                    sampleRate = [double]$clip.sourceSampleRate
                    genericBindings = [int]$clip.sourceGenericBindings
                    serializedTrackCount = @($clip.tracks).Count
                }
                runtime = [ordered]@{
                    url = "/character-actions/native-dungeon/$id/runtime.v1.json.gz"
                    schema = 'magius.native-dungeon-action-runtime.v1'
                }
                sourceFamily = "native-dungeon:$id"
                compatibility = [ordered]@{
                    mode = 'native-only'
                    exactModelKey = $modelKey
                    crossCharacterFallback = $false
                    externalAttachmentPolicy = 'body-only;external-sibling-weapon-excluded'
                    rootPolicy = $runtime.rootPolicy
                }
                motionReference = $clip.motionReference
            }
        }
        $buildRecords += [ordered]@{
            dungeonCharacterId = $id
            fbxPath = $fbxPath
            runtimePath = $runtimePath
            rawRuntimePath = $rawRuntimePath
            actionCount = @($runtime.clips).Count
            referencedNodePathCount = [int]$runtime.compatibility.referencedNodePathCount
        }
    } finally {
        if ($manager -is [System.IDisposable]) { $manager.Dispose() }
    }
}

$manifest = [ordered]@{
    schema = 'magius.character-action-resource-manifest.v1'
    groups = @([ordered]@{
        id = 'official-dungeon-locomotion'
        label = '官方探索动作'
        playback = 'loop'
    })
    counts = [ordered]@{
        distinctCharacters = @($manifestEntries.characterIdentity.characterMstId | Sort-Object -Unique).Count
        dungeonCharacterResources = @($buildRecords).Count
        actions = @($manifestEntries).Count
        runtimeReadyActions = @($manifestEntries | Where-Object { $_.availability.runtimeReady }).Count
        tpsLoadableActions = @($manifestEntries | Where-Object { $_.availability.tpsLoadable }).Count
    }
    identityRule = 'action id + dungeonCharacterId + source AnimationClip.pathID; clip name is descriptive only'
    rootPolicy = 'controlled-viewer-root;suppress-Root.position;preserve-skeleton-curves'
    fallbackPolicy = 'fail-closed;native-model-only;never-cross-character-retarget'
    entries = $manifestEntries
}
$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$buildRecordPath = Join-Path (Split-Path $stagingRoot) 'build-record.json'
[ordered]@{
    schema = 'magius.native-dungeon-action-product-build.v1'
    authority = $AuthorityPath
    manifest = $manifestPath
    records = $buildRecords
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $buildRecordPath -Encoding UTF8

[ordered]@{
    status = 'PASS'
    manifest = $manifestPath
    characters = @($buildRecords).Count
    actions = @($manifestEntries).Count
    buildRecord = $buildRecordPath
} | ConvertTo-Json -Depth 6
