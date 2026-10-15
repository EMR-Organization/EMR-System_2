# Before the trip

Two to four weeks out. Everything here needs internet except where noted; once the laptops are set up, the EMR never uses the internet again.

## 1. Decide

- **Network.** Either a travel router (recommended: steadier addresses, more devices, phones don't drop off when the hub's screen sleeps) or the hub laptop's own Windows Mobile Hotspot. The EMR works on both; run the [field drill](field-drill.md) on the one you'll take, ideally both.
- **Laptops.** One **hub** (the best laptop; it holds the database) and at least one **fallback** (used only if the hub dies). Windows 10 or 11. Setup needs an administrator account once; daily use doesn't.
- **Admins.** At least two people with admin accounts (a first and a backup), so a forgotten password or a locked account never stops the clinic.
- **Doctors' email domain.** Doctors can only register with this domain (for example `hfso.org`). Students can use any email.

## 2. Prepare each laptop

1. **Turn on BitLocker** (Settings → Privacy & security → Device encryption, or BitLocker on Pro). A stolen laptop without it gives away every patient record. Setup warns if it's off.
2. Install Windows updates, then turn off automatic restarts for the trip (Windows Update → Advanced → pause updates).
3. Set the power plan so the hub never sleeps on AC power. Setup offers to make closing the lid do nothing on the hub.
4. Make sure the Windows account you'll use day to day is the one that runs setup: the EMR folder is locked to that account.

## 3. Get the EMR folder

Download the newest `EMR-windows-…` artifact from GitHub (Actions → CI → latest run on `main` → Artifacts), or build it on a Windows PC with `node deploy/build-bundle.mjs`. Unzip it and copy the `EMR` folder to `C:\EMR` on every laptop. `C:\EMR\VERSION.txt` says which version it is; all laptops must have the same one.

## 4. Set up the hub

Right-click `C:\EMR\setup.bat` → **Run as administrator**, choose **hub**, and answer the questions (laptop name, doctors' email domain, the first admin's name, email and password). It:

- creates the database, the secrets and this laptop's HTTPS certificate authority;
- adds a firewall rule letting only the local network reach the EMR (HTTPS, port 443);
- offers to rename the PC to `EMR-HUB` (so devices can use `https://emr-hub.local`);
- schedules a backup every night at 02:00.

Then:

1. **Copy `C:\EMR\config\KEYS-copy-to-USB-then-delete.txt` to a USB stick** (or print it), store it away from the laptop, and delete it from the laptop. Without those keys, backups can't be restored if the hub is lost.
2. Run `start-hub.bat`. Its window shows the address and a QR code.
3. Sign in as the first admin and create the trip (Trips → New trip).
4. Create the backup admin: with the EMR running, the backup admin runs `emr-tool.bat create-admin` on the hub and types their own name, email and password. (Admin accounts can only be made this way, at the hub itself; nobody can register as an admin.)
5. Recommended: set up [offsite backups](offsite-backups.md), so a hub lost together with its USB stick doesn't mean lost records. Test it while the hub still has internet.

## 5. Accounts

Have everyone register **before** the trip, on the hub's network, and approve them **in person** (see the [admin guide](admin-guide.md#approving-accounts): the EMR can't check that an email address really belongs to whoever typed it). Then switch students on for the trip (Trips → the trip → Students).

## 6. Set up each fallback

On the hub, with the EMR running: `emr-tool.bat provision-node`. It writes `C:\EMR\provision.hfprov`. Copy it and `C:\EMR\config\sync-key.txt` to a USB stick, then on the fallback (as administrator):

```
setup.bat -Role fallback -SyncKeyFile E:\sync-key.txt -ProvisionFile E:\provision.hfprov -FirstNumber 5001
```

Use 6001 for a second fallback, and so on: patients registered on a fallback get numbers from there, so they never clash with the hub's. **Delete `provision.hfprov` from the USB stick and the hub afterwards**: it holds the doctors' and students' password hashes. Re-provision after approving new accounts.

Admin accounts are left off fallbacks on purpose, so a stolen fallback can't be used to attack admin passwords. On a fallback, doctors and students work normally; admin-only tasks (deleting a patient, approving accounts, backups from the screen) wait until the hub is back.

## 7. Old records

If there's data from the old (Streamlit) EMR, import it once on the hub: copy its `emr_data` folder over, then `emr-tool.bat import-legacy E:\emr_data --root-trip 12_2025` (add `--dry-run` first to see what it would do). Running it twice adds nothing.

## 8. Run the drill

Do the [field drill](field-drill.md) with the real laptops and phones you're taking. Don't skip it: it's the only test of things no automated test can reach (your phones, your router, your laptops' Windows settings).
