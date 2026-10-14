// Compiles the command-line scripts (create-admin, backup, sync, ...) into
// single .mjs files that run with plain `node`, next to the standalone server.
// The field bundle has no tsx, no TypeScript and no dev dependencies.
//
// Packages with native code or large runtimes (Prisma's client runtime, sharp,
// argon2) are left as imports: they resolve from the standalone server's
// node_modules, so the tools use exactly the same copies as the app.
//
//   node deploy/build-tools.mjs <out dir>
import { build } from "esbuild";
import path from "node:path";

export const TOOLS = [
  "migrate",
  "db-app-role",
  "create-admin",
  "audit-checkpoint",
  "backup",
  "restore",
  "provision-node",
  "load-provision",
  "export-bundle",
  "import-legacy",
  "hub-banner",
  "make-ca",
];

export async function buildTools(outDir) {
  await build({
    entryPoints: Object.fromEntries(TOOLS.map((t) => [t, `scripts/${t}.ts`])),
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    // Shared code goes into chunks instead of being repeated in every tool.
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    // `server-only` resolves to an empty module under this condition (as with tsx --conditions=react-server).
    conditions: ["react-server"],
    external: ["@prisma/client", "@prisma/client/*", "sharp", "@node-rs/argon2", "pg-native"],
    // Some bundled CommonJS code calls require(); give ESM output one.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    logLevel: "warning",
    legalComments: "none",
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-tools.mjs")) {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: node deploy/build-tools.mjs <out dir>");
    process.exit(1);
  }
  await buildTools(path.resolve(out));
  console.log(`Built ${TOOLS.length} tools into ${out}`);
}
