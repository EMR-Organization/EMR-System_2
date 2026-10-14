# Runs one of the EMR's command-line tools with this laptop's settings, e.g.
#   emr-tool.bat provision-node            (hub: accounts for the fallback laptops)
#   emr-tool.bat load-provision E:\x.hfprov --first-number 5001   (fallback)
#   emr-tool.bat export-bundle             (fallback, when the hub is back)
#   emr-tool.bat create-admin | audit-checkpoint | backup | restore <file> [--swap]
# The database must be running (start-hub.bat or start-standalone.bat open).
# No param() block on purpose: every argument (including ones like --first-number) lands in $args untouched.
$Name = ''
$Rest = @()
if ($args.Count -gt 0) { $Name = [string]$args[0] }
if ($args.Count -gt 1) { $Rest = @($args[1..($args.Count - 1)] | ForEach-Object { [string]$_ }) }

. (Join-Path $PSScriptRoot 'common.ps1')
$allowed = @('provision-node', 'load-provision', 'export-bundle', 'create-admin', 'audit-checkpoint', 'backup', 'restore', 'import-legacy')
if (-not $Name -or $allowed -notcontains $Name) {
    Write-Host "Usage: emr-tool.bat <tool> [arguments]"
    Write-Host "Tools: $($allowed -join ', ')"
    exit 1
}
Import-EmrEnv | Out-Null
if (-not (Test-PgRunning)) { Stop-WithError 'The database is not running. Start the EMR first (start-hub.bat or start-standalone.bat).' }
try {
    Invoke-Tool $Name $Rest
} catch {
    Stop-WithError $_.Exception.Message
}
