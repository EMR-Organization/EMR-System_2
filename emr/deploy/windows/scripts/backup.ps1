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
# 'Continue': Windows PowerShell 5.1 would otherwise stop at the first line node writes to stderr.
$ErrorActionPreference = 'Continue'
$output = & $P.Node $script 2>&1
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$output | ForEach-Object { "$_" } | Add-Content -LiteralPath $log -Encoding ASCII
if (-not $Scheduled) { $output | ForEach-Object { Write-Host "$_" } }
if ($code -ne 0) { Stop-WithError "Backup failed. See $log." }

# Offsite copy (only when OFFSITE_BUCKET is set up). Needs internet, which the hub
# usually doesn't have: a failure is logged and the next run carries on, and it
# never makes the backup itself count as failed.
$offsite = Join-Path $P.Tools 'backup-offsite.mjs'
$ErrorActionPreference = 'Continue'
$output = & $P.Node $offsite --if-configured 2>&1
$offsiteCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$output | ForEach-Object { "$_" } | Add-Content -LiteralPath $log -Encoding ASCII
if (-not $Scheduled) {
    $output | ForEach-Object { Write-Host "$_" }
    if ($offsiteCode -ne 0) { Write-Warn "The backup is saved, but the offsite copy didn't finish (no internet?). It will be tried again after the next backup, or run: emr-tool.bat backup-offsite" }
}
exit 0
