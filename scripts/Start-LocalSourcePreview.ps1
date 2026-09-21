param(
  [int]$Port = 6595,
  [string]$LogDirectory = (Join-Path ([IO.Path]::GetTempPath()) 'magius-local-source-preview')
)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid local preview port' }
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$entry = Join-Path $PSScriptRoot 'local-source-preview.mjs'
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  $owners = @($listeners.OwningProcess | Select-Object -Unique)
  if ($owners.Count -ne 1) { throw "Port $Port has multiple owners; preserving them" }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])"
  if (!$process.CommandLine.Contains($entry)) { throw "Port $Port belongs to another process; preserving it" }
  [pscustomobject]@{event='existing-local-source';pid=$process.ProcessId;root=$root;url="http://127.0.0.1:$Port/?runtimeDelivery=local"} | ConvertTo-Json -Compress
  exit 0
}
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$stdout = Join-Path $LogDirectory "preview-$stamp.stdout.log"
$stderr = Join-Path $LogDirectory "preview-$stamp.stderr.log"
# Launch independently of the temporary command session. Preserve existing
# previews, user applications and occupied ports; never terminate them here.
$process = Start-Process -FilePath $node -ArgumentList @(('"' + $entry + '"'), [string]$Port) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$deadline = (Get-Date).AddSeconds(30)
do {
  $process.Refresh()
  if ($process.HasExited) { throw "Local source exited: $(Get-Content -LiteralPath $stderr -Raw)" }
  if ((Test-Path -LiteralPath $stdout) -and (Select-String -LiteralPath $stdout -Pattern 'local-source-ready' -Quiet)) {
    $head = Invoke-WebRequest -UseBasicParsing -Method Head -Uri "http://127.0.0.1:$Port/?runtimeDelivery=local"
    if ($head.StatusCode -ne 200) { throw "Unexpected source response: $($head.StatusCode)" }
    [pscustomobject]@{event='detached-local-source-ready';pid=$process.Id;root=$root;url="http://127.0.0.1:$Port/?runtimeDelivery=local";stdout=$stdout;stderr=$stderr} | ConvertTo-Json -Compress
    exit 0
  }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
throw "Readiness not observed; inspect PID $($process.Id) and $stderr before taking further action"
