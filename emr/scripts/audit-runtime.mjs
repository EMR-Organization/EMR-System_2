// Fails if a package with a high/critical advisory is part of what actually ships: the
// standalone server in .next/standalone (run after `npm run build`).
//
// Plain `npm audit --omit=dev` also flags CLI tooling that never runs in a request path
// (the Prisma CLI is pulled in as an optional peer of @prisma/client). Those are listed
// as warnings so they stay visible, but they don't fail CI.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const standalone = ".next/standalone/node_modules";
if (!existsSync(standalone)) {
  console.error("audit-runtime: run `npm run build` first (no .next/standalone found)");
  process.exit(1);
}

let report;
try {
  report = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32" });
} catch (err) {
  report = err.stdout; // npm audit exits non-zero when it finds anything
}
const vulns = Object.values(JSON.parse(report).vulnerabilities ?? {}).filter((v) =>
  ["high", "critical"].includes(v.severity),
);

const shipped = new Set();
function collect(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    if (name.startsWith("@")) {
      for (const sub of readdirSync(path)) visit(`${name}/${sub}`, join(path, sub));
    } else {
      visit(name, path);
    }
  }
}
function visit(pkg, path) {
  shipped.add(pkg);
  const nested = join(path, "node_modules");
  if (existsSync(nested)) collect(nested);
}
collect(standalone);

const failing = vulns.filter((v) => shipped.has(v.name));
for (const v of vulns.filter((v) => !shipped.has(v.name))) {
  console.warn(`warn: ${v.name} (${v.severity}) is not in the shipped server; tooling only`);
}
if (failing.length) {
  for (const v of failing) console.error(`FAIL: ${v.name} (${v.severity}) ships in .next/standalone`);
  process.exit(1);
}
console.log(`audit-runtime: ok (${shipped.size} shipped packages, none with high/critical advisories)`);
