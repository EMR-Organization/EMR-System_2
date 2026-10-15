# Security notes

What the EMR protects against, how, and what it deliberately doesn't. For the trip lead and whoever maintains the code. The technical design is in the HF EMR Technical Spec.

## The setup in one paragraph

One Windows laptop (the hub) runs the database, the app and an HTTPS server (Caddy). Only Caddy is reachable from the network, only from the local subnet, only on port 443; the app and database listen on the laptop itself. Phones and laptops trust the hub through a certificate authority made on the hub at setup. Every request is checked against the database: who you are, whether your account is active, whether your role (and, for students, your switch for this trip) allows the action. Every change is written to a tamper-evident audit log.

## Protections

| Threat | Protection |
| --- | --- |
| Someone on the Wi-Fi reads traffic | HTTPS everywhere (TLS by Caddy, HSTS). Cookies are `Secure`, `HttpOnly`, `SameSite=Strict`. |
| A stolen laptop | BitLocker (setup checks it). Secrets and data folders readable by the EMR's Windows account only; backups encrypted (AES-256-GCM) with a key kept off the laptop. |
| Losing the hub and its USB backup together | Optional [offsite backups](offsite-backups.md): the same encrypted files, uploaded when the hub has internet, checked against their signed SHA-256 before and on arrival, never overwritten. The hub's storage key can only upload, and object lock stops anyone deleting the copies. The storage provider never has `BACKUP_KEY`. |
| A stolen hub used to fake websites to phones | The hub's certificate authority can only vouch for local names and private addresses, only for TLS; its root key is destroyed at setup. |
| Password guessing | argon2id hashes; 5 wrong passwords lock an account for 15 minutes (counted atomically, so parallel guesses don't get more tries); per-address rate limits. |
| A student or doctor doing more than their role allows | Permission check in every service on every call, against the database (not the screen). Students only on trips a doctor switched them on for. Past trips read-only except for admins. |
| Someone editing the database directly | The app's database account can't change or delete audit entries. The audit log is a keyed hash chain, verifiable on screen and against checkpoints stored in each backup. |
| Malicious pages or injected scripts (XSS) | React escapes all output; a strict Content-Security-Policy with a fresh nonce per request means only the app's own scripts run. |
| Other sites making your browser act (CSRF) | `SameSite=Strict` cookies and origin checks on every form and upload. |
| Big uploads to exhaust the hub's memory | Size limits checked before reading, and uploads refused before reading unless the sender is signed in and allowed to upload there. |
| Losing records when two people edit at once | Version check on save: the second save is refused, not silently overwritten. Tested with 20 devices saving at once. |
| A fallback laptop's records clashing with the hub's | Encrypted, authenticated sync bundles; separate number ranges; conflicts queued for a doctor or admin to resolve field by field (past trips: admins only); only admins can import bundles. |

## Accepted risks (decide consciously)

- **Email addresses aren't verified.** Anyone on the network can register with any address in the doctors' domain. Admins must approve accounts only after checking the person face to face ([admin guide](admin-guide.md#approving-accounts)).
- **Fallback laptops carry the doctors' and students' password hashes** and the sync key (admin accounts are deliberately left off fallbacks). A stolen fallback allows offline password guessing for those accounts (slow, because of argon2id) and forging sync bundles. Mitigations: BitLocker, strong passwords, and treating a lost fallback as an incident (change passwords; don't import bundles from it).
- **Anyone who holds the hub laptop unlocked and signed in to Windows** can read everything. Lock the screen (Windows + L) whenever leaving the hub.
- **Devices are shared and unmanaged.** A phone left signed in is signed out after 30 idle minutes, not sooner.
- **No internet means no security updates during the trip.** Update everything before leaving and keep the hub off any other network.

## Reviews

- Phases 1–8: a review per phase; findings and fixes are in each pull request's description.
- Phase 9: a whole-app security review. No critical or high findings; what was found and fixed is listed in the Phase 9 pull request.
