// Builds the Windows field bundle: one folder that runs the EMR on a laptop
// with no internet, no installer and no Docker. Run it on Windows with internet
// (a developer's PC, or the CI "windows" job, which uploads the result):
//
//   npm ci && node deploy/build-bundle.mjs [--out dist/EMR] [--skip-build]
//
// It must run on Windows because the app's native modules (argon2 for
// passwords, sharp for photos) are compiled per platform, and `npm ci` on
// Windows installs the Windows ones.
//
// The folder it makes (copy it to C:\EMR on each laptop, then run setup.bat):
//   app\       the standalone Next.js server, its static files, tools\*.mjs, migrations\
//   runtime\   node\node.exe, pgsql\ (PostgreSQL 16: bin, lib, share), caddy\caddy.exe
//   scripts\   emr.ps1, setup.ps1
//   *.bat      setup, start-hub, start-standalone, stop, backup, emr-tool
//   README.txt, VERSION.txt
// setup.bat adds config\ (secrets) and data\ (database, photos, backups, logs);
// updating the app means replacing everything except those two.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildTools } from "./build-tools.mjs";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const out = path.resolve(flag("--out") ?? "dist/EMR");
const cache = path.resolve("deploy/.cache");
const versions = JSON.parse(readFileSync("deploy/versions.json", "utf8"));
// For trying the layout on a Mac/Linux: the result won't run on Windows (wrong native modules).
const anyPlatform = args.includes("--any-platform");

if (process.platform !== "win32" && !anyPlatform) {
  fail("Build the field bundle on Windows (or download it from the CI 'windows' job): the native modules must be the Windows ones.");
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function run(cmd, cmdArgs, options = {}) {
  // npm is a .cmd on Windows and needs a shell; everything else runs directly, so
  // arguments with spaces ("pgsql/pgAdmin 4/...") stay whole.
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32" && cmd === "npm", ...options });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(" ")} failed`);
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Downloads (once, into deploy/.cache) and checks the pinned checksum every time. */
async function download(name) {
  const { url, sha256: expected } = versions[name];
  mkdirSync(cache, { recursive: true });
  const file = path.join(cache, path.basename(new URL(url).pathname));
  if (!existsSync(file)) {
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok || !res.body) fail(`Download failed (${res.status}): ${url}`);
    const partial = `${file}.part`;
    const { Writable } = await import("node:stream");
    const { createWriteStream } = await import("node:fs");
    await res.body.pipeTo(Writable.toWeb(createWriteStream(partial)));
    renameSync(partial, file);
  }
  const actual = await sha256(file);
  if (actual !== expected) {
    rmSync(file);
    fail(`Checksum mismatch for ${path.basename(file)}:\n  expected ${expected}\n  got      ${actual}\nThe file was deleted. Don't change versions.json to match unless you know why it changed.`);
  }
  return file;
}

/** Extracts the given files and folders of a zip into dir (bsdtar on Windows/macOS reads zips). */
function extract(zip, dir, members) {
  mkdirSync(dir, { recursive: true });
  if (process.platform === "linux") run("unzip", ["-q", "-o", zip, ...members.map((m) => `${m}*`), "-d", dir]);
  else run("tar", ["-xf", zip, "-C", dir, ...members]);
}

// ---------------------------------------------------------------------------

if (!args.includes("--skip-build")) run("npm", ["run", "build"]);
if (!existsSync(".next/standalone/server.js")) fail("No standalone build found (.next/standalone). Run `npm run build`.");

console.log(`Assembling ${out}`);
rmSync(out, { recursive: true, force: true });
const app = path.join(out, "app");
cpSync(".next/standalone", app, { recursive: true });
// Next's file tracing follows the app's dynamic file paths (photos, backups, the legacy
// importer) and copies parts of the project folder into the standalone output: a
// developer's data/ (backups, photos), sources, tests. The server doesn't need any of it.
for (const f of ["data", "dist", "src", "tests", "deploy", "scripts", "prisma", "components.json", "tsconfig.json", "README.md", "AGENTS.md", "CLAUDE.md"]) {
  rmSync(path.join(app, f), { recursive: true, force: true });
}
for (const f of readdirSync(app)) if (f.startsWith(".env")) rmSync(path.join(app, f), { force: true });
cpSync(".next/static", path.join(app, ".next/static"), { recursive: true });
if (existsSync("public")) cpSync("public", path.join(app, "public"), { recursive: true });
cpSync("prisma/migrations", path.join(app, "migrations"), { recursive: true });
await buildTools(path.join(app, "tools"));
// Nothing from a developer's machine may ride along: data files, settings, sources.
const leaked = [];
const scan = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (dir === app && ["data", "src", "tests", "deploy", "scripts", "prisma"].includes(e.name)) leaked.push(p);
      else if (e.name !== "node_modules" || dir === app) scan(p);
    } else if (/\.(hfbak|hfprov|hfsync|pem|key|crt)$|^\.env/.test(e.name)) leaked.push(p);
  }
};
scan(app);
if (leaked.length) fail(`The build picked up files that must not ship:\n  ${leaked.join("\n  ")}`);

if (!anyPlatform) {
  for (const pkg of ["@node-rs/argon2-win32-x64-msvc", "@img/sharp-win32-x64"]) {
    if (!existsSync(path.join(app, "node_modules", pkg))) fail(`The standalone build is missing ${pkg}: was it built with npm ci on Windows x64?`);
  }
}

const runtime = path.join(out, "runtime");
const tmp = path.join(out, ".extract");

const nodeZip = await download("node");
const nodeDir = path.basename(nodeZip, ".zip");
extract(nodeZip, tmp, [`${nodeDir}/node.exe`, `${nodeDir}/LICENSE`]);
mkdirSync(path.join(runtime, "node"), { recursive: true });
renameSync(path.join(tmp, nodeDir, "node.exe"), path.join(runtime, "node/node.exe"));
renameSync(path.join(tmp, nodeDir, "LICENSE"), path.join(runtime, "node/LICENSE"));

const pgZip = await download("postgresql");
// Only the server and client programs: no pgAdmin, StackBuilder, docs or headers.
// Its bin needs the Visual C++ runtime, which isn't on every Windows install; the
// zip carries a copy (in pgAdmin's folder) that we put next to the programs.
const vc = ["pgsql/pgAdmin 4/python/vcruntime140.dll", "pgsql/pgAdmin 4/python/vcruntime140_1.dll"];
extract(pgZip, tmp, ["pgsql/bin", "pgsql/lib", "pgsql/share", "pgsql/server_license.txt", "pgsql/commandlinetools_3rd_party_licenses.txt", ...vc]);
for (const dll of vc) renameSync(path.join(tmp, dll), path.join(tmp, "pgsql/bin", path.basename(dll)));
rmSync(path.join(tmp, "pgsql/pgAdmin 4"), { recursive: true, force: true });
for (const f of readdirSync(path.join(tmp, "pgsql/lib"))) if (f.endsWith(".lib") || f.endsWith(".a")) rmSync(path.join(tmp, "pgsql/lib", f));
renameSync(path.join(tmp, "pgsql"), path.join(runtime, "pgsql"));

const caddyZip = await download("caddy");
extract(caddyZip, path.join(runtime, "caddy"), ["caddy.exe", "LICENSE"]);
rmSync(tmp, { recursive: true, force: true });

cpSync("deploy/windows", out, { recursive: true });

const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim() || "unknown";
writeFileSync(
  path.join(out, "VERSION.txt"),
  [
    `HF EMR field bundle`,
    `built ${new Date().toISOString()} from commit ${commit}${anyPlatform ? ` on ${process.platform} (NOT for Windows)` : ""}`,
    `Node.js ${versions.node.version}, PostgreSQL ${versions.postgresql.version}, Caddy ${versions.caddy.version}`,
    "",
  ].join("\r\n"),
);
console.log(`\nDone: ${out}\nCopy the whole folder to C:\\EMR on the laptop and run setup.bat.`);
