# Offsite backups

**Who:** the trip lead, or whoever sets up the hub. **When:** once, before the trip.

## Why

The hub makes an encrypted backup every night, and admins copy it to a USB stick. If the hub and the USB stick are lost together, every record is gone: stolen in the same bag, a fire, a flood, a confiscated laptop.

Offsite backups copy the same encrypted files to cloud storage whenever the hub has internet. The copies are useless to the storage company, or to anyone who breaks into the account, without `BACKUP_KEY`, and that key never leaves the hub (or the trip lead's safe copy of it).

## How it works

1. **The nightly backup** (`backup.bat`, 02:00) writes `emr-<date>-<time>-<id>.hfbak` (AES-256-GCM) and its signed `.json` summary, as before.
2. **Straight afterwards**, if offsite backups are set up, it tries to upload every backup that isn't offsite yet, newest first.
   - **No internet** (the usual case on a trip): it stops within seconds, logs it in `data\logs\backup.log`, and tries again after the next backup. The backup itself still counts as done.
   - **Before uploading**, each file is checked against the SHA-256 in its signed summary. A damaged file is never sent as if it were good.
   - **The storage checks the same SHA-256** on arrival and refuses anything that changed on the way.
   - **Uploads never replace** a file that's already there.
   - **Each upload is recorded in the audit log** (`backup.offsite`). Problems are recorded as `backup.offsite.failed`.
3. **Admin → Backups** shows which backups are offsite. It has a **Copy offsite now** button for when the hub happens to have internet. You can also run `emr-tool.bat backup-offsite` on the hub.

Only `.hfbak` and `.json` files are uploaded. Nothing readable, no keys, and no database passwords ever leave the hub.

## When the hub has internet

During a trip the hub should normally stay on the clinic's own router or hotspot, with no internet. Copies go offsite when it does have internet:
- **before leaving and after coming home**, on a network you trust (home or office)
- **during the trip**, only if the clinic network itself has internet

Avoid joining the hub to hotel or café Wi-Fi. The firewall lets the local network reach the EMR's HTTPS page, so on a shared Wi-Fi strangers could reach the sign-in page.

**If the hub can't get online:** the USB copy can go offsite instead. Use the storage provider's website to upload the `.hfbak` and `.json` files from any computer. They're encrypted, so that computer never sees patient data.

## Setting it up (once)

### 1. Choose a provider

Any S3-compatible storage works:
- **AWS S3:** signs a HIPAA Business Associate Agreement if that applies to you.
- **Backblaze B2:** cheap.
- **Cloudflare R2.**
- Your organisation's own MinIO server.

Patient data, even encrypted, is the organisation's call. Check with HFSO which provider and region are acceptable.

The upload uses two standard S3 features: SHA-256 checksums, and "If-None-Match" (don't overwrite). AWS S3 supports both. With any other provider, do the test in step 4 before relying on it. If the provider rejects the checksum, uploads fail with a clear error rather than silently.

### 2. Create a private bucket
- **Block all public access.**
- **Versioning on, and Object Lock** (default retention, e.g. 90 days). Then nobody, including someone holding the hub, can delete or overwrite a copy before that time.
- **A lifecycle rule** to delete old copies, e.g. after a year. How long to keep them is a policy decision.

### 3. Create an access key that can only upload

The key is stored on the hub, so assume a stolen hub means a stolen key. Give it **upload only**: no list, no read, no delete. On AWS, attach this policy to a user made just for this hub:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::YOUR-BUCKET/hub-guatemala/*" }
  ]
}
```

On Backblaze B2, create an application key for that one bucket with only the `writeFiles` capability.

Downloading (for a restore) uses a **different** login: the provider's website, or a read-only key that **is not stored on the hub**.

### 4. Add the settings to the hub

Edit `C:\EMR\config\emr.env` in Notepad and add:

```
OFFSITE_BUCKET="your-bucket"
OFFSITE_PREFIX="hub-guatemala"
OFFSITE_ACCESS_KEY_ID="..."
OFFSITE_SECRET_ACCESS_KEY="..."
# Not AWS? The provider's S3 endpoint and region, for example:
# OFFSITE_ENDPOINT="https://s3.us-west-004.backblazeb2.com"
# OFFSITE_REGION="us-west-004"
```

- **Endpoint:** `OFFSITE_ENDPOINT` must be `https://`. On AWS, leave it out and set `OFFSITE_REGION` to the bucket's region.
- **Prefix:** `OFFSITE_PREFIX` is a folder inside the bucket, so several hubs can share one bucket.
- **Test it:** while the hub has internet, run `stop.bat` and then `start-hub.bat`, then `emr-tool.bat backup-offsite`. Admin → Backups should now show "Offsite since …" against each backup.

## Restoring from an offsite copy

1. **Download** the `.hfbak` and `.json` for the date you want, using the website login or the read-only key (step 3).
2. **Copy them** into `data\backups` on the laptop you're restoring to.
3. **Check its settings:** that laptop's `config\emr.env` needs the original hub's `BACKUP_KEY` and `AUDIT_KEY`, from the trip lead's safe copy.
4. **Run** `emr-tool.bat restore data\backups\<name>.hfbak`.

The restore decrypts the backup into a **new** database and checks the audit chain. It changes nothing live until you add `--swap` (see the [admin guide](admin-guide.md)).

Without `BACKUP_KEY`, an offsite copy can't be opened by anyone, including us. **Keep `BACKUP_KEY` and `AUDIT_KEY` somewhere other than the hub *and* other than the storage account.**

## For developers

| What | Where |
| --- | --- |
| Upload logic | `src/server/offsite.ts` |
| Command-line tool | `scripts/backup-offsite.ts`, run with `npm run backup:offsite` |
| Nightly hook | `deploy/windows/scripts/backup.ps1` |
| Settings | `OFFSITE_*` in `src/server/env.ts` |
| Tests | `tests/integration/offsite.test.ts` |

The tests run against [versitygw](https://github.com/versity/versitygw), an S3-compatible server, in CI. To run them locally:

```bash
docker run -d --name emr-dev-s3 -p 127.0.0.1:9100:7070 \
  -e ROOT_ACCESS_KEY_ID=emrtestroot -e ROOT_SECRET_ACCESS_KEY=emr-test-root-secret \
  -e VGW_BACKEND=posix -e VGW_BACKEND_ARG=/tmp versity/versitygw:v1.8.0
OFFSITE_TEST_ENDPOINT=http://127.0.0.1:9100 OFFSITE_TEST_ACCESS_KEY_ID=emrtestroot \
  OFFSITE_TEST_SECRET_ACCESS_KEY=emr-test-root-secret npm test -- offsite
```

Without `OFFSITE_TEST_ENDPOINT` they're skipped locally. In CI they are required.
