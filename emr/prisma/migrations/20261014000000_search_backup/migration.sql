-- Phase 6: cross-trip search and backups.

-- 1. Accent-insensitive search, so "Jose" finds "José". unaccent ships with
--    PostgreSQL (contrib) on every platform we use, and is a trusted extension,
--    so the database owner can create it without being a superuser.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Backups run pg_dump as the app role, so the app never needs the owner's
--    password. pg_dump needs to read every table, including the migration
--    history, so a restored database knows which migrations it has. Reading it
--    is harmless; writing it stays revoked. (Missing in Prisma's shadow database.)
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    GRANT SELECT ON "_prisma_migrations" TO emr_app;
  END IF;
END
$$;
