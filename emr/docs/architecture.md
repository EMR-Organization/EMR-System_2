# How the EMR works

This guide is for developers and maintainers. It covers:
- every backend function and what it does
- how sign-in and permissions work
- how the frontend is put together
- the security design decisions and why each was made
- what still needs to be done

Developer setup and scripts are in [`../README.md`](../README.md). The threat table and accepted risks are in [`security.md`](security.md).

## The big picture

```
 Phone / laptop browser
        │  HTTPS (443, local subnet only)
        ▼
 Caddy  ── TLS with the hub's own certificate authority; sets X-Forwarded-For
        │  http://127.0.0.1:3000
        ▼
 Next.js app (one Node process)
   src/proxy.ts        CSP nonce + "no cookie → /login" redirect
   src/app/**          pages (server components), server actions, route handlers
        │  only ever call ↓
   src/server/services/*   requireUser() → assertCan() → validate → transaction + audit
        │  emr_app role (cannot edit the audit log or hard-delete)
        ▼
 PostgreSQL 16 on 127.0.0.1:5433            photos on disk: data/photos
```

Production has no cloud and no internet. The hub is one Windows laptop:
- **Database:** PostgreSQL in `EMR\data\pgdata`.
- **Backups:** encrypted, in `EMR\data\backups`.
- **Fallback laptops:** each has its own copy of the same stack. Records made there are merged back into the hub with encrypted sync bundles.

**Rule 1: every read and write goes through a service in `src/server/services/`.** ESLint stops any file outside `src/server/` from importing the database. Pages, server actions and route handlers are thin wrappers that call services.

## Folder map

| Path | What's there |
| --- | --- |
| `src/proxy.ts` | Runs on every request. It adds the Content-Security-Policy (with a fresh nonce) and redirects anyone without a session cookie to `/login`. It is **not** the security check. |
| `src/app/(auth)/` | Pages you can use while signed out: `/login`, `/register`, `/pending`, `/reset`, and `/setup` (device certificate). |
| `src/app/(app)/` | Everything that needs a signed-in user, wrapped in `<AppShell>`. |
| `src/app/api/` | Route handlers for things server actions can't do well: file uploads and downloads. |
| `src/server/services/` | The only public backend API. Every exported function checks the user, permission, input and audit. |
| `src/server/` (other files) | Building blocks used by the services: auth, access checks, audit, database client, encryption, backup, sync. |
| `src/lib/shared/` | Code shared by the server and the browser: permission matrix, Zod schemas, password policy, constants, CSP, formatting. |
| `src/components/` | The UI shell, form helpers, shadcn/ui components. |
| `messages/en.json`, `messages/es.json` | All UI text. |
| `prisma/` | Schema, migrations (including the raw-SQL grants for the `emr_app` role), and the fake-data seed. |
| `scripts/` | Command-line tools: backup, restore, create-admin, provisioning, sync export, legacy import, audit checkpoint. |
| `deploy/` | Builds the Windows field bundle, plus its PowerShell scripts. |

## Backend services

Every function below:
1. starts with `requireUser()`, except the signed-out ones marked *public*
2. then calls `assertCan(actor, permission, { tripId })`
3. validates its input with Zod (`parse()`), whatever TypeScript says the caller sent
4. writes the change and its audit entry in **one transaction**

The `tripId` passed to `assertCan` always comes from the record in the database, never from the request. `tests/unit/route-guard.test.ts` fails CI if an exported service doesn't call `requireUser()` first. The permission-matrix test calls every service as every role.

### `users.ts`: accounts, sign-in, sessions

| Function | Permission | What it does |
| --- | --- | --- |
| `register` | *public* | Self-registration as DOCTOR or STUDENT; the account is always PENDING. Doctors must use an allowed email domain (`ALLOWED_EMAIL_DOMAINS`), and the password policy is enforced. If the email is already registered, it gives the same answer and creates nothing, so nobody can find out which emails have accounts. Rate-limited per IP. |
| `signIn` | *public* | Email and password sign-in. Every failure returns the same "Email or password is incorrect" and takes about the same time. 5 wrong passwords lock the account for 15 minutes; the attempt is claimed atomically before the password check. A pending or disabled account gets no session. On success, Better Auth creates the session and cookie. |
| `resetPasswordWithCode` | *public* | Sets a new password using an admin-issued code. The code works once, is compared in constant time, and stops working after too many attempts. All of the user's devices are signed out and any lockout is cleared. |
| `me` | signed in | Who you are (name, role, specialty). |
| `signOut` | signed in | Ends this session and clears the cookie. |
| `changePassword` | signed in | Changes your own password; your other devices are signed out. Limited to 5 tries per 15 minutes. |
| `myPermissions` | signed in | Which permissions you have, optionally on a trip. Used only to decide what to show. |
| `listMySessions`, `revokeMySession` | signed in | Your signed-in devices; sign one out. Session tokens are never returned. |
| `listUsers` | `user.manage` | All users, filterable (pending, active…). |
| `approveUser`, `rejectUser` | `user.manage` | Decide on a pending account; doctors need a specialty. Rejected accounts are kept (disabled) so the audit trail still makes sense. |
| `disableUser`, `enableUser` | `user.manage` | Disabling signs the user out everywhere immediately. You can't disable the last active admin; that check locks the admin rows so two admins can't race. |
| `unlockUser` | `user.manage` | Clears a lockout without waiting 15 minutes. |
| `issueResetCode` | `user.manage` | An 8-character, one-time code valid for 30 minutes. Only its hash is stored, and older unused codes stop working. |
| `listUserSessions`, `revokeUserSessions` | `user.manage` | An admin's view of someone's devices; sign them out everywhere. |

### `trips.ts`: trips and student switches

| Function | Permission | What it does |
| --- | --- | --- |
| `listTrips` | signed in | Trips you can see. Admins and doctors see all of them; students see only trips they're switched on for. |
| `getTrip` | `patient.read` | One trip. |
| `createTrip` | `trip.create` | A new trip with a code like `05_2026`. |
| `setTripActive` | `trip.create` | Marks a trip current or past. Past trips are read-only for everyone except admins. |
| `listMembers`, `setStudentEnabled` | `trip.members.toggle` | The per-trip student on/off switch. It takes effect on the student's very next request. |

### `patients.ts`, `vitals.ts`, `diabetic.ts`, `conditions.ts`: intake

| Function | Permission | What it does |
| --- | --- | --- |
| `registerPatient` | `patient.register` | Gives the patient the trip's next number (`001_05_2026`; one atomic `UPDATE … RETURNING`, never reused), saves their conditions, and creates their trip visit, all in one transaction. |
| `getPatient` | `patient.read` | The full record. **Every view is audited.** Pages call this first, so opening any tab of a record leaves an entry. |
| `listPatients` | `patient.read` | One trip's patients, newest first, paginated, searchable by name or number. |
| `updatePatient` | `patient.register` | Edits demographics. The caller sends the version it loaded; a stale save throws `ConflictError` instead of overwriting. |
| `softDeletePatient` | `patient.delete` | Hides a patient (admin only, and the patient's label must be typed to confirm). Nothing is erased and the number isn't reused. |
| `addVitals`, `listVitals` | `vitals.write`, `patient.read` | Vital signs. Weight can be entered in lb but is stored in kg; BMI is computed on the server. |
| `addDiabeticEntry`, `listDiabeticEntries` | `diabetic.write`, `patient.read` | Glucose, insulin, blood pressure and lipids. |
| `addCondition`, `listConditions` | `condition.write`, `patient.read` | Pre-existing conditions. |

### `visits.ts`, `medications.ts`, `dashboard.ts`: doctors

| Function | Permission | What it does |
| --- | --- | --- |
| `getTripVisit` | `visit.read` | The patient's visit for this trip, for the Diagnosis tab. Students can't see it. |
| `recordDiagnosis` | `diagnosis.write` | Saves the diagnosis, with a version check like `updatePatient`. |
| `addVisit`, `listVisits` | `visit.write`, `visit.read` | Extra visits (follow-ups, procedures) and the full visit history. |
| `prescribe`, `discontinue` | `medication.write` | Medications. Discontinuing keeps the record. |
| `listMedications` | `patient.read` | Active medications first, then discontinued ones. |
| `tripStats` | `patient.read` | The trip dashboard: patients registered and seen, broken down by specialty. |
| `doctorQueue` | `visit.read` | "My Patients": patients sent to your specialty, not-yet-seen first. It only sorts the work; any doctor can still open any patient. |

### `photos.ts`

| Function | Permission | What it does |
| --- | --- | --- |
| `assertCanUploadPhoto` | `photo.write` | Called by the upload route **before** it reads the body, so someone who isn't allowed can't make the hub buffer a big upload. |
| `uploadPhoto` | `photo.write` | The format is checked from the actual bytes (not the file name), the size is capped at 5 MB, and the image is re-encoded to a plain JPEG. That strips GPS and camera metadata. The file is saved under a random name in `PHOTOS_DIR`. |
| `getPhoto` | `patient.read` | The photo's bytes, served only through `/api/photos/[id]`. Every view is audited. |
| `listPhotos` | `patient.read` | Photo details (no bytes) for the Photos tab. |

### `search.ts`, `data.ts`: across trips, export and import

| Function | Permission | What it does |
| --- | --- | --- |
| `searchPatients` | `search.crossTrip` | Search by name, date of birth or phone across the trips you can see. Results are capped. |
| `exportTrip` | `data.export` | A trip as CSV or JSON (no photos). Audited. |
| `assertCanImportTrip`, `importTripFile` | `data.import` | Admin import of a trip data file. It only ever merges: nothing is overwritten or deleted, and importing the same file twice changes nothing. A dry run does everything inside a transaction that is then rolled back, so the admin sees the result first. |

### `sync.ts`: fallback laptops

| Function | Permission | What it does |
| --- | --- | --- |
| `assertCanImportSync`, `importSyncFile` | `sync.import` (admin) | Imports a fallback laptop's encrypted bundle. It also has a dry-run mode. The merge rules are under "Offline fallback" below. |
| `listSyncNodes` | `sync.import` | The fallback laptops imported so far, and when. |
| `listConflicts`, `getConflict` | `sync.resolve` | Records that both the hub and a laptop changed, showing each field that differs. Conflicts on past trips only appear for admins. |
| `resolveConflict` | `sync.resolve` | Applies a doctor's or admin's choice for each field. Only admins may take a laptop's "deleted" value. |

### `audit.ts`, `backups.ts`: admin tools

| Function | Permission | What it does |
| --- | --- | --- |
| `listAudit`, `listAuditUsers` | `audit.read` | The audit log, filterable by user, action, patient and date. |
| `verifyAuditChain` | `audit.read` | Recomputes the whole hash chain. Given a checkpoint (from a backup or a printout), it also checks that this entry is still there with the same hash. |
| `listBackups`, `runBackup` | `backup.run` | Lists backups (with when each was copied offsite) and makes one now. |
| `offsiteSettings`, `runOffsiteUpload` | `backup.run` | Whether offsite copies are set up and where they go (never the keys); "Copy offsite now". |
| `backupForDownload` | `backup.run` | The encrypted backup file, for copying to USB. Audited. |

### Building blocks in `src/server/`

| File | What it does |
| --- | --- |
| `auth/session.ts` | `requireUser()` and `getOptionalUser()`: load the signed-in user, applying every session rule (see "How auth works"). |
| `auth/auth.ts` | Better Auth set-up: session rows, the signed cookie, and the session limits. |
| `auth/password.ts` | argon2id hashing (19 MiB, 2 passes). `burnPasswordCheck` takes the same time as a real check when the email doesn't exist. |
| `auth/rate-limit.ts` | In-memory sliding-window limits: sign-in 30 per 5 minutes per IP, reset code 10 per 15 minutes, register 10 per hour, password change 5 per 15 minutes per user. |
| `auth/request.ts` | Request headers, the client IP (`X-Forwarded-For` is trusted only when `TRUST_PROXY=1`), and the user agent. |
| `rbac.ts` | `assertCan`, `can`, `accessibleTripIds`: applies the permission matrix, the per-trip student switch, and the past-trip read-only rule. |
| `patient-access.ts` | `patientForAccess`: finds a patient that isn't deleted and checks the permission against *that patient's* trip. |
| `audit.ts` | Append-only HMAC hash chain: `audit()`, `auditOnly()`, `verifyChain()`, `latestCheckpoint()`. |
| `errors.ts` | `AuthError`, `ForbiddenError`, `NotFoundError`, `ValidationError`, `ConflictError`, `RateLimitError`, and `toActionResult()`, which turns them into a safe result for the browser. |
| `validation.ts` | `parse(schema, input)`. Error messages are message keys, so they can be translated. |
| `page.ts` | `orSignIn()` for pages: a signed-out user goes to `/login`, and forbidden or missing data shows the 404 page. |
| `http.ts` | `isSameOrigin()`: CSRF check for route handlers. |
| `db.ts` | The one Prisma client, connected as `emr_app`. |
| `env.ts` | Validates the configuration on first use. In production it refuses placeholder secrets. |
| `patient-number.ts` | `allocatePatientNumber()`: atomic, inside the transaction that creates the patient. |
| `trip-visit.ts` | `ensureTripVisit()`: creates a patient's trip visit if it's missing, safely when two saves race. |
| `photo-store.ts` | Detects the image type from its bytes, re-encodes it, and stores and reads the files. |
| `trip-data.ts` | Builds and merges trip data files (used by export, import and the legacy import). |
| `legacy-import.ts` | Maps the old Streamlit `emr_data/` folder into the new tables. Safe to run again. |
| `backup.ts`, `restore.ts` | Encrypted `.hfbak` backups (database dump plus photos), kept 14 days. Restore goes into a **new** database and is checked before anything is swapped in. |
| `offsite.ts` | Uploads backups (still encrypted) to an S3-compatible bucket. Each file is checked against its signed SHA-256 first, the storage checks it again on arrival, and an existing copy is never overwritten. Uploads are recorded in the audit log. See [offsite-backups.md](offsite-backups.md). |
| `sealed.ts` | `seal`/`unseal`: AES-256-GCM files keyed from `SYNC_KEY`, with a purpose byte, so a provisioning file can't be imported as a sync bundle or the other way round. |
| `sync/provision.ts` | The hub writes doctor and student accounts, trips and memberships for fallback laptops. **No admin accounts are included.** |
| `sync/export.ts` | On a fallback laptop: every record changed since a given time, with photos and audit entries, as an encrypted bundle. |
| `sync/import.ts` | On the hub: merges a bundle (rules below). |
| `sync/fields.ts` | Which fields count as a record's content when comparing the hub's copy with a laptop's. |
| `setup-cert.ts` | The Caddy root certificate (public, with no private key) for `/setup`. |

### Route handlers (`src/app/api/`)

Each one calls a service. Every POST checks `isSameOrigin()` first, and every download is sent with `Cache-Control: private, no-store`.

| Route | Calls |
| --- | --- |
| `POST /api/patients/[patientId]/photos` | `assertCanUploadPhoto` **before** reading the body, then `uploadPhoto` |
| `GET /api/photos/[photoId]` | `getPhoto` |
| `GET /api/trips/[tripId]/export` | `exportTrip` |
| `POST /api/trips/[tripId]/import` | `assertCanImportTrip`, then `importTripFile` |
| `POST /api/sync/import` | `assertCanImportSync`, then `importSyncFile` |
| `GET /api/backups/[name]` | `backupForDownload` |

## How auth works

### Accounts
1. A person registers at `/register` as a doctor or student. **Every account starts as PENDING.** Nobody can register as an admin; admins are only made with `npm run create-admin` (or by `setup.ps1` in the field).
2. An admin approves the account in Admin → Users, giving doctors a specialty. Admins are told to check the person face to face, because email addresses aren't verified (there's no internet to send mail).
3. Students can also only work on trips where a doctor or admin has switched them on (Trip → Members).

### Signing in
`signIn()` checks the following, in order:
1. **Rate limit** per IP.
2. **Unknown email:** a dummy argon2 check runs (same timing), then the generic error.
3. **Atomic lockout claim:** one SQL `UPDATE` counts the attempt *before* the slow password check, so 30 parallel guesses can't all get through. The 5th failure locks the account for 15 minutes.
4. **argon2id password check.** Success resets the counter.
5. **Status:** a PENDING, REJECTED or DISABLED account is sent to `/pending`. No session is made. A Better Auth database hook *also* refuses to create a session for an account that isn't ACTIVE, as a second line of defence.
6. **Session:** Better Auth creates the session row and sets the cookie:
   - `HttpOnly; Secure; SameSite=Strict`, signed with `BETTER_AUTH_SECRET`
   - expires 12 hours after sign-in, and is **never extended**
7. **Audit:** sign-ins, failures and blocked attempts are all logged.

Better Auth's HTTP endpoints (`/api/auth/*`) are **not mounted**. Its built-in sign-up can't be called from outside; the server calls `auth().api.*` directly.

### Every request after that
`requireUser()` (`src/server/auth/session.ts`) runs at the start of every service call:
1. It gets the session from the cookie, then **re-reads the session row and the user from our own tables**. Better Auth's cookie cache is turned off.
2. It rejects the session if it's past its 12-hour expiry.
3. It rejects and deletes the session if it has been idle for more than 30 minutes (judged by the session's `updatedAt`).
4. If the user isn't ACTIVE, it rejects the request and deletes all of their sessions. Disabling someone therefore takes effect on their very next click.
5. It records activity at most once a minute, to avoid a database write per click.

Then `assertCan(actor, permission, { tripId })` (`src/server/rbac.ts`) applies three rules, reading the database every time:
- **The matrix** in `src/lib/shared/permissions.ts`. Each permission is `all`, `trip` (students: only on trips they're switched on for) or `none` for each role.
- **The student switch:** students need an enabled `TripMember` row for that trip.
- **Past trips are read-only:** on an inactive trip, the write permissions (`TRIP_WRITE_PERMISSIONS`) are for admins only.

| | Student | Doctor | Admin |
| --- | --- | --- | --- |
| Register patients, vitals, diabetic, conditions, photos, search | switched-on trips only | ✓ | ✓ |
| Diagnosis, medications, visits, export, student switches, resolve sync conflicts | – | ✓ | ✓ |
| Users, trips, import, sync import, delete patient, audit, backups | – | – | ✓ |

### Passwords and resets
- **Policy** (`src/lib/shared/password-policy.ts`, NIST-style):
  - 12–128 characters
  - not a common password, and not a common word with digits added
  - not mostly one repeated character
  - must not contain the name part of the email
  - no "must include a symbol" rules
- **Forgotten password:** there's no email in the field. An admin issues a reset code and reads it to the person. The person enters it at `/reset`. That signs out every device and clears any lockout.
- **Changing your own password** at `/account` signs out your other devices.

### The browser side of sessions
- **`proxy.ts`:** sends anyone *without a cookie* to `/login?next=…`. Having a cookie proves nothing; services always re-check.
- **`next=`:** cleaned by `safeNextPath()`, which allows same-site paths only and rejects control characters and backslashes, so it can't be turned into an open redirect.
- **`<SessionTimeoutWarning>`:** warns at 25 minutes without real input on the device. At 30 it signs out properly, so the back button can't bring a record back.
- **`<AutoRefresh>`:** lists refresh every 10 seconds only while the tab is visible *and* the device was used in the last 2 minutes. An unattended screen goes quiet, so the idle sign-out still happens.

## How the frontend works

**Stack:**
- Next.js 16 App Router, with React Server Components and Cache Components
- React 19, Tailwind 4, shadcn/ui (base-ui), next-intl, Zod

**Pages are server components.** A page:
1. awaits its route parameters
2. calls services inside `orSignIn(() => …)`
3. renders HTML

Data loads stream in through `<Suspense>`. Nothing is fetched from the browser with `fetch()`, and there is no client-side state store. `"use cache"` is banned by a CI guard, because every page shows data specific to the user and their permissions.

**Writes use server actions.** Each `actions.ts` next to a page:
1. calls one service through `toActionResult()`, which returns either `{ ok: true, data }` or `{ ok: false, code, messageKey, fieldErrors }`, with no stack traces
2. calls `revalidatePath()` on success, so the page re-renders with fresh data

Next.js checks the `Origin` header on every server action, which is part of the CSRF protection.

**Forms** (`src/components/form.tsx`):
- `useServerForm(action)` wraps `useActionState`. `<Field>`, `<SelectField>` and `<TextareaField>` show translated field errors, linked to the input with `aria-describedby`.
- `useActionFeedback()` shows toasts. An `AUTH` result sends the user to `/login?next=<this page>`.
- Optimistic locking: edit forms send the `version` they loaded. A `ConflictError` shows "this record changed, reload".

**Layout:**
- `(app)/layout.tsx` wraps everything in `<AppShell>`: a sidebar on wide screens, a top bar on phones, a skip link, and `<main id="main">`.
- The nav links shown depend on the role (`roleHas`). **That is tidiness only**; the server checks everything.
- Trip pages and patient pages have their own tab layouts.

**Text and language:**
- Every string is in `messages/en.json` and `messages/es.json`, read with `getTranslations` (server) or `useTranslations` (client). A test fails if a key or placeholder is missing from either file.
- Option lists (conditions, medications…) are stored in English and translated only for display, with `optionLabel()`.
- The language switcher saves a cookie. Without one, the browser's language is used.

**Accessibility and phones:**
- `tests/e2e/a11y.spec.ts` runs axe (WCAG 2.2 AA) on every page in both languages, on desktop and a phone.
- It also checks that nothing is wider than the screen, that every page has its own `<title>`, and that touch targets are at least 40 px.
- Page titles never contain patient names, because titles show up in history and the tab switcher.

**Photos** load from `/api/photos/[id]` like any image (the cookie authenticates them). They upload through a `POST` with `FormData`.

## Offline fallback

When the hub is down, a fallback laptop runs the same app on its own.

**Before the trip:**
- The hub writes a provisioning file (`npm run provision-node`) holding the doctor and student accounts, trips and switches. **Admins are left off**, so a stolen fallback holds no admin password hash.
- Each fallback loads the file and gets its own number range (5001, 6001…).

**When the hub is back:**
1. The fallback runs `npm run export-bundle`.
2. An admin imports the bundle in Admin → Sync. The bundle is encrypted and authenticated, so a tampered or wrong-key file is rejected.
3. The hub merges it:
   - **New records** are added. New patients get a hub number, and the fallback's label is kept as an alias.
   - **Records both sides already have** are compared with the version the hub last accepted from that laptop:
     - only the laptop changed it: the laptop's edit is applied
     - only the hub changed it: the hub's copy stays
     - both changed it: the record is queued as a **conflict**
   - **The laptop's audit entries** are appended to the hub's chain, each only once.
4. Doctors and admins resolve conflicts field by field at `/conflicts`. Past-trip conflicts are admin-only.

Importing the same bundle twice changes nothing.

## Security design decisions

| Decision | Why |
| --- | --- |
| **Services are the only way to data**, with `requireUser()` + `assertCan()` in every function and a CI test enforcing it | The UI hiding a button is not security. Server actions can be called with any payload by anyone, so the check has to be next to the data. |
| **Middleware (`proxy.ts`) is never the guard** | Middleware can be bypassed (e.g. CVE-2025-29927). It only redirects for convenience and sets the CSP. |
| **Session and user re-read from the database on every call; no cookie cache** | Disabling an account, switching a student off, or signing out a device must take effect on the next click, not when a cache expires. |
| **12 h absolute and 30 min idle, never extended** | The devices are shared phones and laptops in a busy clinic. |
| **Self-registration always PENDING; no admin self-registration; admins made only by a CLI** | Email can't be verified offline, so a human approves every account. |
| **Same error and timing for every sign-in failure; duplicate registration looks the same as a new one** | Nobody on the Wi-Fi can find out which emails have accounts. |
| **Atomic lockout claim before the password check** | Otherwise parallel guesses each get past a "locked?" check while the slow hashes run. |
| **argon2id (OWASP minimum cost)** | Slows offline guessing if a database or fallback laptop is stolen. |
| **Two database roles; the app's role can't update or delete audit rows or hard-delete patients and trips** | Even a bug or injection in the app can't erase history. `db-permissions.test.ts` proves it. |
| **Audit log is an HMAC chain written in the same transaction as the change, with checkpoints kept outside the database** | A change can't happen without its entry. Editing old rows is detected, and with checkpoints even someone holding the key can't silently rewrite the chain. |
| **Patient records audited on every view** | Medical privacy: who looked at whom, and when. |
| **Trip ID taken from the record, not the request** | A student switched on for trip A can't reach trip B's patients by guessing IDs. |
| **Forbidden and not-found look the same (404)** | Pages never confirm that a record exists to someone who can't see it. |
| **Version check on every edit** | Two people saving at once: the second save is refused, never a silent overwrite. Tested with 20 concurrent saves. |
| **Patient numbers from one atomic `UPDATE … RETURNING`, never reused; soft delete only** | The old app renumbered everyone after a delete, which mixed up records. |
| **Zod validation on every service input; errors are message keys** | Never trust the client. No internal details or stack traces reach the browser. |
| **CSP with a per-request nonce and `strict-dynamic`; no `dangerouslySetInnerHTML` or `eval` (lint-enforced)** | Injected scripts can't run even if a bug lets HTML through. |
| **`SameSite=Strict` cookies, Next's Origin check on actions, `isSameOrigin()` on route handlers** | Other sites can't make your browser act. |
| **Uploads: permission checked before reading the body, size caps, type from the bytes, re-encoded to JPEG, random file names, served only through a checked route** | No memory exhaustion and no disguised files. GPS and camera metadata are stripped. |
| **Only Caddy on the network (443, local subnet); app and database on 127.0.0.1; `X-Forwarded-For` trusted only behind it** | A smaller attack surface, and rate limits can't be dodged with fake headers. The Windows CI job checks that the LAN can't reach ports 3000 or 5433. |
| **The hub's own certificate authority, limited to local names and private IPs; its root key destroyed at setup** | Phones get real HTTPS, but a stolen hub can't impersonate internet sites. |
| **Secrets generated per laptop; production refuses placeholder secrets** | No shared default keys. A forgotten `.env.example` value stops the server instead of running insecurely. |
| **Backups and sync files are AES-256-GCM, with a key check and a purpose byte; restore goes into a new database and is verified before the swap** | A stolen USB stick is useless, a wrong key is detected, and a bad restore can't destroy live data. |
| **Offsite copies are the already-encrypted files, sent with an upload-only key, never overwritten, with object lock on the bucket** | A lost hub plus its USB stick no longer means lost records, and the storage company can't read anything. A stolen hub's key can't delete or replace the offsite copies. |
| **Fallback laptops get no admin accounts; only admins import bundles** | Limits what a stolen fallback is worth. |
| **Past trips read-only except for admins** | Closed trips can't be changed by accident. |
| **No `"use cache"`** | A shared cache could serve one user's data to another. |
| **CODEOWNERS on `src/server/`, `prisma/`, `src/lib/shared/`, `deploy/` and the actions** | Security-critical code always gets the lead's review. |

The accepted risks (no email verification, password hashes on fallback laptops, an unlocked hub, unmanaged devices, no updates during a trip) are explained in [`security.md`](security.md#accepted-risks-decide-consciously).

## What still needs to be done

**Before the trip (needs people or hardware, not code):**
- [ ] Run the [field drill](field-drill.md) on the real hub, phones and fallback laptop, once on the router and once on the hotspot (including a hotspot IP change). Send the notes back so the problems it finds get fixed.
- [ ] Set the real HFSO email domain in `ALLOWED_EMAIL_DOMAINS`. It is a placeholder now.
- [ ] Decide between the travel router and a phone hotspot (check whether the hotspot isolates clients).
- [ ] Confirm the hub's Windows version and whether we have admin rights (renaming the PC, the firewall rule and the BitLocker check need them).
- [ ] Choose the first and backup admins. Keep `BACKUP_KEY` and `AUDIT_KEY` somewhere other than the hub.
- [ ] Choose a storage provider and set up [offsite backups](offsite-backups.md) (a private bucket with object lock, and an upload-only key). Check with HFSO which provider and region are acceptable.
- [ ] Turn on BitLocker on the hub and every fallback laptop.
- [ ] Test VoiceOver (iPhone), TalkBack (Android), and readability in sunlight on real phones.
- [ ] Have a native Spanish speaker with clinical experience check `messages/es.json`.
- [ ] Install the certificate on real iPhones and Android phones by following [device setup](device-setup.md). Learners can add screenshots.
- [ ] Run `import-legacy` on the old app's real `emr_data/` folder on the hub (not on a dev machine, and never commit it).

**Worth doing later (code):**
- [ ] Rate limits are in memory and reset when the server restarts. That's fine for one hub process (the lockout is in the database), but they would need to be shared if the app ever ran as several processes.
- [ ] Email verification and emailed reset codes, if the EMR ever runs with internet access.
- [ ] Two-factor sign-in for admins. Text-message and email codes can't work offline, but hardware security keys (WebAuthn) or an authenticator app would.
- [ ] Automatic audit-checkpoint export (e.g. printed daily, or to USB) instead of relying on backups and the CLI.
- [ ] A between-trips home for the data (where the hub's database lives when not travelling, who holds the keys, retention), which is a policy decision. Offsite backups cover disaster recovery. A live cloud copy that people use would need a new design (internet-facing auth, TLS from a real certificate authority, data-protection agreements).
- [ ] Dark mode tokens exist but are never applied. If it's turned on, re-run the accessibility scan, because contrast was only tuned for light mode.
- [ ] Update dependencies before each trip (`npm run audit:runtime` in CI flags high and critical advisories) and rebuild the Windows bundle.
