import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React escapes everything it renders; this is the one way around that.
      "react/no-danger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
    },
  },
  {
    // Only src/server/ may talk to the database. Pages, components and server actions
    // must go through services, which check permissions and write the audit log.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/db", "@/server/db/*", "**/server/db", "**/server/db/*"],
              message: "Only src/server/ may import the database. Call a service from src/server/services instead.",
            },
            {
              group: ["@prisma/client", "@prisma/client/*", "@/generated/*"],
              message: "Only src/server/ may use Prisma. Call a service from src/server/services instead.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
