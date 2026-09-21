[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

$runtimeRoots = @(
    (Join-Path $RepositoryRoot 'public\character-actions\native-dungeon'),
    (Join-Path $RepositoryRoot 'public\character-actions\combat-jump\runtime')
)

$sourceFiles = @(
    foreach ($root in $runtimeRoots) {
        if (Test-Path -LiteralPath $root) {
            Get-ChildItem -LiteralPath $root -Recurse -File -Filter 'runtime.v1.json.gz'
        }
    }
)

$written = 0
$unchanged = 0
$totalBytes = [int64]0
foreach ($source in $sourceFiles) {
    $aliasPath = Join-Path $source.DirectoryName 'runtime.v1.magius-runtime'
    $sourceBytes = [IO.File]::ReadAllBytes($source.FullName)
    $totalBytes += $sourceBytes.LongLength
    $matches = $false
    if (Test-Path -LiteralPath $aliasPath) {
        $aliasBytes = [IO.File]::ReadAllBytes($aliasPath)
        $matches = [Linq.Enumerable]::SequenceEqual[byte]($sourceBytes, $aliasBytes)
    }
    if ($matches) {
        $unchanged++
        continue
    }
    [IO.File]::WriteAllBytes($aliasPath, $sourceBytes)
    $verifyBytes = [IO.File]::ReadAllBytes($aliasPath)
    if (-not [Linq.Enumerable]::SequenceEqual[byte]($sourceBytes, $verifyBytes)) {
        throw "Browser runtime alias verification failed: $aliasPath"
    }
    $written++
}

[ordered]@{
    schema = 'magius.action-runtime-browser-alias-sync.v1'
    sourceFiles = $sourceFiles.Count
    written = $written
    unchanged = $unchanged
    totalBytes = $totalBytes
    suffix = '.magius-runtime'
} | ConvertTo-Json -Compress
