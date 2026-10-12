# Humanity First EMR

This replaces the Streamlit app in `../Electric-Medical-Record-System-Offline/`. It's built on Next.js 16, PostgreSQL 16, Prisma and Better Auth. The design is in the **HF EMR Technical Spec** doc.

## Developer setup

You need Node.js 22 LTS, Git and Docker (Docker Desktop, Colima or OrbStack). Windows developers can install PostgreSQL 16 with the official Windows installer instead of using Docker.

```bash
cd emr
cp .env.example .env.local
npm ci
npm run db:up           # Postgres 16 on 127.0.0.1:5432 (needs the `docker compose` plugin)
npm run dev             # http://localhost:3000
```

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
| `npm run build` | Production build (`output: "standalone"`, used by the Windows bundle) |
| `npm run audit:runtime` | After a build: fails if any high/critical advisory affects a package in the shipped server |

CI runs lint, guards, typecheck, tests, build and the runtime audit on every pull request.

## Guardrails (CI fails if you break these)

- **Only `src/server/` may import the database or Prisma.** Pages, components and server actions call services in `src/server/services/`, which check permissions and write the audit log.
- **No `dangerouslySetInnerHTML`, `eval` or `"use cache"`.** Every page shows per-user, permission-checked data, and caching could leak one user's data to another.
- **Security-critical paths need the lead's review** (see `.github/CODEOWNERS`).
- **Fake data only.** Never put real patient data in code, tests, issues or chat.

## UI text

All user-facing text lives in `messages/en.json` and is read with `next-intl` (`getTranslations` in server components, `useTranslations` in client components). Don't hardcode strings in components, so a Spanish translation can be added later without touching them.

## Known tooling issue

npm 10.9 (bundled with Node 22) can crash with `Cannot read properties of null (reading 'edgesOut')` when **adding** some packages (seen with `vitest`). If it happens, add the package with npm 11 instead: `npx npm@11 install -D <package>`. `npm ci` with npm 10 works fine with the resulting lockfile.
