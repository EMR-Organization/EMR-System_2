// Repository guardrails that ESLint can't express. Runs in CI (npm run guards).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const failures = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) check(path);
  }
}

function check(path) {
  const text = readFileSync(path, "utf8");
  // Every page and query in this app is per-user and permission-checked. A cached
  // function could serve one user's patient data to another, so caching is banned.
  if (/["']use cache(:\s*\w+)?["']/.test(text)) {
    failures.push(`${path}: "use cache" is not allowed (per-user, permission-checked data must never be cached)`);
  }
}

walk("src");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("guards: ok");
