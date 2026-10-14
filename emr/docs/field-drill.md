# Field drill

Run this before every trip with the **real** laptops, phones and router you'll take, with no internet (unplug the router's internet cable, or turn off the laptops' other networks). Allow two hours. Three people: one at the hub, two with phones.

Automated tests already cover the app itself on every change (sign-in, roles, patient flow, sync, backups, and the Windows folder on a clean Windows machine). This drill covers what they can't: your hardware, your network, and your people. Tick each box, and write down anything odd, with the time, for whoever maintains the code.

Use made-up patients only (for example "Test Drill 1"). Delete them afterwards (Admin can delete a patient by typing its number) or set the drill up on a separate trip that you mark as past.

## A. Setup (on the laptops you'll take)

- [ ] `C:\EMR\VERSION.txt` is the same on every laptop.
- [ ] Hub setup ran as administrator without errors. The firewall rule and the 02:00 backup task exist (setup prints both).
- [ ] Setup said BitLocker is **on**. If it warned, turn it on and rerun setup.
- [ ] The keys file was copied to USB and deleted from the hub.
- [ ] Windows Defender / SmartScreen: note any warning when running `setup.bat` or `start-hub.bat` the first time, and what you clicked.
- [ ] Sign out of Windows and back in as the account that will run the EMR day to day: `start-hub.bat` works for it.
- [ ] Another Windows account on the hub (if there is one) can't open `C:\EMR\config` or `C:\EMR\data`.

## B. Travel router

- [ ] Hub on the router's Wi-Fi; `start-hub.bat` shows a `192.168.…` (or `10.…`) address and the QR code.
- [ ] Three devices (at least one iPhone and one Android) install the certificate from `/setup`, after checking the fingerprint matches the hub window ([device setup](device-setup.md)). Note which steps differed from the guide on each phone model.
- [ ] Each device opens the EMR with **no** warning, by the number address, and by `https://emr-hub.local` (note which devices can't use `.local`).
- [ ] A phone with the certificate **not** installed gets a warning (that's correct).
- [ ] Ten minutes of normal use on three devices at once: register 5 patients, vitals, a diagnosis, a prescription, a photo from a phone camera. Lists update on the other devices within about 10 seconds.
- [ ] Two people open the same patient and both save a change: the second gets "this record changed" and loses nothing silently.
- [ ] A doctor switches a student off; the student's next click is refused.
- [ ] Hub screen off for 10 minutes (lid open, AC power): devices still work afterwards.
- [ ] Restart the router. The hub window shows the (possibly new) address within about a minute; devices work again.

## C. Hotspot (hub laptop's Mobile Hotspot, no router)

- [ ] Settings → Network → Mobile hotspot on. Devices join it. Start the EMR: the address is usually `192.168.137.1`.
- [ ] Repeat B's three-device check (certificate already installed; no warning).
- [ ] Turn the hotspot off and on again; note whether the address changed, and how long devices took to work again.
- [ ] Phones that can't reach the hub on the hotspot (some phones isolate hotspot clients, or switch to mobile data when Wi-Fi has no internet: turn off "switch to mobile data" / "Wi-Fi assist"): note model and setting.

## D. Hub failure and the fallback

- [ ] Fallback provisioned from the hub ([before the trip](before-the-trip.md#6-set-up-each-fallback)); `provision.hfprov` deleted afterwards.
- [ ] Pull the hub's power (simulating a crash) mid-shift.
- [ ] On the fallback: `start-standalone.bat`; an admin account can't sign in there (correct); sign in with a doctor account; register 2 patients (numbers 5001, 5002) and edit one patient that already existed.
- [ ] Meanwhile, on the hub after it boots: `start-hub.bat` recovers the database by itself; edit the **same** existing patient differently.
- [ ] Fallback: `emr-tool.bat export-bundle`; hub: Admin → Sync → check, then import. The 2 new patients get hub numbers (their 5001/5002 labels still find them in search), and the patient edited on both sides appears on the **Conflicts** page. Have a doctor (not an admin) resolve it field by field.
- [ ] Import the same bundle again: nothing is added.

## E. Backups and restore

- [ ] Admin → Backups → Back up now; copy the file to USB.
- [ ] `emr-tool.bat restore <that file>` on the hub: it reports OK with the patient count.
- [ ] On a **spare** laptop: set it up, copy `BACKUP_KEY` and `AUDIT_KEY` from the keys file into its `config\emr.env`, then `stop.bat`, `emr-tool.bat restore E:\<file> --swap`, `start-hub.bat`. The drill patients are there; Admin → Audit → Verify chain is intact.
- [ ] Leave the hub running overnight once: a backup appears in `data\backups` for 02:00.

## F. Accounts

- [ ] Register a doctor account with the wrong email domain: refused.
- [ ] Register a student; approve them in person; switch them on; they see the trip.
- [ ] Five wrong passwords lock the account; an admin unlocks it.
- [ ] Reset-code flow: admin issues a code, the user sets a new password, their other devices are signed out.
- [ ] Leave a phone signed in and untouched for 31 minutes: it's signed out.

## After the drill

- [ ] Admin → Audit → Verify chain: intact.
- [ ] Delete or archive the drill data; stop the hub.
- [ ] Send the notes (anything that failed, phone models that needed different steps, Defender warnings, hotspot addresses) to whoever maintains the code.
