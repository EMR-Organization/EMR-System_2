-- Database-level protections Prisma's schema language can't express.
-- Migrations run as the owner role; the running app connects as emr_app.

-- 1. The app role. Created without a password so this file holds no secret;
--    `npm run db:app-role` (dev/CI) or setup.ps1 (field) sets LOGIN + password.
--    Roles are cluster-wide, so tolerate it already existing (e.g. the shadow DB).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'emr_app') THEN
    CREATE ROLE emr_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- 2. Ordinary read/write on every table, now and in future migrations.
GRANT USAGE ON SCHEMA public TO emr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO emr_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO emr_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO emr_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO emr_app;

-- 3. Then take away what the app must never do.
--    The app can't touch migration history. (The table is missing in Prisma's
--    throwaway shadow database, hence the check.)
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM emr_app;
  END IF;
END
$$;
--    The audit log is append-only for the app.
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM emr_app;
--    Patients and trips are never hard-deleted (patients use deletedAt).
REVOKE DELETE, TRUNCATE ON "Patient", "Trip" FROM emr_app;

-- 4. Belt and braces: block edits to the audit log even for roles that hold
--    the privilege (e.g. the owner running a careless script). Anyone who can
--    drop this trigger can also break the hash chain, which verifyChain() detects.
CREATE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% blocked)', TG_OP;
END
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- 5. Data rules the database enforces no matter which code path writes.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "User_specialty_doctor_only" CHECK ("specialty" IS NULL OR "role" = 'DOCTOR'),
  ADD CONSTRAINT "User_failedLogins_nonneg" CHECK ("failedLogins" >= 0);

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_code_format" CHECK ("code" ~ '^[0-9]{2}_[0-9]{4}(_[A-Za-z0-9]+)?$'),
  ADD CONSTRAINT "Trip_month_range" CHECK ("month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "Trip_year_range" CHECK ("year" BETWEEN 2000 AND 2100),
  ADD CONSTRAINT "Trip_nextPatientNumber_pos" CHECK ("nextPatientNumber" >= 1);

ALTER TABLE "Patient"
  ADD CONSTRAINT "Patient_displayNumber_pos" CHECK ("displayNumber" >= 1),
  ADD CONSTRAINT "Patient_version_pos" CHECK ("version" >= 1),
  ADD CONSTRAINT "Patient_age_pair" CHECK (("ageValue" IS NULL) = ("ageUnit" IS NULL)),
  ADD CONSTRAINT "Patient_dob_or_age" CHECK ("dateOfBirth" IS NOT NULL OR "ageValue" IS NOT NULL);

-- With @@unique([patientId, tripVisit]) this allows at most one trip visit per patient
-- (Postgres treats NULLs as distinct, so ordinary visits are unlimited).
ALTER TABLE "Visit"
  ADD CONSTRAINT "Visit_tripVisit_true_or_null" CHECK ("tripVisit" IS NULL OR "tripVisit" = TRUE);

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_hash_format" CHECK ("hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AuditLog_prevHash_format" CHECK ("prevHash" ~ '^[0-9a-f]{64}$');
