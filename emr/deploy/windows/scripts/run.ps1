# Starts the EMR and keeps it running while this window is open.
#   -Mode hub         (start-hub.bat)        phones and laptops on the Wi-Fi use it
#   -Mode standalone  (start-standalone.bat) a fallback laptop on its own: this laptop only
# It restarts the app or Caddy if either stops, and follows the Wi-Fi address
# when it changes (a phone hotspot gives a new one each time).
param([ValidateSet('hub', 'standalone')][string]$Mode = 'hub')

. (Join-Path $PSScriptRoot 'common.ps1')
$Host.UI.RawUI.WindowTitle = "HF EMR ($Mode) - keep this window open"

$settings = Import-EmrEnv
if (-not (Test-Path (Join-Path $P.PgData 'PG_VERSION'))) { Stop-WithError 'No database here yet. Run setup.bat first.' }
if ((Test-Background 'app') -or (Test-Background 'caddy')) {
    Stop-WithError 'The EMR is already running (another start window?). Run stop.bat first if it is stuck.'
}
if ($Mode -eq 'hub' -and $settings['EMR_ROLE'] -eq 'fallback') {
    Write-Warn 'This laptop was set up as a FALLBACK. Use start-standalone.bat unless the hub has failed and this one is replacing it for everyone.'
}

# Caddy keeps its certificates (and its own config autosave) inside data\caddy.
$env:XDG_DATA_HOME = Join-Path $P.CaddyData 'xdg-data'
$env:XDG_CONFIG_HOME = Join-Path $P.CaddyData 'xdg-config'
$env:PORT = "$AppPort"
$env:HOSTNAME = '127.0.0.1'   # the app is reachable from this laptop only; Caddy faces the network

function Start-App {
    Write-Step 'Starting the EMR app'
    Start-Background 'app' $P.Node 'server.js' $P.App | Out-Null
    if (-not (Wait-Http "http://127.0.0.1:$AppPort/login" 120)) {
        Stop-WithError "The app did not start. See $(Join-Path $P.Logs 'app.log')."
    }
}

function Start-Caddy([string]$Ip) {
    Write-Caddyfile $Mode $Ip
    Start-Background 'caddy' $P.Caddy "run --config `"$($P.Caddyfile)`" --adapter caddyfile" $P.Run | Out-Null
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and -not (Test-Port '127.0.0.1' 443)) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Port '127.0.0.1' 443)) {
        Stop-WithError "HTTPS (Caddy) did not start. Is another program using port 443? See $(Join-Path $P.Logs 'caddy.log')."
    }
}

function Show-Banner([string]$Ip) {
    if ($Mode -eq 'standalone') {
        Invoke-Tool 'hub-banner' @('https://localhost')
        Write-Note 'Standalone: only this laptop can use it. Export a sync bundle for the hub afterwards (emr-tool.bat export-bundle).'
        return
    }
    $addresses = @()
    if ($Ip) { $addresses += "https://$Ip" } else { Write-Warn 'No Wi-Fi address found. Connect this laptop to the travel router or hotspot; the address will appear here.' }
    $addresses += "https://$(Get-HubName)"
    Invoke-Tool 'hub-banner' $addresses
}

# Keeps the laptop from sleeping while this window is open (the screen may still turn off).
Add-Type -Namespace HfEmr -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$ES_CONTINUOUS = [uint32]'0x80000000'
$ES_SYSTEM_REQUIRED = [uint32]'0x00000001'

# stop.bat asks this window to stop by leaving this file.
$stopFile = Join-Path $P.Run 'stop-requested'
Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue

$restarts = @()
try {
    Start-Pg
    Write-Step 'Checking for database updates'
    Invoke-Tool 'migrate' @($P.Migrations)
    Start-App
    $ip = $null
    if ($Mode -eq 'hub') { $ip = Get-LanIp }
    Write-Step 'Starting HTTPS'
    Start-Caddy $ip
    [HfEmr.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
    Show-Banner $ip

    while (-not (Test-Path $stopFile)) {
        Start-Sleep -Seconds 5
        if (Test-Path $stopFile) { break }
        if (-not (Test-PgRunning)) {
            Write-Warn 'The database stopped; starting it again.'
            Start-Pg
        }
        if (-not (Test-Background 'app')) {
            $restarts = @($restarts | Where-Object { $_ -gt (Get-Date).AddMinutes(-10) }) + (Get-Date)
            if ($restarts.Count -gt 5) { Stop-WithError "The app keeps stopping. See $(Join-Path $P.Logs 'app.log')." }
            Write-Warn "The app stopped; starting it again. (See $(Join-Path $P.Logs 'app.log').)"
            Start-App
        }
        $newIp = $ip
        if ($Mode -eq 'hub') { $newIp = Get-LanIp }
        if (-not (Test-Background 'caddy') -or $newIp -ne $ip) {
            if ($newIp -ne $ip) { Write-Step "The Wi-Fi address changed to $newIp" } else { Write-Warn 'HTTPS (Caddy) stopped; starting it again.' }
            Stop-Background 'caddy'
            $ip = $newIp
            Start-Caddy $ip
            Show-Banner $ip
        }
    }
} finally {
    [HfEmr.Power]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
    Write-Step 'Stopping the EMR'
    Stop-Background 'caddy'
    Stop-Background 'app'
    Stop-Pg
    Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
}
