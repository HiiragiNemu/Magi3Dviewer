param(
    [string[]]$CharacterId,
    [string]$AssetRoot = 'D:\magia\ma-ex-data\gamedata\AssetBundles',
    [string]$ModelRoot = 'magia-exedra-character-three\models',
    [string]$TempRoot = 'D:\magia\tmp\magius-home-runtime',
    [string]$UnityVersion = '2022.3.62f2'
)

$ErrorActionPreference = 'Stop'

if ($UnityVersion -ne '2022.3.62f2') {
    throw 'JP Home runtime export requires Unity 2022.3.62f2'
}

$repository = Split-Path -Parent $PSScriptRoot
$modelRootPath = [System.IO.Path]::GetFullPath((Join-Path $repository $ModelRoot))
$ids = if ($CharacterId) {
    @($CharacterId)
} else {
    @(Get-ChildItem -LiteralPath $modelRootPath -Directory |
        Where-Object Name -Match '^chara_(\d{6})_battle_unit$' |
        ForEach-Object { $_.Name.Substring(6, 6) } |
        Sort-Object)
}

[System.IO.Directory]::CreateDirectory($TempRoot) | Out-Null
$results = foreach ($id in $ids) {
    if ($id -notmatch '^\d{6}$') { throw "Invalid character ID: $id" }
    $modelBundle = Join-Path $AssetRoot "battle\character\chara_${id}_battle_unit"
    $homeBundle = Join-Path $AssetRoot "home\doll_house\chara_${id}01_home"
    $outputDirectory = Join-Path $modelRootPath "chara_${id}_battle_unit"
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        continue
    }
    if (
        -not (Test-Path -LiteralPath $modelBundle -PathType Leaf) -or
        -not (Test-Path -LiteralPath $homeBundle -PathType Leaf)
    ) {
        [pscustomobject]@{
            characterId = [int]$id
            status = 'SKIP_MISSING_LOCAL_BUNDLE'
        }
        continue
    }

    $temporaryFbx = Join-Path $TempRoot "chara_${id}_home.fbx"
    $temporaryAnimation = Join-Path $TempRoot "chara_${id}_home-animations.json.gz"
    $temporaryExpression = Join-Path $TempRoot "chara_${id}_home-expressions.json"
    $temporaryMetadata = Join-Path $TempRoot "chara_${id}_home-actions.json"
    try {
        & (Join-Path $PSScriptRoot 'export-home-animation-fbx.ps1') `
            -CharacterId $id `
            -OutputPath $temporaryFbx `
            -MetadataOutputPath $temporaryMetadata `
            -AssetRoot $AssetRoot `
            -UnityVersion $UnityVersion | Out-Null

        & node (Join-Path $PSScriptRoot 'build-home-animation-runtime.mjs') `
            $temporaryFbx `
            $temporaryAnimation `
            $id `
            $temporaryMetadata | Out-Null
        if ($LASTEXITCODE) { throw "Animation runtime conversion failed for $id" }

        & python (Join-Path $PSScriptRoot 'export-home-expression-runtime.py') `
            --character-id $id `
            --model-bundle $modelBundle `
            --home-bundle $homeBundle `
            --unity-version $UnityVersion `
            --output $temporaryExpression | Out-Null
        if ($LASTEXITCODE) { throw "Expression runtime conversion failed for $id" }

        Move-Item -LiteralPath $temporaryAnimation -Destination (
            Join-Path $outputDirectory 'home-animations.json.gz'
        ) -Force
        Move-Item -LiteralPath $temporaryExpression -Destination (
            Join-Path $outputDirectory 'home-expressions.json'
        ) -Force

        [pscustomobject]@{
            characterId = [int]$id
            status = 'PASS'
            animationBytes = (Get-Item -LiteralPath (
                Join-Path $outputDirectory 'home-animations.json.gz'
            )).Length
            expressionBytes = (Get-Item -LiteralPath (
                Join-Path $outputDirectory 'home-expressions.json'
            )).Length
        }
    } catch {
        [pscustomobject]@{
            characterId = [int]$id
            status = 'FAIL'
            reason = $_.Exception.Message
        }
    } finally {
        @($temporaryFbx, $temporaryAnimation, $temporaryExpression, $temporaryMetadata) |
            ForEach-Object {
                Remove-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue
            }
    }
}

$summary = [ordered]@{
    unityVersion = $UnityVersion
    requested = $ids.Count
    passed = @($results | Where-Object status -EQ 'PASS').Count
    skipped = @($results | Where-Object status -Like 'SKIP_*').Count
    results = @($results)
}
$summary | ConvertTo-Json -Depth 5
