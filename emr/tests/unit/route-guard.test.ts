import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Every exported function in src/server/services must call requireUser() before
// doing anything, unless it's on this short, reviewed list of public entry points.
// Adding a service file or function automatically adds it to this test.

const SERVICES_DIR = join(__dirname, "../../src/server/services");

const PUBLIC_FUNCTIONS = new Set([
  "users.register", // anyone may ask for an account (it starts PENDING)
  "users.signIn",
  "users.resetPasswordWithCode", // needs an admin-issued code instead
]);

type ExportedFn = { name: string; body: ts.Node; firstStatement?: ts.Statement };

function exportedFunctions(source: ts.SourceFile): ExportedFn[] {
  const found: ExportedFn[] = [];
  for (const stmt of source.statements) {
    const exported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      found.push({ name: stmt.name.text, body: stmt.body, firstStatement: stmt.body.statements[0] });
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (ts.isIdentifier(decl.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          const body = init.body;
          found.push({ name: decl.name.text, body, firstStatement: ts.isBlock(body) ? body.statements[0] : undefined });
        }
      }
    }
  }
  return found;
}

function callsRequireUserFirst(fn: ExportedFn): boolean {
  // The first statement must be `const actor = await requireUser();` (or `await requireUser();`).
  const first = fn.firstStatement;
  if (!first) return false;
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "requireUser") found = true;
    ts.forEachChild(node, visit);
  };
  visit(first);
  return found;
}

const files = readdirSync(SERVICES_DIR).filter((f) => f.endsWith(".ts"));

describe("route guard: every service checks the session first", () => {
  it("finds the service files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(join(SERVICES_DIR, file), "utf8"), ts.ScriptTarget.Latest, true);
    const service = file.replace(/\.ts$/, "");

    for (const fn of exportedFunctions(source)) {
      const id = `${service}.${fn.name}`;
      if (PUBLIC_FUNCTIONS.has(id)) continue;
      it(`${id} calls requireUser() first`, () => {
        expect(callsRequireUserFirst(fn), `${id} must start with requireUser(), or be added to PUBLIC_FUNCTIONS with a reason`).toBe(true);
      });
    }
  }

  it("public functions still exist (remove stale entries)", () => {
    const all = new Set(
      files.flatMap((file) => {
        const source = ts.createSourceFile(file, readFileSync(join(SERVICES_DIR, file), "utf8"), ts.ScriptTarget.Latest, true);
        return exportedFunctions(source).map((fn) => `${file.replace(/\.ts$/, "")}.${fn.name}`);
      }),
    );
    for (const id of PUBLIC_FUNCTIONS) expect(all.has(id), id).toBe(true);
  });

  it("services export no non-function values that could leak data", () => {
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(join(SERVICES_DIR, file), "utf8"), ts.ScriptTarget.Latest, true);
      for (const stmt of source.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        if (!ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
        for (const decl of stmt.declarationList.declarations) {
          const init = decl.initializer;
          const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
          const isConstant = init && (ts.isNumericLiteral(init) || ts.isBinaryExpression(init) || ts.isStringLiteral(init));
          expect(isFn || isConstant, `${file}: ${decl.name.getText(source)}`).toBeTruthy();
        }
      }
    }
  });
});
