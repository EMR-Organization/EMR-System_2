# Nightly backup (scheduled by setup for 02:00) and on demand. Needs the EMR
# running; when it isn't, the attempt is logged and skipped.
param([switch]$Scheduled)

. (Join-Path $PSScriptRoot 'common.ps1')
Import-EmrEnv | Out-Null
New-Item -ItemType Directory -Force -Path $P.Logs | Out-Null
$log = Join-Path $P.Logs 'backup.log'
Add-Content -LiteralPath $log -Value "--- $(Get-Date -Format o)" -Encoding ASCII
if (-not (Test-PgRunning)) {
    Add-Content -LiteralPath $log -Value 'skipped: the EMR is not running' -Encoding ASCII
    if (-not $Scheduled) { Stop-WithError 'The EMR is not running, so there is nothing to back up right now.' }
    exit 0
}
$script = Join-Path $P.Tools 'backup.mjs'
$output = & $P.Node $script 2>&1
$code = $LASTEXITCODE
$output | ForEach-Object { "$_" } | Add-Content -LiteralPath $log -Encoding ASCII
if (-not $Scheduled) { $output | ForEach-Object { Write-Host "$_" } }
if ($code -ne 0) { Stop-WithError "Backup failed. See $log." }
