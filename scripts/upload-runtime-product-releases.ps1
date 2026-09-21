[CmdletBinding()]
param(
    [string]$Repository = 'HiiragiNemu/Magi3Dviewer',
    [string]$ArtifactRoot = '',
    [ValidateRange(1, 50)]
    [int]$BatchSize = 25,
    [ValidateRange(1, 5)]
    [int]$MaxAttempts = 3,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ArtifactRoot) {
    $ArtifactRoot = Join-Path $repoRoot 'artifacts/release/20260826-runtime-product-release-v1'
}
$ArtifactRoot = [IO.Path]::GetFullPath($ArtifactRoot)
$log = Join-Path $ArtifactRoot 'upload.literal.txt'
$tags = @('runtime-products-v1-a', 'runtime-products-v1-b')

function Get-RemoteAssetNames([string]$Tag) {
    $releaseId = (& gh api "repos/$Repository/releases/tags/$Tag" --jq '.id').Trim()
    if ($LASTEXITCODE -ne 0 -or -not $releaseId) {
        throw "Could not resolve release $Tag"
    }
    $names = @(& gh api --paginate "repos/$Repository/releases/$releaseId/assets?per_page=100" --jq '.[].name')
    if ($LASTEXITCODE -ne 0) {
        throw "Could not list assets for $Tag"
    }
    $set = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($name in $names) {
        if ($name) { [void]$set.Add([string]$name) }
    }
    return ,$set
}

"START=$([DateTimeOffset]::Now.ToString('o'))" | Add-Content -LiteralPath $log
"REPOSITORY=$Repository" | Add-Content -LiteralPath $log
"BATCH_SIZE=$BatchSize" | Add-Content -LiteralPath $log
"DRY_RUN=$($DryRun.IsPresent)" | Add-Content -LiteralPath $log

foreach ($tag in $tags) {
    $directory = Join-Path $ArtifactRoot "assets/$tag"
    $files = @(Get-ChildItem -LiteralPath $directory -Filter '*.zip' -File | Sort-Object Name)
    $remote = Get-RemoteAssetNames $tag
    $missing = @($files | Where-Object { -not $remote.Contains($_.Name) })
    Write-Output "TAG=$tag LOCAL=$($files.Count) REMOTE=$($remote.Count) MISSING=$($missing.Count)"
    "TAG=$tag LOCAL=$($files.Count) REMOTE_BEFORE=$($remote.Count) MISSING_BEFORE=$($missing.Count)" |
        Add-Content -LiteralPath $log

    if ($DryRun) { continue }
    for ($offset = 0; $offset -lt $missing.Count; $offset += $BatchSize) {
        $last = [Math]::Min($offset + $BatchSize - 1, $missing.Count - 1)
        $batch = @($missing[$offset..$last])
        $remaining = @($batch)
        for ($attempt = 1; $attempt -le $MaxAttempts -and $remaining.Count -gt 0; $attempt++) {
            "UPLOAD tag=$tag batch=$($offset + 1)-$($last + 1) attempt=$attempt files=$($remaining.Count)" |
                Add-Content -LiteralPath $log
            $arguments = @('release', 'upload', $tag)
            $arguments += @($remaining | ForEach-Object FullName)
            $arguments += @('--repo', $Repository)
            & gh @arguments 2>&1 | Add-Content -LiteralPath $log
            $uploadExit = $LASTEXITCODE
            $remote = Get-RemoteAssetNames $tag
            $remaining = @($batch | Where-Object { -not $remote.Contains($_.Name) })
            "UPLOAD_RESULT tag=$tag exit=$uploadExit remote=$($remote.Count) remaining=$($remaining.Count)" |
                Add-Content -LiteralPath $log
            Write-Output "TAG=$tag REMOTE=$($remote.Count)/$($files.Count) BATCH_REMAINING=$($remaining.Count)"
            if ($remaining.Count -gt 0 -and $attempt -lt $MaxAttempts) {
                Start-Sleep -Seconds (2 * $attempt)
            }
        }
        if ($remaining.Count -gt 0) {
            throw "Upload did not close $($remaining.Count) assets for $tag"
        }
    }

    $remote = Get-RemoteAssetNames $tag
    if ($remote.Count -ne $files.Count) {
        throw "Release asset count mismatch for ${tag}: $($remote.Count)/$($files.Count)"
    }
    "TAG_COMPLETE=$tag ASSETS=$($remote.Count)" | Add-Content -LiteralPath $log
}

"END=$([DateTimeOffset]::Now.ToString('o'))" | Add-Content -LiteralPath $log
'EXIT_STATUS=0' | Add-Content -LiteralPath $log
