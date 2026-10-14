HF EMR - field laptop folder
============================

Copy this whole folder to C:\EMR (a short path with plain letters). Nothing is
installed elsewhere; everything the EMR keeps is in config\ and data\ here.

HUB (the laptop everyone connects to)
  1. Right-click setup.bat > Run as administrator (adds the firewall rule and
     offers to rename the PC to EMR-HUB). It asks for the doctors' email
     domain and creates the first admin account.
  2. Copy config\KEYS-copy-to-USB-then-delete.txt to a USB stick, keep it
     safe, and delete it from the laptop.
  3. start-hub.bat starts the EMR. Keep its window open. It shows the address
     and a QR code; phones and laptops on the same Wi-Fi open that address.
  4. Once per device, open https://<address>/setup and install the certificate.
  5. stop.bat stops everything.

FALLBACK (a spare laptop, used only if the hub fails)
  On the hub, with the EMR running:  emr-tool.bat provision-node
  Copy provision.hfprov and config\sync-key.txt to a USB stick, then on the fallback:
    setup.bat -Role fallback -SyncKeyFile E:\sync-key.txt -ProvisionFile E:\provision.hfprov -FirstNumber 5001
  (6001 for a second fallback, and so on.) Delete provision.hfprov afterwards: it
  holds password hashes. Re-provision after approving new accounts on the hub.
  If the hub fails: start-standalone.bat (this laptop only).
  When the hub is back: emr-tool.bat export-bundle on the fallback, then on the
  hub Admin > Sync > import the .hfsync file.

BACKUPS
  Nightly at 02:00 while the EMR is running, and backup.bat any time. Encrypted
  files go to data\backups (kept 14 days). Copy them to a USB stick at the end
  of each clinic day. Restore: emr-tool.bat restore <file.hfbak> [--swap]

UPDATING
  Stop the EMR, replace everything EXCEPT config\ and data\, start it again.
  Database updates are applied automatically on start.

PROBLEMS
  Logs are in data\logs (app.log, caddy.log, postgres.log, backup.log).
  "Port 443 in use": another program (Skype, IIS, VPN software) is using it.
