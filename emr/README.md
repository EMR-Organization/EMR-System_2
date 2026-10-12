# Humanity First EMR

This replaces the Streamlit app in `../Electric-Medical-Record-System-Offline/`. It's built on Next.js 16, PostgreSQL 16, Prisma and Better Auth. The design is in the **HF EMR Technical Spec** doc.

## Developer setup

You need Node.js 22 LTS, Git and Docker (Docker Desktop, Colima or OrbStack). Windows developers can install PostgreSQL 16 with the official Windows installer instead of using Docker.

```bash
cd emr
cp .env.example .env.local
npm ci
npm run db:up           # Postgres 16 on 127.0.0.1:5432 (needs the `docker compose` plugin)
npm run db:migrate      # create the tables
npm run db:app-role     # let the app's restricted role log in
npm run db:seed         # fake trips, users and patients
npm run dev             # http://localhost:3000
```

Port 5432 already taken (for example by a Homebrew Postgres)? Map Docker to another port, such as `-p 127.0.0.1:5434:5432`, and change the port in both URLs in `.env.local`.

No `docker compose`? Start the same database directly:

```bash
docker run -d --name emr-dev-db -e POSTGRES_USER=emr_owner -e POSTGRES_PASSWORD=emr_dev_password \
  -e POSTGRES_DB=emr -p 127.0.0.1:5432:5432 -v emr-db:/var/lib/postgresql/data postgres:16-alpine
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run lint` | ESLint, including the security guardrails below |
| `npm run guards` | Repo checks ESLint can't express (no `"use cache"`) |
| `npm run typecheck` | Generates route types, then `tsc --noEmit` |
| `npm test` | Vitest unit and integration tests |
| `npm run test:e2e` | Playwright on desktop and phone viewports (port 3100; run `npx playwright install chromium` once) |
| `npm run db:migrate` | Apply migrations; after editing `prisma/schema.prisma`, creates a new one (`-- --name <what>`) |
| `npm run db:app-role` | Gives the `emr_app` role the password from `DATABASE_URL` |
| `npm run db:seed` | Fake data (refuses when `NODE_ENV=production`) |
| `npm run db:reset` | Drop everything, re-migrate, re-seed |
| `npm run build` | Production build (`output: "standalone"`, used by the Windows bundle) |
| `npm run audit:runtime` | After a build: fails if any high/critical advisory affects a package in the shipped server |

CI runs lint, guards, typecheck, tests, build and the runtime audit on every pull request.

## Guardrails (CI fails if you break these)

- **Only `src/server/` may import the database or Prisma.** Pages, components and server actions call services in `src/server/services/`, which check permissions and write the audit log.
- **No `dangerouslySetInnerHTML`, `eval` or `"use cache"`.** Every page shows per-user, permission-checked data, and caching could leak one user's data to another.
- **Security-critical paths need the lead's review** (see `.github/CODEOWNERS`).
- **Fake data only.** Never put real patient data in code, tests, issues or chat.

## Database

- **Two roles.** Migrations, seed and admin scripts connect as the owner (`DATABASE_OWNER_URL`). The running app connects as `emr_app` (`DATABASE_URL`), which the database itself stops from editing or deleting audit entries, hard-deleting patients or trips, or touching the schema. `tests/integration/db-permissions.test.ts` proves it.
- **Raw SQL lives in migrations.** Grants, the audit-log trigger and CHECK constraints are in `prisma/migrations/*_app_role/migration.sql`. New tables get the app's normal grants automatically. If a new table must be append-only, add its `REVOKE` in that migration.
- **Patient numbers** come from `allocatePatientNumber()` in `src/server/patient-number.ts`, inside the transaction that creates the patient. Never compute them with `max() + 1`.
- **The Prisma client is generated** into `src/generated/prisma` (git-ignored) on `npm ci`. Run `npx prisma generate` after pulling a schema change.

## UI text

All user-facing text lives in `messages/en.json` and is read with `next-intl` (`getTranslations` in server components, `useTranslations` in client components). Don't hardcode strings in components, so a Spanish translation can be added later without touching them.

## Known tooling issue

npm 10.9 (bundled with Node 22) can crash with `Cannot read properties of null (reading 'edgesOut')` when **adding** some packages (seen with `vitest`). If it happens, add the package with npm 11 instead: `npx npm@11 install -D <package>`. `npm ci` with npm 10 works fine with the resulting lockfile.
