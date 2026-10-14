# Stops the EMR: asks the start window to finish, then makes sure the app,
# Caddy and the database are stopped (also after the window was just closed).
. (Join-Path $PSScriptRoot 'common.ps1')

New-Item -ItemType Directory -Force -Path $P.Run | Out-Null
$stopFile = Join-Path $P.Run 'stop-requested'
Set-Content -LiteralPath $stopFile -Value (Get-Date -Format o) -Encoding ASCII
Write-Step 'Stopping the EMR'
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline -and ((Test-Background 'app') -or (Test-Background 'caddy') -or (Test-PgRunning))) { Start-Sleep -Seconds 1 }
Stop-Background 'caddy'
Stop-Background 'app'
Stop-Pg
Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
Write-Step 'Stopped.'
