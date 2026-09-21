param(
    [string]$AssetRoot = 'D:\magia\Madoka Magica Magia Exedra Steam JP\AssetBundles',
    [string]$AssetStudioDirectory = 'D:\magia\ma-ex-data\AssetStudioModCLI',
    [string]$EnemyMasterPath = 'D:\magia\magia_exedra_jp_data\manifests\ja-Jpan\getEnemyMstList.json',
    [string]$CatalogPath = 'D:\magia\.codex-work\steam-fullgallery-runtime-20260820-v4\home\resource-catalogs\steam-ja-Jpan\get_resource_asset_bundle_mst_list.json',
    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\public\enemies\models'),
    [string]$UnityVersion = '2022.3.62f2',
    [string[]]$ModelPrefabName,
    [int]$Limit = 0
)

$ErrorActionPreference = 'Stop'

foreach ($path in @(
    $AssetRoot,
    $AssetStudioDirectory,
    $EnemyMasterPath,
    $CatalogPath
)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required local source is missing: $path"
    }
}

Get-ChildItem -LiteralPath $AssetStudioDirectory -Filter '*.dll' | ForEach-Object {
    try {
        [System.Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null
    } catch {
        # Native/helper assemblies load on demand.
    }
}

$master = Get-Content -LiteralPath $EnemyMasterPath -Raw | ConvertFrom-Json
$masterRows = if ($null -ne $master.payload) {
    @($master.payload.mstList)
} else {
    @($master.mstList)
}

$catalog = Get-Content -LiteralPath $CatalogPath -Raw | ConvertFrom-Json
$catalogPayload = if ($null -ne $catalog.payload) { $catalog.payload } else { $catalog }
$pathById = @{}
foreach ($mapping in $catalogPayload.pathMappingMstList) {
    $pathById[[int]$mapping.pathId] = [string]$mapping.path
}
$bundleByKey = @{}
foreach ($row in $catalogPayload.mstList) {
    $key = "$($pathById[[int]$row.pathId])$($row.name)"
    $bundleByKey[$key] = $row
}

$models = @(
    $masterRows |
        Where-Object { [int]$_.enemyType -ne 4 } |
        Select-Object -ExpandProperty modelPrefabName -Unique |
        Sort-Object
)
if ($ModelPrefabName.Count -gt 0) {
    $requested = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]$ModelPrefabName,
        [System.StringComparer]::Ordinal
    )
    $models = @($models | Where-Object { $requested.Contains($_) })
}
if ($Limit -gt 0) {
    $models = @($models | Select-Object -First $Limit)
}
if ($models.Count -eq 0) {
    throw 'No non-magical-girl enemy models matched the requested filter.'
}

$outputFullPath = [System.IO.Path]::GetFullPath($OutputRoot)
[System.IO.Directory]::CreateDirectory($outputFullPath) | Out-Null

$completed = [System.Collections.Generic.List[object]]::new()
$skipped = [System.Collections.Generic.List[object]]::new()
$failures = [System.Collections.Generic.List[object]]::new()

function Add-AssetBundlePrefix([string]$LogicalKey) {
    return "AssetBundles/$LogicalKey"
}

function Get-NumberProperty($Object, [string]$Name) {
    if ($null -eq $Object.PSObject.Properties[$Name]) { return $null }
    return [double]$Object.$Name
}

foreach ($modelName in $models) {
    $modelDirectory = Join-Path $outputFullPath $modelName
    $runtimePath = Join-Path $modelDirectory 'model-runtime.v1.json'
    $compressedFbxPath = Join-Path $modelDirectory 'VisualRoot.fbxdata'
    if (
        (Test-Path -LiteralPath $runtimePath -PathType Leaf) -and
        (Test-Path -LiteralPath $compressedFbxPath -PathType Leaf)
    ) {
        $skipped.Add([ordered]@{
            modelPrefabName = $modelName
            reason = 'existing-complete-output'
        })
        continue
    }

    $logicalBundleKey = "battle/enemy/$modelName"
    $catalogRow = $bundleByKey[$logicalBundleKey]
    if ($null -eq $catalogRow) {
        $failures.Add([ordered]@{
            modelPrefabName = $modelName
            error = "Steam catalog entry is missing: $logicalBundleKey"
        })
        continue
    }

    $dependencies = @(
        ([string]$catalogRow.dependencies -split ',') |
            Where-Object { $_ -ne '' }
    )
    $loadLogicalKeys = @(
        $logicalBundleKey
        $dependencies | Where-Object { $_ -match '^(model|texture|animator)/' }
    )
    $loadPaths = @(
        $loadLogicalKeys | ForEach-Object {
            $path = Join-Path $AssetRoot ($_ -replace '/', '\')
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
                throw "Local dependency is missing for ${modelName}: $_"
            }
            $path
        }
    )

    $manager = $null
    try {
        [System.IO.Directory]::CreateDirectory($modelDirectory) | Out-Null
        $manager = [AssetStudio.AssetsManager]::new()
        $manager.SpecifyUnityVersion = [AssetStudio.UnityVersion]::new($UnityVersion)
        $loadMethod = [AssetStudio.AssetsManager].GetMethod(
            'LoadFilesAndFolders',
            [type[]]@([string[]])
        )
        $loadMethod.Invoke($manager, [object[]]@(, [string[]]$loadPaths)) | Out-Null
        $processMethod = [AssetStudio.AssetsManager].GetMethod(
            'ProcessAssets',
            [System.Reflection.BindingFlags]'Instance,NonPublic'
        )
        $processMethod.Invoke($manager, @()) | Out-Null

        $objects = @($manager.assetsFileList | ForEach-Object { $_.Objects })
        $root = $objects |
            Where-Object {
                $_ -is [AssetStudio.GameObject] -and $_.m_Name -eq $modelName
            } |
            Select-Object -First 1
        if ($null -eq $root) {
            throw "Model root was not found: $modelName"
        }

        [AssetStudio.AnimationClip[]]$clips = @(
            $objects |
                Where-Object { $_ -is [AssetStudio.AnimationClip] } |
                Sort-Object -Property m_PathID
        )
        $converter = [AssetStudio.ModelConverter]::new(
            $root,
            [AssetStudio.ImageFormat]::Png,
            $clips
        )
        if ($converter.AnimationList.Count -ne $clips.Count) {
            throw "Animation conversion count mismatch: source=$($clips.Count), converted=$($converter.AnimationList.Count)"
        }

        $uncompressedFbxPath = Join-Path $modelDirectory 'VisualRoot.fbx'
        [AssetStudio.ModelExporter]::ExportFbx(
            $uncompressedFbxPath,
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
        if (-not (Test-Path -LiteralPath $uncompressedFbxPath -PathType Leaf)) {
            throw 'AssetStudio did not create VisualRoot.fbx'
        }

        $inputStream = [System.IO.File]::OpenRead($uncompressedFbxPath)
        try {
            $outputStream = [System.IO.File]::Create($compressedFbxPath)
            try {
                $gzipStream = [System.IO.Compression.GZipStream]::new(
                    $outputStream,
                    [System.IO.Compression.CompressionLevel]::Optimal,
                    $true
                )
                try {
                    $inputStream.CopyTo($gzipStream)
                } finally {
                    $gzipStream.Dispose()
                }
            } finally {
                $outputStream.Dispose()
            }
        } finally {
            $inputStream.Dispose()
        }
        Remove-Item -LiteralPath $uncompressedFbxPath

        $clipRecords = @()
        for ($index = 0; $index -lt $clips.Count; $index++) {
            $sourceClip = $clips[$index]
            $importedClip = $converter.AnimationList[$index]
            $clipRecords += [ordered]@{
                pathId = [string]$sourceClip.m_PathID
                sourceName = [string]$sourceClip.m_Name
                runtimeName = [string]$importedClip.Name
                durationSeconds = Get-NumberProperty $sourceClip 'm_StopTime'
                sampleRate = Get-NumberProperty $sourceClip 'm_SampleRate'
                transformTrackCount = [int]$importedClip.TrackList.Count
            }
        }

        $controllers = @(
            $objects |
                Where-Object {
                    $_ -is [AssetStudio.AnimatorController] -or
                    $_ -is [AssetStudio.AnimatorOverrideController]
                } |
                ForEach-Object {
                    [ordered]@{
                        type = $_.GetType().Name
                        pathId = [string]$_.m_PathID
                        name = [string]$_.m_Name
                    }
                } |
                Sort-Object -Property type, pathId
        )
        $materials = @(
            $objects |
                Where-Object { $_ -is [AssetStudio.Material] } |
                ForEach-Object {
                    [ordered]@{
                        pathId = [string]$_.m_PathID
                        name = [string]$_.m_Name
                    }
                } |
                Sort-Object -Property pathId
        )
        $runtime = [ordered]@{
            schema = 'magius.enemy-model-runtime.v1'
            modelPrefabName = $modelName
            unityVersion = $UnityVersion
            rootName = $modelName
            sourceBundleKey = Add-AssetBundlePrefix $logicalBundleKey
            dependencyBundleKeys = @($dependencies | ForEach-Object { Add-AssetBundlePrefix $_ })
            modelBundleKeys = @(
                $dependencies |
                    Where-Object { $_ -like 'model/*' } |
                    ForEach-Object { Add-AssetBundlePrefix $_ }
            )
            animatorBundleKeys = @(
                $dependencies |
                    Where-Object { $_ -like 'animator/*' } |
                    ForEach-Object { Add-AssetBundlePrefix $_ }
            )
            textureBundleKeys = @(
                $dependencies |
                    Where-Object { $_ -like 'texture/*' } |
                    ForEach-Object { Add-AssetBundlePrefix $_ }
            )
            shaderBundleKeys = @(
                $dependencies |
                    Where-Object { $_ -like 'shader/*' } |
                    ForEach-Object { Add-AssetBundlePrefix $_ }
            )
            controllers = $controllers
            clips = $clipRecords
            materials = $materials
            runtime = [ordered]@{
                modelUrl = "/enemies/models/$modelName/VisualRoot.fbxdata"
                textureFiles = @(
                    Get-ChildItem -LiteralPath $modelDirectory -File -Filter '*.png' |
                        Select-Object -ExpandProperty Name |
                        Sort-Object
                )
            }
        }
        $runtime | ConvertTo-Json -Depth 12 |
            Set-Content -LiteralPath $runtimePath -Encoding UTF8

        $completed.Add([ordered]@{
            modelPrefabName = $modelName
            clipCount = $clips.Count
            controllerCount = $controllers.Count
            materialCount = $materials.Count
            compressedBytes = (Get-Item -LiteralPath $compressedFbxPath).Length
        })
        if (($completed.Count % 25) -eq 0) {
            Write-Output "ENEMY_EXPORT_PROGRESS=$($completed.Count)/$($models.Count)"
        }
    } catch {
        $failures.Add([ordered]@{
            modelPrefabName = $modelName
            error = $_.Exception.Message
        })
    } finally {
        if ($null -ne $manager) {
            $manager.Clear()
        }
    }
}

$report = [ordered]@{
    schema = 'magius.enemy-model-build-report.v1'
    requested = $models.Count
    completed = $completed.Count
    skipped = $skipped.Count
    failed = $failures.Count
    completedModels = $completed
    skippedModels = $skipped
    failures = $failures
}
$reportPath = Join-Path $outputFullPath 'build-report.v1.json'
$report | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 5

if ($failures.Count -gt 0) {
    exit 2
}
