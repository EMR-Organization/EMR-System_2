# Shared by setup.ps1, run.ps1, stop.ps1 and tool.ps1. Windows PowerShell 5.1
# (built into Windows 10/11), so: no ?? or ternaries, and ASCII only.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$Root = Split-Path -Parent $PSScriptRoot
$P = @{
    App        = Join-Path $Root 'app'
    Tools      = Join-Path $Root 'app\tools'
    Migrations = Join-Path $Root 'app\migrations'
    Node       = Join-Path $Root 'runtime\node\node.exe'
    PgBin      = Join-Path $Root 'runtime\pgsql\bin'
    Caddy      = Join-Path $Root 'runtime\caddy\caddy.exe'
    Config     = Join-Path $Root 'config'
    EnvFile    = Join-Path $Root 'config\emr.env'
    Data       = Join-Path $Root 'data'
    PgData     = Join-Path $Root 'data\pgdata'
    Photos     = Join-Path $Root 'data\photos'
    Backups    = Join-Path $Root 'data\backups'
    Logs       = Join-Path $Root 'data\logs'
    Run        = Join-Path $Root 'data\run'
    CaddyData  = Join-Path $Root 'data\caddy'
    Caddyfile  = Join-Path $Root 'data\run\Caddyfile'
}
$PgPort = 5433      # not 5432, so an existing PostgreSQL install doesn't clash
$AppPort = 3000     # Next.js, on 127.0.0.1 only; Caddy is the only thing on the network

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Note([string]$Message) { Write-Host "    $Message" }
function Write-Warn([string]$Message) { Write-Host "!   $Message" -ForegroundColor Yellow }
function Stop-WithError([string]$Message) {
    Write-Host "X   $Message" -ForegroundColor Red
    exit 1
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-Secret([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($buffer)
    $rng.Dispose()
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Read-EmrEnv {
    $values = [ordered]@{}
    if (-not (Test-Path $P.EnvFile)) { return $values }
    foreach ($line in Get-Content -LiteralPath $P.EnvFile) {
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$') { $values[$Matches[1]] = $Matches[2] }
    }
    return $values
}

function Write-EmrEnv($Values) {
    $lines = @('# HF EMR settings for this laptop, written by setup. Keep this file private.', '# Never copy it to another laptop: each one has its own (only SYNC_KEY is shared).')
    foreach ($k in $Values.Keys) { $lines += "$k=`"$($Values[$k])`"" }
    New-Item -ItemType Directory -Force -Path $P.Config | Out-Null
    Set-Content -LiteralPath $P.EnvFile -Value $lines -Encoding ASCII
}

# Settings into this process's environment, for the programs it starts.
function Import-EmrEnv {
    if (-not (Test-Path $P.EnvFile)) { Stop-WithError 'This laptop is not set up yet. Run setup.bat first.' }
    $values = Read-EmrEnv
    foreach ($k in $values.Keys) { [Environment]::SetEnvironmentVariable($k, $values[$k], 'Process') }
    $env:NODE_ENV = 'production'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    return $values
}

# Only this account (plus SYSTEM and Administrators) can read secrets and data.
function Protect-Folder([string]$Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    $me = "$env:USERDOMAIN\$env:USERNAME"
    & icacls.exe $Path /inheritance:r /grant:r "${me}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn "Could not restrict access to $Path (icacls exit $LASTEXITCODE)." }
}

function Invoke-Tool([string]$Name, [string[]]$ToolArgs = @()) {
    $script = Join-Path $P.Tools "$Name.mjs"
    & $P.Node $script @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)" }
}

# ---------------- PostgreSQL ----------------

function Invoke-PgCtl([string[]]$PgArgs) {
    & (Join-Path $P.PgBin 'pg_ctl.exe') @PgArgs
    return $LASTEXITCODE
}

function Test-PgRunning {
    if (-not (Test-Path (Join-Path $P.PgData 'PG_VERSION'))) { return $false }
    & (Join-Path $P.PgBin 'pg_ctl.exe') status -D $P.PgData *> $null
    return ($LASTEXITCODE -eq 0)
}

function Start-Pg {
    if (Test-PgRunning) { return }
    Write-Step 'Starting the database'
    New-Item -ItemType Directory -Force -Path $P.Logs | Out-Null
    $code = Invoke-PgCtl @('start', '-D', $P.PgData, '-l', (Join-Path $P.Logs 'postgres.log'), '-w', '-t', '90')
    if ($code -ne 0) { Stop-WithError "The database did not start. See $(Join-Path $P.Logs 'postgres.log')." }
}

function Stop-Pg {
    if (-not (Test-PgRunning)) { return }
    Write-Step 'Stopping the database'
    Invoke-PgCtl @('stop', '-D', $P.PgData, '-m', 'fast', '-w', '-t', '60') | Out-Null
}

# ---------------- background programs (app, Caddy) ----------------

# Starts a program with no window, output appended to a log, and remembers its PID.
function Start-Background([string]$Name, [string]$File, [string]$Arguments, [string]$WorkDir) {
    New-Item -ItemType Directory -Force -Path $P.Logs, $P.Run | Out-Null
    $log = Join-Path $P.Logs "$Name.log"
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = "/d /s /c `"`"$File`" $Arguments >> `"$log`" 2>&1`""
    $psi.WorkingDirectory = $WorkDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [Diagnostics.Process]::Start($psi)
    Set-Content -LiteralPath (Join-Path $P.Run "$Name.pid") -Value $proc.Id -Encoding ASCII
    return $proc
}

function Stop-Background([string]$Name) {
    $pidFile = Join-Path $P.Run "$Name.pid"
    if (-not (Test-Path $pidFile)) { return }
    $id = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
        & taskkill.exe /PID $id /T /F *> $null
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

function Test-Background([string]$Name) {
    $pidFile = Join-Path $P.Run "$Name.pid"
    if (-not (Test-Path $pidFile)) { return $false }
    $id = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    return [bool]($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue))
}

function Wait-Http([string]$Url, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop
            if ($r.StatusCode -lt 500) { return $true }
        } catch {
            $resp = $_.Exception.Response
            if ($resp -and [int]$resp.StatusCode -lt 500) { return $true }
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Test-Port([string]$Address, [int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync($Address, $Port)
        return ($task.Wait(2000) -and $client.Connected)
    } catch { return $false } finally { $client.Dispose() }
}

# ---------------- network ----------------

# The address phones should use: the Wi-Fi adapter's IPv4 address if there is
# one (travel router or hotspot), else any connected adapter's, skipping
# virtual ones and self-assigned 169.254.x.x addresses.
function Get-LanIp {
    $configs = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object {
            $_.IPv4Address -and $_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' -and
            $_.InterfaceAlias -notmatch 'vEthernet|Hyper-V|VirtualBox|VMware|Loopback|Bluetooth'
        })
    $wifi = @($configs | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|WLAN|Wireless' })
    foreach ($c in ($wifi + $configs)) {
        foreach ($a in @($c.IPv4Address)) {
            if ($a.IPAddress -notlike '169.254.*') { return $a.IPAddress }
        }
    }
    return $null
}

function Get-HubName { return ($env:COMPUTERNAME.ToLower() + '.local') }

# Caddy: HTTPS with its own local certificate authority, in front of the app.
#   hub:        every network interface (the firewall rule limits it to the local subnet)
#   standalone: this laptop only
function Write-Caddyfile([string]$Mode, [string]$Ip) {
    $bind = '127.0.0.1'
    $sites = @('https://localhost')
    if ($Mode -eq 'hub') {
        $bind = '0.0.0.0'
        $sites = @("https://$(Get-HubName)", 'https://localhost')
        if ($Ip) { $sites += "https://$Ip" }
    }
    $storage = $P.CaddyData.Replace('\', '/')
    $content = @"
# Written by start-$Mode each time it starts. Edits here are overwritten.
{
	admin off
	skip_install_trust
	auto_https disable_redirects
	default_bind $bind
	storage file_system "$storage"
	pki {
		ca local {
			name "HF EMR Local Authority"
		}
	}
	log {
		output file "$($P.Logs.Replace('\', '/'))/caddy-access.log"
		level WARN
	}
}

$($sites -join ', ') {
	tls internal
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:$AppPort
}
"@
    New-Item -ItemType Directory -Force -Path $P.Run | Out-Null
    Set-Content -LiteralPath $P.Caddyfile -Value $content -Encoding ASCII
}
