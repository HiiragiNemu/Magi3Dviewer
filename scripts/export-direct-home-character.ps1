param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{6}$')]
    [string]$CharacterId,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [string]$AssetRoot = 'D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles',
    [string]$AssetStudioDirectory = 'D:\magia\ma-ex-data\AssetStudioModCLI',
    [string]$TempRoot = 'D:\magia\tmp\magius-direct-home-export',
    [string]$UnityVersion = '2022.3.62f2'
)

$ErrorActionPreference = 'Stop'

if ($UnityVersion -ne '2022.3.62f2') {
    throw 'JP direct Home export requires Unity 2022.3.62f2'
}

$repository = Split-Path -Parent $PSScriptRoot
$resourceName = "chara_${CharacterId}_model"
$modelBundle = Join-Path $AssetRoot "home\${resourceName}"
$shaderBundle = Join-Path $AssetRoot 'shader\redrive_toon'
$thumbnailBundle = Join-Path $AssetRoot (
    "home\doll_house_character\thumbnail_3d\${CharacterId}_thumbnail"
)
foreach ($path in @($modelBundle, $shaderBundle, $thumbnailBundle)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required local AssetBundle is missing: $path"
    }
}

$output = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) {
    throw "Output directory already exists: $output"
}
$tempRootFull = [System.IO.Path]::GetFullPath($TempRoot)
[System.IO.Directory]::CreateDirectory($tempRootFull) | Out-Null
$staging = Join-Path $tempRootFull ("${resourceName}-" + [guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($staging) | Out-Null
$stagingFull = [System.IO.Path]::GetFullPath($staging)
if (-not $stagingFull.StartsWith($tempRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Staging path escaped the configured temp root: $stagingFull"
}

try {
    Get-ChildItem -LiteralPath $AssetStudioDirectory -Filter '*.dll' | ForEach-Object {
        try {
            [System.Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null
        } catch {
            # Native/helper assemblies are loaded on demand by AssetStudio.
        }
    }

    $manager = [AssetStudio.AssetsManager]::new()
    $manager.SpecifyUnityVersion = [AssetStudio.UnityVersion]::new($UnityVersion)
    [string[]]$paths = @($modelBundle, $shaderBundle)
    $load = [AssetStudio.AssetsManager].GetMethod(
        'LoadFilesAndFolders',
        [type[]]@([string[]])
    )
    $load.Invoke($manager, [object[]]@(, $paths)) | Out-Null
    $process = [AssetStudio.AssetsManager].GetMethod(
        'ProcessAssets',
        [System.Reflection.BindingFlags]'Instance,NonPublic'
    )
    $process.Invoke($manager, @()) | Out-Null

    $objects = @($manager.assetsFileList | ForEach-Object { $_.Objects })
    $root = $objects |
        Where-Object { $_ -is [AssetStudio.GameObject] -and $_.m_Name -eq $resourceName } |
        Select-Object -First 1
    if ($null -eq $root) {
        throw "Model root '$resourceName' was not found"
    }
    [AssetStudio.AnimationClip[]]$clips = @(
        $objects |
            Where-Object { $_ -is [AssetStudio.AnimationClip] } |
            Sort-Object m_Name, m_PathID
    )
    if ($clips.Count -eq 0) {
        throw "No direct Home AnimationClip was found for $CharacterId"
    }

    $fbx = Join-Path $staging "${resourceName}.fbx"
    $converter = [AssetStudio.ModelConverter]::new(
        $root,
        [AssetStudio.ImageFormat]::Png,
        $clips
    )
    if ($converter.AnimationList.Count -ne $clips.Count) {
        throw (
            "Animation conversion identity mismatch for ${CharacterId}: " +
            "source=$($clips.Count) imported=$($converter.AnimationList.Count)"
        )
    }
    [AssetStudio.ModelExporter]::ExportFbx(
        $fbx,
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

    $clipIdentities = @()
    for ($index = 0; $index -lt $clips.Count; $index++) {
        $sourceClip = $clips[$index]
        $importedClip = $converter.AnimationList[$index]
        $clipIdentities += [ordered]@{
            sourceClipPathId = [string]$sourceClip.m_PathID
            sourceName = $sourceClip.m_Name
            importedName = $importedClip.Name
            transformTrackCount = $importedClip.TrackList.Count
        }
    }

    $actions = Join-Path $staging 'home-actions.v1.json'
    $thumbnail = Join-Path $staging "${CharacterId}_thumbnail.png"
    & python (Join-Path $repository 'tools\magius\export_direct_home_character_metadata.py') `
        --character-id $CharacterId `
        --model-bundle $modelBundle `
        --shader-bundle $shaderBundle `
        --thumbnail-bundle $thumbnailBundle `
        --output $actions `
        --thumbnail-output $thumbnail `
        --unity-version $UnityVersion | Out-Null
    if ($LASTEXITCODE) {
        throw "Direct Home metadata extraction failed for $CharacterId"
    }

    $metadata = Get-Content -Raw -Encoding UTF8 -LiteralPath $actions | ConvertFrom-Json
    $metadata | Add-Member -NotePropertyName clipIdentities -NotePropertyValue $clipIdentities
    $metadata | ConvertTo-Json -Depth 100 |
        Set-Content -LiteralPath $actions -Encoding UTF8

    $runtime = Join-Path $staging 'home-animations.json.gz'
    & node (Join-Path $repository 'scripts\build-direct-home-animation-runtime.mjs') `
        $fbx $actions $runtime $CharacterId | Out-Null
    if ($LASTEXITCODE) {
        throw "Direct Home runtime conversion failed for $CharacterId"
    }

    $compressedFbx = Join-Path $staging "${resourceName}.fbx.gz"
    $inputStream = [System.IO.File]::OpenRead($fbx)
    try {
        $outputStream = [System.IO.File]::Create($compressedFbx)
        try {
            $gzip = [System.IO.Compression.GZipStream]::new(
                $outputStream,
                [System.IO.Compression.CompressionLevel]::SmallestSize,
                $true
            )
            try {
                $inputStream.CopyTo($gzip)
            } finally {
                $gzip.Dispose()
            }
        } finally {
            $outputStream.Dispose()
        }
    } finally {
        $inputStream.Dispose()
    }
    Remove-Item -LiteralPath $fbx -Force

    $metadata = Get-Content -Raw -Encoding UTF8 -LiteralPath $actions | ConvertFrom-Json
    $expectedTextures = @($metadata.textureClosure.textures.outputFile | Sort-Object -Unique)
    $missingTextures = @(
        $expectedTextures | Where-Object {
            -not (Test-Path -LiteralPath (Join-Path $staging $_) -PathType Leaf)
        }
    )
    if ($missingTextures.Count -gt 0) {
        throw "Exported texture closure is incomplete: $($missingTextures -join ', ')"
    }
    if ($expectedTextures.Count -ne 9) {
        throw "Expected nine referenced textures, found $($expectedTextures.Count)"
    }

    [System.IO.Directory]::CreateDirectory($output) | Out-Null
    Get-ChildItem -LiteralPath $staging -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $output $_.Name)
    }

    $published = @(Get-ChildItem -LiteralPath $output -File | Sort-Object Name)
    [ordered]@{
        status = 'PASS'
        characterId = [int]$CharacterId
        resourceName = $resourceName
        unityVersion = $UnityVersion
        sourceModelBundle = $modelBundle
        sourceShaderBundle = $shaderBundle
        sourceThumbnailBundle = $thumbnailBundle
        clips = $clips.Count
        textures = $expectedTextures.Count
        output = $output
        files = @($published | ForEach-Object {
            [ordered]@{ name = $_.Name; bytes = $_.Length }
        })
    } | ConvertTo-Json -Depth 6
} finally {
    if (
        (Test-Path -LiteralPath $stagingFull) -and
        $stagingFull.StartsWith($tempRootFull, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        Remove-Item -LiteralPath $stagingFull -Recurse -Force
    }
}
