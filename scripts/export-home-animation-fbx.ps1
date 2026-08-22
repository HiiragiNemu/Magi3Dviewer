param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{6}$')]
    [string]$CharacterId,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [string]$MetadataOutputPath,

    [string]$AssetRoot = 'D:\magia\ma-ex-data\gamedata\AssetBundles',
    [string]$AssetStudioDirectory = 'D:\magia\ma-ex-data\AssetStudioModCLI',
    [string]$UnityVersion = '2022.3.62f2'
)

$ErrorActionPreference = 'Stop'

$modelBundle = Join-Path $AssetRoot "battle\character\chara_${CharacterId}_battle_unit"
$homeBundle = Join-Path $AssetRoot "home\doll_house\chara_${CharacterId}01_home"
foreach ($path in @($modelBundle, $homeBundle)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required local AssetBundle is missing: $path"
    }
}

Get-ChildItem -LiteralPath $AssetStudioDirectory -Filter '*.dll' | ForEach-Object {
    try {
        [System.Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null
    } catch {
        # Native/helper assemblies are loaded on demand by AssetStudio.
    }
}

$manager = [AssetStudio.AssetsManager]::new()
$manager.SpecifyUnityVersion = [AssetStudio.UnityVersion]::new($UnityVersion)
[string[]]$paths = @($modelBundle, $homeBundle)
$load = [AssetStudio.AssetsManager].GetMethod(
    'LoadFilesAndFolders',
    [type[]]@([string[]])
)
$load.Invoke($manager, [object[]]@(, $paths)) | Out-Null

# LoadFilesAndFolders reads objects; this private post-pass wires GameObject
# component references required by ModelConverter. Calling ReadAssets again
# would duplicate every object in the manager.
$process = [AssetStudio.AssetsManager].GetMethod(
    'ProcessAssets',
    [System.Reflection.BindingFlags]'Instance,NonPublic'
)
$process.Invoke($manager, @()) | Out-Null

$objects = @($manager.assetsFileList | ForEach-Object { $_.Objects })
$rootName = "chara_${CharacterId}_battle_unit"
$root = $objects |
    Where-Object { $_ -is [AssetStudio.GameObject] -and $_.m_Name -eq $rootName } |
    Select-Object -First 1
if ($null -eq $root) {
    throw "Model root '$rootName' was not found"
}

$homeControllers = @(
    $objects | Where-Object {
        $_ -is [AssetStudio.AnimatorOverrideController] -and
        (
            $_.m_Name -like 'HomeOverrideController*' -or
            $_.m_Name -match '^Home_.*_weapon_.*_model$'
        )
    }
)
$primaryController = $homeControllers |
    Where-Object m_Name -EQ 'HomeOverrideController' |
    Select-Object -First 1
if ($null -eq $primaryController) {
    throw "HomeOverrideController was not found for ${CharacterId}"
}

$candidatePathIds = [System.Collections.Generic.HashSet[string]]::new()
$bodyOverrideCandidates = @{}
$weaponHelperPathIds = [System.Collections.Generic.HashSet[string]]::new()
foreach ($controller in $homeControllers) {
    $isWeaponController = (
        $controller.m_Name -like 'HomeOverrideControllerWeapon*' -or
        $controller.m_Name -match '^Home_.*_weapon_.*_model$'
    )
    foreach ($mapping in $controller.m_Clips) {
        [AssetStudio.AnimationClip]$original = $null
        [AssetStudio.AnimationClip]$replacement = $null
        $hasOriginal = $mapping.m_OriginalClip.TryGet([ref]$original)
        $hasReplacement = $mapping.m_OverrideClip.TryGet([ref]$replacement)
        if (-not $hasOriginal -or -not $hasReplacement) { continue }

        $replacementPathId = [string]$replacement.m_PathID

        $isBodyState = (
            $controller.m_Name -eq 'HomeOverrideController' -and
            $original.m_Name -match '^Home(?:Wait|Unique)'
        )
        if ($isBodyState -or $isWeaponController) {
            $candidatePathIds.Add($replacementPathId) | Out-Null
        }
        if ($isBodyState) {
            if (-not $bodyOverrideCandidates.ContainsKey($original.m_Name)) {
                $bodyOverrideCandidates[$original.m_Name] = @()
            }
            $bodyOverrideCandidates[$original.m_Name] += $replacementPathId
        }
        if (
            $isWeaponController -and
            $replacement.m_Name -match '^HomeWeapon.*Hide$'
        ) {
            $weaponHelperPathIds.Add($replacementPathId) | Out-Null
        }
    }
}
if (-not $bodyOverrideCandidates.ContainsKey('HomeWait01Loop')) {
    throw "HomeWait01Loop has no official override for ${CharacterId}"
}

[AssetStudio.AnimationClip[]]$clips = @(
    $objects | Where-Object {
        $_ -is [AssetStudio.AnimationClip] -and
        $candidatePathIds.Contains([string]$_.m_PathID)
    }
)
$loadedClipPathIds = [System.Collections.Generic.HashSet[string]]::new()
$clips | ForEach-Object { $loadedClipPathIds.Add([string]$_.m_PathID) | Out-Null }
$missing = @($candidatePathIds | Where-Object { -not $loadedClipPathIds.Contains($_) })
if ($missing.Count -gt 0) {
    throw "Home clip path IDs missing for ${CharacterId}: $($missing -join ', ')"
}

foreach ($requiredState in @(
    'HomeWait01Loop',
    'HomeWait02Loop',
    'HomeUnique01Start',
    'HomeUnique01Loop'
)) {
    if (-not $bodyOverrideCandidates.ContainsKey($requiredState)) {
        throw "Official Home override is missing ${requiredState} for ${CharacterId}"
    }
}

$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($outputFile)) | Out-Null
$converter = [AssetStudio.ModelConverter]::new(
    $root,
    [AssetStudio.ImageFormat]::Png,
    $clips
)
if ($converter.AnimationList.Count -ne $clips.Count) {
    throw "Animation conversion identity mismatch for ${CharacterId}: source=$($clips.Count) imported=$($converter.AnimationList.Count)"
}
$clipIdentities = @()
$identityByPathId = @{}
for ($index = 0; $index -lt $clips.Count; $index++) {
    $sourceClip = $clips[$index]
    $importedClip = $converter.AnimationList[$index]
    $pathId = [string]$sourceClip.m_PathID
    $identity = [ordered]@{
        sourceClipPathId = $pathId
        sourceName = $sourceClip.m_Name
        importedName = $importedClip.Name
        transformTrackCount = $importedClip.TrackList.Count
    }
    $clipIdentities += $identity
    $identityByPathId[$pathId] = $identity
}

function Resolve-BodyState([string]$State) {
    $candidates = @(
        $bodyOverrideCandidates[$State] |
            ForEach-Object { $identityByPathId[[string]$_] } |
            Where-Object { $null -ne $_ } |
            Sort-Object -Property @{ Expression = 'transformTrackCount'; Descending = $true }, sourceClipPathId
    )
    if ($candidates.Count -eq 0 -or $candidates[0].transformTrackCount -eq 0) {
        throw "Official Home body state ${State} has no model-owned Transform clip for ${CharacterId}"
    }
    if (
        $candidates.Count -gt 1 -and
        $candidates[0].transformTrackCount -eq $candidates[1].transformTrackCount
    ) {
        throw "Official Home body state ${State} is ambiguous for ${CharacterId}: $($candidates[0].sourceClipPathId), $($candidates[1].sourceClipPathId)"
    }
    return $candidates[0]
}

$wait01 = Resolve-BodyState 'HomeWait01Loop'
$wait02 = Resolve-BodyState 'HomeWait02Loop'
$uniqueStart = Resolve-BodyState 'HomeUnique01Start'
$uniqueLoop = Resolve-BodyState 'HomeUnique01Loop'
$weaponHelpers = @(
    $weaponHelperPathIds |
        ForEach-Object { $identityByPathId[[string]$_] } |
        Where-Object { $null -ne $_ } |
        Sort-Object importedName
)
[AssetStudio.ModelExporter]::ExportFbx(
    $outputFile,
    $converter,
    $false,
    [single]0.25,
    # Home clips animate terminal spring/end Transforms that are not always
    # referenced by SkinnedMeshRenderer bones. AssetStudio's allNodes=false
    # export drops those nodes and redirects their curves onto a surviving
    # parent during FBX conversion. Preserve the complete official hierarchy.
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

$result = Get-Item -LiteralPath $outputFile
$metadata = [ordered]@{
    schema = 2
    characterId = [int]$CharacterId
    unityVersion = $UnityVersion
    source = "home/doll_house/chara_${CharacterId}01_home"
    controllers = @($homeControllers.m_Name | Sort-Object -Unique)
    actions = [ordered]@{
        wait01 = [ordered]@{
            loopFamily = $wait01.importedName
            sourceClipPathId = $wait01.sourceClipPathId
        }
        wait02 = [ordered]@{
            loopFamily = $wait02.importedName
            sourceClipPathId = $wait02.sourceClipPathId
        }
        unique01 = [ordered]@{
            startFamily = $uniqueStart.importedName
            startSourceClipPathId = $uniqueStart.sourceClipPathId
            loopFamily = $uniqueLoop.importedName
            loopSourceClipPathId = $uniqueLoop.sourceClipPathId
            enterTransitionSeconds = 0.2
            startExitNormalizedTime = 1.0
            startToLoopTransitionSeconds = 0.0
        }
    }
    helpers = @($weaponHelpers.importedName | Sort-Object -Unique)
    helperSourceClipPathIds = @($weaponHelpers.sourceClipPathId | Sort-Object -Unique)
    clipIdentities = @($clipIdentities)
}
if ($MetadataOutputPath) {
    $metadataFile = [System.IO.Path]::GetFullPath($MetadataOutputPath)
    [System.IO.Directory]::CreateDirectory(
        [System.IO.Path]::GetDirectoryName($metadataFile)
    ) | Out-Null
    $metadata | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $metadataFile -Encoding utf8
}
[ordered]@{
    characterId = [int]$CharacterId
    unityVersion = $UnityVersion
    sourceModelBundle = $modelBundle
    sourceHomeBundle = $homeBundle
    clips = @($clips.m_Name | Sort-Object)
    actions = $metadata.actions
    helpers = $metadata.helpers
    output = $result.FullName
    bytes = $result.Length
} | ConvertTo-Json -Depth 4
