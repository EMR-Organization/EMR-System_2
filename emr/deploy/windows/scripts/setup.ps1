# One-time setup of a laptop (setup.bat). Safe to run again: it keeps existing
# secrets and data and only does what's missing.
#
#   Hub:       setup.bat
#   Fallback:  setup.bat -Role fallback -SyncKeyFile E:\sync-key.txt -ProvisionFile E:\provision.hfprov -FirstNumber 5001
#
# Steps that need administrator rights (firewall rule, renaming the PC) are
# skipped with instructions when it isn't run as administrator.
param(
    [ValidateSet('', 'hub', 'fallback')][string]$Role = '',
    [string]$NodeId = '',
    [string]$EmailDomains = '',
    [string]$SyncKeyFile = '',
    [string]$ProvisionFile = '',
    [int]$FirstNumber = 0,
    # Scripted setup (CI): a file with three lines (name, email, password) for the first admin.
    [string]$AdminFile = '',
    [switch]$NoRename,
    [switch]$NoSchedule,
    # Replace this laptop's HTTPS certificate authority (every device then installs the new one).
    [switch]$NewCertificates,
    [switch]$NonInteractive
)

. (Join-Path $PSScriptRoot 'common.ps1')
$Host.UI.RawUI.WindowTitle = 'HF EMR setup'

function Ask([string]$Question, [string]$Default = '') {
    if ($NonInteractive) { return $Default }
    $suffix = ''
    if ($Default) { $suffix = " [$Default]" }
    $answer = Read-Host "$Question$suffix"
    if (-not $answer) { return $Default }
    return $answer.Trim()
}

function Get-YesNo([string]$Question) {
    if ($NonInteractive) { return $false }
    return ((Read-Host "$Question (y/n)") -match '^[Yy]')
}

# ---------------------------------------------------------------- checks
Write-Step 'Checking this laptop'
if (-not [Environment]::Is64BitOperatingSystem) { Stop-WithError 'This needs 64-bit Windows 10 or 11.' }
if ([Environment]::OSVersion.Version.Major -lt 10) { Stop-WithError 'This needs Windows 10 or 11.' }
foreach ($f in @($P.Node, $P.Caddy, (Join-Path $P.PgBin 'initdb.exe'), (Join-Path $P.App 'server.js'))) {
    if (-not (Test-Path $f)) { Stop-WithError "Missing $f. Copy the whole EMR folder again." }
}
if ($Root -match '[^\x20-\x7E]') { Stop-WithError "Put the EMR folder at a path with plain letters only (e.g. C:\EMR), not $Root." }
$isAdmin = Test-Admin
if (-not $isAdmin) { Write-Note 'Not running as administrator: the firewall rule and PC rename will be skipped, with instructions.' }
if ((Invoke-Quiet (Join-Path $P.PgBin 'postgres.exe') @('--version')) -ne 0) { Stop-WithError 'PostgreSQL cannot run here. Install the Microsoft Visual C++ Redistributable (x64), then run setup again.' }

# ---------------------------------------------------------------- settings
$existing = Read-EmrEnv
$firstRun = ($existing.Count -eq 0)
if (-not $firstRun) {
    Write-Note "Already set up as $($existing['EMR_ROLE']) ($($existing['NODE_ID'])). Keeping its settings and secrets."
    $Role = $existing['EMR_ROLE']
}
while (-not $Role) {
    $Role = (Ask 'Is this laptop the HUB (everyone connects to it) or a FALLBACK (spare, used if the hub fails)? Type hub or fallback').ToLower()
    if ($Role -ne 'hub' -and $Role -ne 'fallback') { $Role = '' }
    if ($NonInteractive -and -not $Role) { Stop-WithError 'Give -Role hub or -Role fallback.' }
}

if ($firstRun) {
    Write-Step "Creating this $Role's settings and secrets"
    if (-not $NodeId) {
        $default = 'hub'
        if ($Role -eq 'fallback') { $default = ('fb-' + ($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9_-]', '')) }
        if ($default.Length -gt 32) { $default = $default.Substring(0, 32) }
        $NodeId = Ask 'Name for this laptop in the records (letters, digits, - and _)' $default
    }
    if ($NodeId -notmatch '^[A-Za-z0-9_-]{1,32}$') { Stop-WithError "'$NodeId' is not a valid laptop name (letters, digits, - and _, up to 32)." }
    while ($true) {
        if (-not $EmailDomains) { $EmailDomains = Ask 'Email domain(s) doctors register with, comma-separated (e.g. hfso.org)' }
        $EmailDomains = ($EmailDomains -replace '\s', '').ToLower()
        if ($EmailDomains -match '^[a-z0-9-]+(\.[a-z0-9-]+)+(,[a-z0-9-]+(\.[a-z0-9-]+)+)*$') { break }
        if ($NonInteractive) { Stop-WithError "Give -EmailDomains as domains like hfso.org (got '$EmailDomains')." }
        Write-Warn 'That is not a list of domains like hfso.org or hfso.org,example.org.'
        $EmailDomains = ''
    }

    $syncKey = ''
    if ($Role -eq 'hub') {
        $syncKey = New-Secret
    } else {
        if ($SyncKeyFile) {
            if (-not (Test-Path $SyncKeyFile)) { Stop-WithError "Cannot find $SyncKeyFile." }
            $syncKey = (Get-Content -LiteralPath $SyncKeyFile | Where-Object { $_ -match '\S' } | Select-Object -Last 1).Trim()
        } else {
            $syncKey = Ask "Paste the hub's SYNC_KEY (from the hub's config\sync-key.txt)"
        }
        if ($syncKey -notmatch '^[A-Za-z0-9_-]{32,}$') { Stop-WithError "That doesn't look like the hub's SYNC_KEY." }
    }

    $ownerPassword = New-Secret 24
    $appPassword = New-Secret 24
    $values = [ordered]@{
        EMR_ROLE              = $Role
        NODE_ID               = $NodeId
        DATABASE_URL          = "postgresql://emr_app:$appPassword@127.0.0.1:$PgPort/emr"
        DATABASE_OWNER_URL    = "postgresql://emr_owner:$ownerPassword@127.0.0.1:$PgPort/emr"
        BETTER_AUTH_SECRET    = (New-Secret)
        AUDIT_KEY             = (New-Secret)
        BACKUP_KEY            = (New-Secret)
        SYNC_KEY              = $syncKey
        ALLOWED_EMAIL_DOMAINS = $EmailDomains
        TRUST_PROXY           = '1'
        PHOTOS_DIR            = $P.Photos
        BACKUP_DIR            = $P.Backups
        PG_BIN_DIR            = $P.PgBin
        CADDY_ROOT_CERT       = (Join-Path $P.Ca 'root.crt')
    }
    Protect-Folder $P.Config
    Write-EmrEnv $values
    $existing = Read-EmrEnv

    # Copies of the keys to keep OFF this laptop: without BACKUP_KEY and AUDIT_KEY a
    # backup can't be restored or checked if this laptop is lost.
    $keys = @(
        "HF EMR keys for laptop '$NodeId' ($Role), created $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
        '',
        'Copy this file to a USB stick (or print it) and keep it somewhere safe, away from this laptop.',
        'Then DELETE it from this laptop. Anyone with these keys and a backup can read patient data.',
        '',
        "BACKUP_KEY=$($values.BACKUP_KEY)",
        "AUDIT_KEY=$($values.AUDIT_KEY)",
        "SYNC_KEY=$($values.SYNC_KEY)",
        '',
        'BACKUP_KEY: needed to restore this laptop''s backups (emr-tool.bat restore <file>).',
        'AUDIT_KEY: needed to check the audit log of a restored backup. Put it in config\emr.env on the restoring laptop.',
        'SYNC_KEY: the same on the hub and every fallback laptop (setup asks for it on each fallback).'
    )
    Set-Content -LiteralPath (Join-Path $P.Config 'KEYS-copy-to-USB-then-delete.txt') -Value $keys -Encoding ASCII
    if ($Role -eq 'hub') { Set-Content -LiteralPath (Join-Path $P.Config 'sync-key.txt') -Value $values.SYNC_KEY -Encoding ASCII }
}
Import-EmrEnv | Out-Null

# ---------------------------------------------------------------- database
Protect-Folder $P.Data
New-Item -ItemType Directory -Force -Path $P.Photos, $P.Backups, $P.Logs, $P.Run, $P.CaddyData | Out-Null

# HTTPS certificate authority: the root's private key is never stored (see scripts/make-ca.ts).
if ($NewCertificates -or -not (Test-Path (Join-Path $P.Ca 'intermediate.key'))) {
    Write-Step 'Creating the HTTPS certificates'
    if ($NewCertificates) {
        Remove-Item -Recurse -Force -LiteralPath $P.CaddyData -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $P.CaddyData | Out-Null
        Write-Warn 'New certificates: every phone and laptop must install the new one from /setup (and may remove the old one).'
    }
    Invoke-Tool 'make-ca' @($P.Ca, $existing['NODE_ID'])
}
if (-not (Test-Path (Join-Path $P.PgData 'PG_VERSION'))) {
    Write-Step 'Creating the database (only reachable from this laptop)'
    $owner = [Uri]$existing['DATABASE_OWNER_URL']
    $pwFile = Join-Path $P.Config 'initdb-password.tmp'
    Set-Content -LiteralPath $pwFile -Value ([Uri]::UnescapeDataString($owner.UserInfo.Split(':')[1])) -Encoding ASCII -NoNewline
    try {
        $initdb = Join-Path $P.PgBin 'initdb.exe'
        # ICU collation sorts accented names (e.g. a name with an accent next to the same name without one) the way people expect.
        & $initdb -D $P.PgData -U emr_owner "--pwfile=$pwFile" -A scram-sha-256 -E UTF8 --locale=C --locale-provider=icu --icu-locale=und
        if ($LASTEXITCODE -ne 0) {
            Write-Warn 'Creating the database with ICU sorting failed; trying plain sorting.'
            Remove-Item -Recurse -Force -LiteralPath $P.PgData -ErrorAction SilentlyContinue
            & $initdb -D $P.PgData -U emr_owner "--pwfile=$pwFile" -A scram-sha-256 -E UTF8 --no-locale
            if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not create the database (initdb failed).' }
        }
    } finally {
        Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue
    }
    Add-Content -LiteralPath (Join-Path $P.PgData 'postgresql.conf') -Encoding ASCII -Value @(
        '',
        '# HF EMR: this laptop only, on its own port.',
        "listen_addresses = '127.0.0.1'",
        "port = $PgPort",
        "password_encryption = 'scram-sha-256'"
    )
}

Start-Pg
try {
    Write-Step 'Creating or updating the tables'
    Invoke-Tool 'migrate' @($P.Migrations)
    Invoke-Tool 'db-app-role'

    $psql = Join-Path $P.PgBin 'psql.exe'
    $env:PGPASSWORD = [Uri]::UnescapeDataString(([Uri]$existing['DATABASE_OWNER_URL']).UserInfo.Split(':')[1])
    # Queries go in on stdin: Windows PowerShell mangles double quotes inside native-command arguments.
    $admins = ("SELECT count(*) FROM `"User`" WHERE role = 'ADMIN' AND status = 'ACTIVE';" | & $psql -h 127.0.0.1 -p $PgPort -U emr_owner -d emr -At)
    $users = ('SELECT count(*) FROM "User";' | & $psql -h 127.0.0.1 -p $PgPort -U emr_owner -d emr -At)
    Remove-Item Env:\PGPASSWORD

    if ($Role -eq 'hub') {
        if ([int]$admins -eq 0) {
            Write-Step 'Creating the first admin account'
            Write-Note 'Use a strong password (12+ characters). There are no default accounts.'
            if ($AdminFile) {
                Get-Content -LiteralPath $AdminFile | & $P.Node (Join-Path $P.Tools 'create-admin.mjs')
                if ($LASTEXITCODE -ne 0) { Stop-WithError 'Creating the admin failed.' }
            } elseif ($NonInteractive) {
                Write-Warn 'No admin yet: run emr-tool.bat create-admin while the EMR is running.'
            } else {
                do {
                    & $P.Node (Join-Path $P.Tools 'create-admin.mjs')
                } while ($LASTEXITCODE -ne 0 -and (Get-YesNo 'That did not work. Try again?'))
            }
        } else {
            Write-Note "$admins admin account(s) already exist."
        }
    } else {
        if (-not $ProvisionFile -and [int]$users -eq 0) {
            $ProvisionFile = Ask 'Path to the provisioning file from the hub (provision.hfprov), or Enter to do it later'
        }
        if ($ProvisionFile) {
            if (-not (Test-Path $ProvisionFile)) { Stop-WithError "Cannot find $ProvisionFile." }
            if ($FirstNumber -le 0) { $FirstNumber = [int](Ask 'First patient number on this laptop (5001 for the first fallback, 6001 for the second, ...)' '5001') }
            Write-Step 'Loading accounts and trips from the hub'
            Invoke-Tool 'load-provision' @($ProvisionFile, '--first-number', "$FirstNumber")
        } else {
            Write-Warn 'No accounts yet. Later: emr-tool.bat load-provision <file> --first-number 5001 (with the EMR running).'
        }
    }
} finally {
    Stop-Pg
}

# ---------------------------------------------------------------- Windows
if ($Role -eq 'hub') {
    Write-Step 'Firewall: allow HTTPS from the local network only'
    $rule = 'HF EMR (HTTPS from local network)'
    if ($isAdmin) {
        Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        # Tied to caddy.exe as well as the port, so Windows doesn't ask (and a "Cancel" can't block it).
        New-NetFirewallRule -DisplayName $rule -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress LocalSubnet -Program $P.Caddy -Profile Any | Out-Null
        Write-Note 'Done.'
    } else {
        Write-Warn 'Skipped (needs administrator). Ask IT, or run setup.bat as administrator once. The rule is:'
        Write-Note "New-NetFirewallRule -DisplayName '$rule' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress LocalSubnet -Program '$($P.Caddy)' -Profile Any"
    }

    if (-not $NoRename -and $env:COMPUTERNAME -ne 'EMR-HUB') {
        Write-Step 'PC name'
        Write-Note "This PC is called $($env:COMPUTERNAME). Named EMR-HUB, devices can also open https://emr-hub.local."
        if ($isAdmin -and (Get-YesNo 'Rename this PC to EMR-HUB now? (takes effect after a restart)')) {
            Rename-Computer -NewName 'EMR-HUB' -Force
            Write-Note 'Renamed. Restart the laptop before the clinic.'
        } elseif (-not $isAdmin) {
            Write-Note 'To rename it (needs administrator): Settings > System > About > Rename this PC > EMR-HUB.'
        }
    }
}

if (-not $NoSchedule) {
    Write-Step 'Nightly backup at 02:00'
    try {
        $action = New-ScheduledTaskAction -Execute (Join-Path $Root 'backup.bat') -Argument '/scheduled' -WorkingDirectory $Root
        $trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
        $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName 'HF EMR nightly backup' -Action $action -Trigger $trigger -Settings $taskSettings -Force | Out-Null
        Write-Note "Scheduled (runs while the EMR is running). Backups go to $($P.Backups)."
    } catch {
        Write-Warn "Could not schedule it ($($_.Exception.Message)). Run backup.bat at the end of each day instead."
    }
}

Write-Step 'Disk encryption'
$bitlocker = $null
try { $bitlocker = (New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive + '\').Self.ExtendedProperty('System.Volume.BitLockerProtection') } catch { }
# 1 = on, 3 = encrypting, 6 = on and locked. 5 (suspended) leaves the key in the clear, so it counts as off.
if ($bitlocker -eq 1 -or $bitlocker -eq 3 -or $bitlocker -eq 6) {
    Write-Note 'BitLocker is on.'
} else {
    Write-Warn 'BitLocker does not appear to be on. Patient data must be on an encrypted drive: turn on BitLocker (Settings > Privacy & security > Device encryption) before the trip.'
}

if (-not $NonInteractive -and (Get-YesNo 'Keep this laptop running when its lid is closed (while plugged in)?')) {
    & powercfg.exe /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
    & powercfg.exe /setactive SCHEME_CURRENT
}

Write-Host ''
Write-Step 'Setup finished.'
if ($firstRun) {
    Write-Warn "Copy config\KEYS-copy-to-USB-then-delete.txt to a USB stick, keep it safe, then delete it from this laptop."
    if ($Role -eq 'hub') { Write-Note 'Each fallback laptop needs config\sync-key.txt (USB) and a provisioning file (emr-tool.bat provision-node).' }
}
if ($Role -eq 'hub') { Write-Note 'Start the EMR with start-hub.bat.' } else { Write-Note 'If the hub fails, start this laptop with start-standalone.bat.' }
