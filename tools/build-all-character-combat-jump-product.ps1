param(
    [string]$RepositoryRoot = 'D:\magia\MyProducts\Magius3Dviewer-JP',
    [string]$AuthorityPath = 'D:\magia\MyProducts\Magius3Dviewer-JP\artifacts\research\20260824-all-character-combat-jump\all-character-combat-jump-authority.v1.json',
    [string]$AssetStudioDirectory = 'D:\magia\ma-ex-data\AssetStudioModCLI',
    [string]$UnityVersion = '2022.3.62f2',
    [string[]]$CharacterIds = @()
)

$ErrorActionPreference = 'Stop'
$artifactRoot = Join-Path $RepositoryRoot 'artifacts\verification\20260824-all-character-combat-jump-product'
$stagingRoot = Join-Path $artifactRoot 'build'
$productRoot = Join-Path $RepositoryRoot 'public\character-actions\combat-jump'
$runtimeBuilder = Join-Path $RepositoryRoot 'tools\build-combat-jump-runtime.mjs'

foreach ($path in @($AuthorityPath, $runtimeBuilder)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required input is missing: $path"
    }
}
$authority = Get-Content -LiteralPath $AuthorityPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($authority.schema -ne 'magius.all-character-combat-jump-authority.v1') {
    throw 'Combat/jump authority schema mismatch'
}

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $productRoot 'runtime') -Force | Out-Null
Get-ChildItem -LiteralPath $AssetStudioDirectory -Filter '*.dll' | ForEach-Object {
    try { [Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch {}
}
$load = [AssetStudio.AssetsManager].GetMethod('LoadFilesAndFolders', [type[]]@([string[]]))
$process = [AssetStudio.AssetsManager].GetMethod(
    'ProcessAssets',
    [Reflection.BindingFlags]'Instance,NonPublic'
)

function Get-SequencePhase([int]$Index, [int]$Count) {
    if ($Count -eq 1) { return 'start' }
    if ($Count -eq 2) { return @('start', 'end')[$Index] }
    if ($Count -eq 3) { return @('start', 'loop', 'end')[$Index] }
    return "segment-$($Index + 1)"
}

$buildRecords = @()
$mappedCharacters = @($authority.characters | Where-Object {
    @($_.styles).Count -gt 0 -and
    ($CharacterIds.Count -eq 0 -or [string]$_.characterId -in $CharacterIds)
} | Sort-Object { [int]$_.characterId })
foreach ($character in $mappedCharacters) {
    $characterId = [string]$character.characterId
    $actions = @($authority.actions | Where-Object { [string]$_.characterId -eq $characterId })
    $components = @()
    foreach ($action in $actions) {
        $selected = @($action.timeline.components | Where-Object {
            $_.role -in @('body', 'weapon-a', 'weapon-b')
        })
        foreach ($role in @('body', 'weapon-a', 'weapon-b')) {
            $roleComponents = @($selected | Where-Object { $_.role -eq $role } | Sort-Object segmentStartSeconds, pathId)
            for ($index = 0; $index -lt $roleComponents.Count; $index++) {
                $component = $roleComponents[$index]
                $components += [ordered]@{
                    actionId = [string]$action.id
                    characterId = $characterId
                    styleMstId = [string]$action.styleMstId
                    semantic = [string]$action.semantic
                    skillUniqueId = [string]$action.skillUniqueId
                    skillMstId = [string]$action.skillMstId
                    directionName = [string]$action.directionName
                    bundleLogicalKey = [string]$action.bundleLogicalKey
                    bundlePath = [string]$action.bundlePath
                    role = $role
                    sequencePhase = Get-SequencePhase $index $roleComponents.Count
                    segmentStartSeconds = [double]$component.segmentStartSeconds
                    segmentDurationSeconds = [double]$component.segmentDurationSeconds
                    pathId = [string]$component.pathId
                    name = [string]$component.name
                    durationSeconds = [double]$component.durationSeconds
                    sampleRate = [double]$component.sampleRate
                    genericBindings = [int]$component.genericBindings
                }
            }
        }
    }
    if ($components.Count -eq 0) {
        throw "Mapped combat character $characterId has no body/primary weapon components"
    }

    $modelBundle = [string]$character.modelBundlePath
    $bundlePaths = @($components.bundlePath | Sort-Object -Unique)
    foreach ($path in @($modelBundle) + $bundlePaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required combat bundle is missing: $path"
        }
    }
    $manager = [AssetStudio.AssetsManager]::new()
    try {
        $manager.SpecifyUnityVersion = [AssetStudio.UnityVersion]::new($UnityVersion)
        [string[]]$paths = @($modelBundle) + $bundlePaths
        $load.Invoke($manager, [object[]]@(, $paths)) | Out-Null
        $process.Invoke($manager, @()) | Out-Null
        $objects = @($manager.assetsFileList | ForEach-Object { $_.Objects })
        $modelRootName = [string]$character.rig.modelRootName
        $roots = @($objects | Where-Object {
            $_ -is [AssetStudio.GameObject] -and
            $_.m_Name -eq $modelRootName -and
            [IO.Path]::GetFullPath($_.assetsFile.originalPath) -eq [IO.Path]::GetFullPath($modelBundle)
        })
        if ($roots.Count -ne 1) {
            throw "Expected one model root $modelRootName for $characterId; found $($roots.Count)"
        }

        $selectedClips = @()
        $selectedClipKeys = @()
        $selectedClipByKey = @{}
        foreach ($component in $components) {
            $sourcePath = [IO.Path]::GetFullPath([string]$component.bundlePath)
            $sourceKey = "$sourcePath|$($component.pathId)"
            $component.sourceClipKey = $sourceKey
            if ($selectedClipByKey.ContainsKey($sourceKey)) { continue }
            $matches = @($objects | Where-Object {
                $_ -is [AssetStudio.AnimationClip] -and
                [string]$_.m_PathID -eq [string]$component.pathId -and
                [IO.Path]::GetFullPath($_.assetsFile.originalPath) -eq $sourcePath
            })
            if ($matches.Count -ne 1) {
                throw "Expected one clip $($component.pathId) in $sourcePath; found $($matches.Count)"
            }
            $clip = $matches[0]
            if ($clip.m_Name -ne $component.name) {
                throw "Clip identity mismatch $characterId/$($component.pathId): expected=$($component.name) actual=$($clip.m_Name)"
            }
            $selectedClips += $clip
            $selectedClipKeys += $sourceKey
            $selectedClipByKey[$sourceKey] = $clip
        }
        [AssetStudio.AnimationClip[]]$typedClips = $selectedClips
        $converter = [AssetStudio.ModelConverter]::new(
            $roots[0],
            [AssetStudio.ImageFormat]::Png,
            $typedClips
        )
        if ($converter.AnimationList.Count -ne $typedClips.Count) {
            throw "Animation conversion count mismatch for ${characterId}: uniqueSource=$($typedClips.Count) converted=$($converter.AnimationList.Count)"
        }
        $convertedBySourceKey = @{}
        for ($index = 0; $index -lt $typedClips.Count; $index++) {
            $clip = $typedClips[$index]
            $convertedBySourceKey[$selectedClipKeys[$index]] = [ordered]@{
                importedName = [string]$converter.AnimationList[$index].Name
                importedTrackCount = [int]$converter.AnimationList[$index].TrackList.Count
                durationSeconds = [double]$clip.m_MuscleClip.m_StopTime
                sampleRate = [double]$clip.m_SampleRate
                genericBindings = @($clip.m_ClipBindingConstant.genericBindings).Count
            }
        }
        foreach ($component in $components) {
            $converted = $convertedBySourceKey[[string]$component.sourceClipKey]
            if ($null -eq $converted) { throw "Converted clip mapping is missing for $($component.sourceClipKey)" }
            $component.importedName = [string]$converted.importedName
            $component.importedTrackCount = [int]$converted.importedTrackCount
            $component.durationSeconds = [double]$converted.durationSeconds
            $component.sampleRate = [double]$converted.sampleRate
            $component.genericBindings = [int]$converted.genericBindings
            $safeRole = ([string]$component.role).Replace('-', '_')
            $component.runtimeName = "OfficialCombat_${characterId}_$($component.styleMstId)_$($component.skillUniqueId)_${safeRole}_$($component.sequencePhase)_$($component.pathId)"
        }

        $characterBuildRoot = Join-Path $stagingRoot $characterId
        New-Item -ItemType Directory -Path $characterBuildRoot -Force | Out-Null
        $fbxPath = Join-Path $characterBuildRoot 'combat-jump.fbx'
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

        $metadataPath = Join-Path $characterBuildRoot 'export-metadata.json'
        $metadata = [ordered]@{
            schema = 'magius.combat-jump-export.v1'
            characterId = $characterId
            characterMstId = [string]$character.characterMstId
            modelKey = [string]$character.modelKey
            modelRootName = $modelRootName
            sourceModelBundle = $modelBundle
            rigFingerprint = [string]$character.rig.rigFingerprint
            components = $components
        }
        $metadata | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $metadataPath -Encoding UTF8

        $publicRuntimeDirectory = Join-Path (Join-Path $productRoot 'runtime') $characterId
        New-Item -ItemType Directory -Path $publicRuntimeDirectory -Force | Out-Null
        $runtimePath = Join-Path $publicRuntimeDirectory 'runtime.v1.json.gz'
        $rawRuntimePath = Join-Path $characterBuildRoot 'runtime.v1.json'
        $summaryPath = Join-Path $characterBuildRoot 'runtime-summary.json'
        $literalPath = Join-Path $characterBuildRoot 'runtime-build.literal.txt'
        & node $runtimeBuilder $fbxPath $runtimePath $metadataPath $rawRuntimePath $summaryPath 2>&1 |
            Tee-Object -FilePath $literalPath | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Combat runtime builder failed for $characterId with exit $LASTEXITCODE"
        }
        $browserRuntimePath = Join-Path $publicRuntimeDirectory 'runtime.v1.magius-runtime'
        Copy-Item -LiteralPath $runtimePath -Destination $browserRuntimePath -Force
        $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($summary.status -ne 'PASS' -or [string]$summary.characterId -ne $characterId) {
            throw "Combat runtime identity mismatch for $characterId"
        }
        $buildRecords += [ordered]@{
            characterId = $characterId
            modelKey = [string]$character.modelKey
            fbxPath = $fbxPath
            metadataPath = $metadataPath
            runtimePath = $runtimePath
            browserRuntimePath = $browserRuntimePath
            rawRuntimePath = $rawRuntimePath
            summaryPath = $summaryPath
            componentCount = [int]$summary.componentCount
            clipCount = [int]$summary.clipCount
            jumpCandidateCount = @($summary.jumpCandidates | Where-Object { $_.grade -in @('A', 'B') }).Count
            gzipBytes = [int64]$summary.gzipBytes
        }
    } finally {
        if ($manager -is [IDisposable]) { $manager.Dispose() }
    }
}

$buildRecordPath = Join-Path $artifactRoot 'runtime-build-record.json'
[ordered]@{
    schema = 'magius.all-character-combat-jump-runtime-build.v1'
    authority = $AuthorityPath
    productRoot = $productRoot
    characters = $buildRecords
} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $buildRecordPath -Encoding UTF8

$totalComponents = 0
$totalClips = 0
$totalJumpCandidates = 0
[int64]$totalGzipBytes = 0
foreach ($record in $buildRecords) {
    $totalComponents += [int]$record.componentCount
    $totalClips += [int]$record.clipCount
    $totalJumpCandidates += [int]$record.jumpCandidateCount
    $totalGzipBytes += [int64]$record.gzipBytes
}

[ordered]@{
    status = 'PASS'
    characterRuntimes = @($buildRecords).Count
    components = $totalComponents
    clips = $totalClips
    jumpCandidates = $totalJumpCandidates
    gzipBytes = $totalGzipBytes
    buildRecord = $buildRecordPath
} | ConvertTo-Json -Depth 8
