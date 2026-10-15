# Runs one of the EMR's command-line tools with this laptop's settings, e.g.
#   emr-tool.bat provision-node            (hub: accounts for the fallback laptops)
#   emr-tool.bat load-provision E:\x.hfprov --first-number 5001   (fallback)
#   emr-tool.bat export-bundle             (fallback, when the hub is back)
#   emr-tool.bat create-admin | audit-checkpoint | backup | backup-offsite | restore <file> [--swap]
# Works with the EMR running or stopped: if the database isn't running, it is
# started just for the tool and stopped again afterwards. restore --swap needs
# the EMR stopped (stop.bat), since it replaces the database the app is using.
# No param() block on purpose: every argument (including ones like --first-number) lands in $args untouched.
$Name = ''
$Rest = @()
if ($args.Count -gt 0) { $Name = [string]$args[0] }
if ($args.Count -gt 1) { $Rest = @($args[1..($args.Count - 1)] | ForEach-Object { [string]$_ }) }

. (Join-Path $PSScriptRoot 'common.ps1')
$allowed = @('provision-node', 'load-provision', 'export-bundle', 'create-admin', 'audit-checkpoint', 'backup', 'backup-offsite', 'restore', 'import-legacy')
if (-not $Name -or $allowed -notcontains $Name) {
    Write-Host "Usage: emr-tool.bat <tool> [arguments]"
    Write-Host "Tools: $($allowed -join ', ')"
    exit 1
}
Import-EmrEnv | Out-Null
if ($Name -eq 'restore' -and $Rest -contains '--swap' -and (Test-Port '127.0.0.1' $AppPort)) {
    Stop-WithError 'The EMR is running. Run stop.bat first: --swap replaces the database it is using.'
}
$startedPg = -not (Test-PgRunning)
if ($startedPg) { Start-Pg }
$failure = $null
try {
    Invoke-Tool $Name $Rest
} catch {
    $failure = $_.Exception.Message
}
if ($startedPg) { Stop-Pg }
if ($failure) { Stop-WithError $failure }
