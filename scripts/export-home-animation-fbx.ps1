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

$candidateNames = [System.Collections.Generic.HashSet[string]]::new()
$homeWait01Names = [System.Collections.Generic.HashSet[string]]::new()
$bodyOverrides = [ordered]@{}
$weaponHelpers = [System.Collections.Generic.HashSet[string]]::new()
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

        $isBodyState = (
            $controller.m_Name -eq 'HomeOverrideController' -and
            $original.m_Name -match '^Home(?:Wait|Unique)'
        )
        if ($isBodyState -or $isWeaponController) {
            $candidateNames.Add($replacement.m_Name) | Out-Null
        }
        if ($controller.m_Name -eq 'HomeOverrideController') {
            $bodyOverrides[$original.m_Name] = $replacement.m_Name
        }
        if (
            $isWeaponController -and
            $replacement.m_Name -match '^HomeWeapon.*Hide$'
        ) {
            $weaponHelpers.Add($replacement.m_Name) | Out-Null
        }
        if (
            $controller.m_Name -eq 'HomeOverrideController' -and
            $original.m_Name -eq 'HomeWait01Loop'
        ) {
            $homeWait01Names.Add($replacement.m_Name) | Out-Null
        }
    }
}
if ($homeWait01Names.Count -eq 0) {
    throw "HomeWait01Loop has no official override for ${CharacterId}"
}

[AssetStudio.AnimationClip[]]$clips = @(
    $objects | Where-Object {
        $_ -is [AssetStudio.AnimationClip] -and $candidateNames.Contains($_.m_Name)
    }
)
$missing = @($homeWait01Names | Where-Object { $_ -notin $clips.m_Name })
if ($missing.Count -gt 0) {
    throw "Home clips missing for ${CharacterId}: $($missing -join ', ')"
}

foreach ($requiredState in @(
    'HomeWait01Loop',
    'HomeWait02Loop',
    'HomeUnique01Start',
    'HomeUnique01Loop'
)) {
    if (-not $bodyOverrides.Contains($requiredState)) {
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
[AssetStudio.ModelExporter]::ExportFbx(
    $outputFile,
    $converter,
    $false,
    [single]0.25,
    $false,
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
    schema = 1
    characterId = [int]$CharacterId
    unityVersion = $UnityVersion
    source = "home/doll_house/chara_${CharacterId}01_home"
    controllers = @($homeControllers.m_Name | Sort-Object -Unique)
    actions = [ordered]@{
        wait01 = [ordered]@{
            loopFamily = $bodyOverrides['HomeWait01Loop']
        }
        wait02 = [ordered]@{
            loopFamily = $bodyOverrides['HomeWait02Loop']
        }
        unique01 = [ordered]@{
            startFamily = $bodyOverrides['HomeUnique01Start']
            loopFamily = $bodyOverrides['HomeUnique01Loop']
            enterTransitionSeconds = 0.2
            startExitNormalizedTime = 1.0
            startToLoopTransitionSeconds = 0.0
        }
    }
    helpers = @($weaponHelpers | Sort-Object)
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
