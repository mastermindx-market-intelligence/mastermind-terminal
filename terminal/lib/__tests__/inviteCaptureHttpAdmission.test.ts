import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const recipePath = join(__dirname, "../../e2e/tools/capture_w9t_f12_17_invite_link.cjs");
function recipeFunction(name: string, bindings: Record<string, unknown>) {
  const source = readFileSync(recipePath, "utf8");
  const parsed = ts.createSourceFile(recipePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fn = parsed.statements.find(
    (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (!fn) throw new Error(`Capture recipe function not found: ${name}`);
  return runInNewContext("(" + fn.getText(parsed) + ")", {
    BASE: "http://127.0.0.1:3541", PORT: 3541, ...bindings,
  }, { timeout: 1000 });
}

describe("Invitation capture HTTP admission", () => {
  it.each([302, 404, 500])("refuses HTTP %i as a ready fixture server", async (status) => {
    let clock = 0;
    const waitForServer = recipeFunction("waitForServer", {
      Date: { now: () => clock },
      fetch: async () => new Response(null, { status }),
      setTimeout: (callback: () => void, delay: number) => { clock += delay; callback(); },
    });
    await expect(waitForServer(1000)).rejects.toThrow("never answered");
  });

  it("admits an HTTP 200 fixture server", async () => {
    const waitForServer = recipeFunction("waitForServer", {
      Date: { now: () => 0 },
      fetch: async () => new Response(null, { status: 200 }),
    });
    await expect(waitForServer(1000)).resolves.toBeUndefined();
  });

  it.each([404, 500, null])("rejects navigation status %s before rendering assertions or capture", async (status) => {
    const gotoChecked = recipeFunction("gotoChecked", {});
    const page = { goto: async () => status === null ? null : { ok: () => false, status: () => status } };
    await expect(gotoChecked(page, "http://127.0.0.1:3541/dev/settings?s=team&lang=en")).rejects.toThrow();
  });

  it("preserves URL, loading event and timeout for a successful navigation", async () => {
    const calls: unknown[] = [];
    const page = { goto: async (...args: unknown[]) => { calls.push(args); return { ok: () => true, status: () => 200 }; } };
    const gotoChecked = recipeFunction("gotoChecked", {});
    const url = "http://127.0.0.1:3541/invite?token=fixture-token";
    await expect(gotoChecked(page, url)).resolves.toBeUndefined();
    expect(calls).toEqual([[url, { waitUntil: "domcontentloaded", timeout: 90_000 }]]);
  });
});
