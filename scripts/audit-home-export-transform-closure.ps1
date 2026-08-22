param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{6}$')]
    [string]$CharacterId,

    [string]$AssetRoot = 'D:\magia\ma-ex-data\gamedata\AssetBundles',
    [string]$AssetStudioDirectory = 'D:\magia\ma-ex-data\AssetStudioModCLI',
    [string]$UnityVersion = '2022.3.62f2',
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

Get-ChildItem -LiteralPath $AssetStudioDirectory -Filter '*.dll' | ForEach-Object {
    try { [System.Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch {}
}

$modelBundle = Join-Path $AssetRoot "battle\character\chara_${CharacterId}_battle_unit"
$homeBundle = Join-Path $AssetRoot "home\doll_house\chara_${CharacterId}01_home"
$manager = [AssetStudio.AssetsManager]::new()
$manager.SpecifyUnityVersion = [AssetStudio.UnityVersion]::new($UnityVersion)
$load = [AssetStudio.AssetsManager].GetMethod(
    'LoadFilesAndFolders',
    [type[]]@([string[]])
)
$load.Invoke($manager, [object[]]@(, [string[]]@($modelBundle, $homeBundle))) | Out-Null
$process = [AssetStudio.AssetsManager].GetMethod(
    'ProcessAssets',
    [System.Reflection.BindingFlags]'Instance,NonPublic'
)
$process.Invoke($manager, @()) | Out-Null

$objects = @($manager.assetsFileList | ForEach-Object { $_.Objects })
$root = $objects |
    Where-Object {
        $_ -is [AssetStudio.GameObject] -and
        $_.m_Name -eq "chara_${CharacterId}_battle_unit"
    } |
    Select-Object -First 1
if ($null -eq $root) { throw "Character root was not found: ${CharacterId}" }

$controllers = @($objects | Where-Object {
    $_ -is [AssetStudio.AnimatorOverrideController] -and
    (
        $_.m_Name -like 'HomeOverrideController*' -or
        $_.m_Name -match '^Home_.*_weapon_.*_model$'
    )
})
$clipPathIds = [System.Collections.Generic.HashSet[long]]::new()
foreach ($controller in $controllers) {
    foreach ($mapping in $controller.m_Clips) {
        [AssetStudio.AnimationClip]$clip = $null
        if ($mapping.m_OverrideClip.TryGet([ref]$clip)) {
            $clipPathIds.Add([long]$clip.m_PathID) | Out-Null
        }
    }
}
[AssetStudio.AnimationClip[]]$clips = @($objects | Where-Object {
    $_ -is [AssetStudio.AnimationClip] -and
    $clipPathIds.Contains([long]$_.m_PathID)
})

$sourcePaths = [System.Collections.Generic.HashSet[string]]::new()
function Add-SourceTransformPaths(
    [AssetStudio.Transform]$Transform,
    [string]$ParentPath
) {
    [AssetStudio.GameObject]$gameObject = $null
    if (-not $Transform.m_GameObject.TryGet([ref]$gameObject)) { return }
    $path = if ($ParentPath) { "$ParentPath/$($gameObject.m_Name)" } else { $gameObject.m_Name }
    $sourcePaths.Add($path) | Out-Null
    foreach ($childPointer in $Transform.m_Children) {
        [AssetStudio.Transform]$child = $null
        if ($childPointer.TryGet([ref]$child)) {
            Add-SourceTransformPaths $child $path
        }
    }
}
Add-SourceTransformPaths $root.m_Transform ''

$converter = [AssetStudio.ModelConverter]::new(
    $root,
    [AssetStudio.ImageFormat]::Png,
    $clips
)
$importedPaths = [System.Collections.Generic.HashSet[string]]::new()
function Add-ImportedFramePaths(
    [AssetStudio.ImportedFrame]$Frame,
    [string]$ParentPath
) {
    $path = if ($ParentPath) { "$ParentPath/$($Frame.Name)" } else { $Frame.Name }
    $importedPaths.Add($path) | Out-Null
    for ($index = 0; $index -lt $Frame.Count; $index++) {
        Add-ImportedFramePaths $Frame[$index] $path
    }
}
Add-ImportedFramePaths $converter.RootFrame ''

$bindingPaths = @(
    $converter.AnimationList |
        ForEach-Object { $_.TrackList } |
        ForEach-Object { $_.Path } |
        Sort-Object -Unique
)
$missingSourceFrames = @($sourcePaths | Where-Object { -not $importedPaths.Contains($_) } | Sort-Object)
$missingBindingTargets = @($bindingPaths | Where-Object { -not $importedPaths.Contains($_) } | Sort-Object)

$clipSummary = @($converter.AnimationList | ForEach-Object {
    [ordered]@{
        name = $_.Name
        trackCount = $_.TrackList.Count
        paths = @($_.TrackList.Path | Sort-Object -Unique)
    }
})
$conversionPairs = for ($index = 0; $index -lt $clips.Count; $index++) {
    [ordered]@{
        index = $index
        sourceName = $clips[$index].m_Name
        sourcePathId = [string]$clips[$index].m_PathID
        importedName = if ($index -lt $converter.AnimationList.Count) {
            $converter.AnimationList[$index].Name
        } else { $null }
    }
}
$result = [ordered]@{
    schema = 1
    characterId = [int]$CharacterId
    unityVersion = $UnityVersion
    sourceTransformCount = $sourcePaths.Count
    importedFrameCount = $importedPaths.Count
    animationBindingPathCount = $bindingPaths.Count
    missingSourceFrameCount = $missingSourceFrames.Count
    missingSourceFrames = $missingSourceFrames
    missingBindingTargetCount = $missingBindingTargets.Count
    missingBindingTargets = $missingBindingTargets
    conversionPairs = @($conversionPairs)
    clips = $clipSummary
}
$json = $result | ConvertTo-Json -Depth 8
if ($OutputPath) {
    $fullOutput = [System.IO.Path]::GetFullPath($OutputPath)
    [System.IO.Directory]::CreateDirectory(
        [System.IO.Path]::GetDirectoryName($fullOutput)
    ) | Out-Null
    [System.IO.File]::WriteAllText($fullOutput, "$json`n")
}
$json
