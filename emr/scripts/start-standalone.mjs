// Runs the production server exactly as the field bundle does: the standalone
// output from `next build` (output: "standalone"), not `next start`.
// Standalone doesn't include static assets, so they're copied next to it first.
//
//   npm run build && npm run start:standalone        # PORT/HOSTNAME from env
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const standalone = ".next/standalone";
if (!existsSync(`${standalone}/server.js`)) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}
cpSync(".next/static", `${standalone}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${standalone}/public`, { recursive: true });

// The server runs from .next/standalone; relative data folders mean "from here", as for the scripts.
const absolute = (key, fallback) => path.resolve(process.env[key] ?? fallback);
const child = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: process.env.PORT ?? "3000",
    HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1",
    PHOTOS_DIR: absolute("PHOTOS_DIR", "data/photos"),
    BACKUP_DIR: absolute("BACKUP_DIR", "data/backups"),
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
