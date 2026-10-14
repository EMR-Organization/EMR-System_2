# Admin guide

Admins approve accounts, look after the hub, its backups and the fallback laptops. Doctors switch students on and off for a trip themselves; that doesn't need an admin.

## Every morning

1. Start the hub: `C:\EMR\start-hub.bat`. Leave its window open all day (closing it stops the EMR). If it shows a warning, read it: it names the problem.
2. Check the address in the window still works from one phone. If the hub got a new address (the router or hotspot restarted), the window shows the new one; phones that used the number address need it too. `https://emr-hub.local` keeps working when the number changes, on devices that support it.
3. Admin → **Audit** → **Verify chain**. It should say the audit log is intact. If it doesn't, stop and read [If something looks wrong](#if-something-looks-wrong).

## Every evening

1. Admin → **Backups** → **Back up now** (one is also made every night at 02:00 while the EMR runs).
2. Copy the newest file from `C:\EMR\data\backups` to the USB stick that lives with the trip lead, never in the same bag as the laptop. Backups are encrypted; they're useless without the keys file from setup, which is kept somewhere else again.
3. To stop for the night: `stop.bat` (or leave it running so the 02:00 backup happens).

## Approving accounts

Admin → **Users** → *Waiting for approval*.

**Approve only people you have checked in person.** Anyone on the network can register with any email address, including a real doctor's; the EMR has no way to check that the address belongs to them. So: ask the person in front of you to show you the request on their own phone (name, email, role), then approve it. Never approve from a list alone, and never approve a second account with the same name.

Doctors are approved with their specialty (it decides whose queue their patients go to). Students are approved here, then a doctor switches them on for the trip (the trip → **Students**). A student who isn't switched on sees nothing.

Reject anyone you don't recognise.

## Helping people

| Problem | What to do (Admin → Users → the person) |
| --- | --- |
| Forgot password | **Reset code**: read them the code; they enter it at *Reset your password* on the sign-in page. It works once, for 30 minutes, and signs them out everywhere. |
| "Locked" (5 wrong passwords) | Wait 15 minutes, or **Unlock**. |
| Lost or stolen phone | **Sign out everywhere**, then a reset code so they choose a new password. |
| Someone left the team | **Disable**. They're signed out on their next click. Their records stay, with their name. |

There must always be at least one active admin; the EMR refuses to disable the last one.

## Trips

- **New trip**: Trips → New trip. Patient numbers look like `001_05_2026` and are never reused or renumbered, even after a deletion.
- **After the trip**: Trips → the trip → **Mark as past**. Past trips are read-only for everyone but admins.
- **Deleting a patient** (a duplicate, a test entry) is admin-only and asks you to type the patient's number. The record is hidden, not erased; the audit log keeps what happened.

## Export and import

The trip → **Data**: doctors and admins can download the trip as CSV (for spreadsheets) or JSON. Admins can import a JSON export into another hub; importing only adds what's missing and never changes or deletes existing records. Exports contain patient data: keep them on encrypted storage and delete them when done.

## If the hub fails: the fallback laptop

1. On the fallback: `start-standalone.bat`. Only that laptop can use it (it isn't reachable over the network, on purpose); one person enters records on it, signed in with a doctor or student account. **Admin accounts don't work on fallbacks** (on purpose: see [security notes](security.md#accepted-risks-decide-consciously)); admin tasks wait for the hub. Patients registered there get numbers from 5001 (or the fallback's own range).
2. When the hub is back: on the fallback, `emr-tool.bat export-bundle`; copy the `.hfsync` file to a USB stick.
3. On the hub: Admin → **Sync** → choose the file → **Check bundle**. Read the summary, then **Import**. Importing the same bundle twice adds nothing.
4. If a record was edited both on the hub and on the fallback, it appears on the **Conflicts** page (in the menu). Any doctor or admin can open it and pick, field by field, which version to keep; ideally the doctor who saw the patient. Nothing is applied until someone chooses. Conflicts on a past trip can only be resolved by an admin.

Before the trip, and again after approving new accounts, re-provision the fallbacks (see [Before the trip](before-the-trip.md#6-set-up-each-fallback)) so they know everyone's account.

## Restoring a backup

On the hub:

```
emr-tool.bat restore C:\EMR\data\backups\emr-20261014-020000-ab12cd.hfbak
```

This restores into a **new** database next to the live one and checks it (audit chain intact, patient count matches). Nothing live is touched, so it's safe while the EMR runs: a good way to check a backup is usable.

To actually switch to the restored copy: `stop.bat`, then `emr-tool.bat restore <file> --swap`, then `start-hub.bat`. The old database and photos are kept aside, never deleted.

Restoring onto a new laptop needs that laptop set up with the **same** `BACKUP_KEY` and `AUDIT_KEY` (from the keys file kept on USB): put them in its `C:\EMR\config\emr.env` before restoring.

## If something looks wrong

- **Verify chain fails**: someone changed the database directly, or it was damaged. Don't fix anything yourself. Make a backup, note the time, and tell the trip lead; the audit entry it names is where to start.
- **Verify against a checkpoint**: Admin → Audit → choose a backup under *Checkpoint from a backup*. This also catches a rewrite of the whole log by someone who had the keys.
- **A device shows a certificate warning** after it was set up: don't continue. Someone may be imitating the hub. Check it's on the right Wi-Fi, and tell the trip lead.
- Logs are in `C:\EMR\data\logs`.
