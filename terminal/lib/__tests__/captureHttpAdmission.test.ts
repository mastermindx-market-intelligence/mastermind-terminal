import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const recipePath = join(__dirname, "../../e2e/tools/capture_pl6_batch1.cjs");
function recipeFunction(name: string, bindings: Record<string, unknown>) {
  const source = readFileSync(recipePath, "utf8");
  const parsed = ts.createSourceFile(recipePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fn = parsed.statements.find(
    (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (!fn) throw new Error("Capture recipe function not found");
  return runInNewContext("(" + fn.getText(parsed) + ")", {
    BASE: "http://127.0.0.1:3536", PORT: 3536, ...bindings,
  }, { timeout: 1000 });
}

describe("PL6 capture HTTP admission", () => {
  it.each([302, 404, 500])("does not treat HTTP %i as a ready fixture server", async (status) => {
    let clock = 0;
    const waitForServer = recipeFunction("waitForServer", {
      Date: { now: () => clock },
      fetch: async () => new Response(null, { status }),
      setTimeout: (callback: () => void, delay: number) => { clock += delay; callback(); },
    });
    await expect(waitForServer(1000)).rejects.toThrow("never answered");
  });

  it("accepts an HTTP 200 fixture server", async () => {
    const waitForServer = recipeFunction("waitForServer", {
      Date: { now: () => 0 },
      fetch: async () => new Response(null, { status: 200 }),
    });
    await expect(waitForServer(1000)).resolves.toBeUndefined();
  });

  it.each([404, 500, null])("rejects navigation status %s before changing language or capturing", async (status) => {
    let languageWrites = 0;
    let captureWaits = 0;
    const gotoReady = recipeFunction("gotoReady", {
      ensureLang: async () => { languageWrites += 1; },
    });
    const page = {
      goto: async () => status === null ? null : { ok: () => status === 200, status: () => status },
      waitForTimeout: async () => { captureWaits += 1; },
    };
    await expect(gotoReady(page, "/discover?tab=leaders", "en")).rejects.toThrow();
    expect(languageWrites).toBe(0);
    expect(captureWaits).toBe(0);
  });

  it("preserves navigation and language setup after a successful response", async () => {
    const events: string[] = [];
    const page = {
      goto: async (url: string) => { events.push(url); return { ok: () => true, status: () => 200 }; },
      waitForTimeout: async (ms: number) => { events.push(String(ms)); },
    };
    const gotoReady = recipeFunction("gotoReady", {
      ensureLang: async (actualPage: unknown, lang: string) => {
        expect(actualPage).toBe(page); events.push(lang);
      },
    });
    await expect(gotoReady(page, "/discover?tab=leaders", "zh")).resolves.toBeUndefined();
    expect(events).toEqual(["http://127.0.0.1:3536/discover?tab=leaders", "zh", "400"]);
  });
});
