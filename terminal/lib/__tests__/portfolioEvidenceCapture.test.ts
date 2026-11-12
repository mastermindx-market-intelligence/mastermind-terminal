import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { it } from "vitest";

it("preserves full native Portfolio capture geometry and rejects incomplete packets", () => {
  execFileSync(process.execPath, ["--test", join(__dirname, "../../e2e/tools/portfolioEvidenceCapture.test.cjs")], {
    encoding: "utf8",
    stdio: "pipe",
  });
});

it("preserves a Risk navigation failure when the pending response is cancelled during teardown", () => {
  const script = `
    const assert = require("node:assert/strict");
    const { captureState } = require(process.argv[1]);
    let rejectResponse;
    const pending = new Promise((_, reject) => { rejectResponse = reject; });
    const navigation = new Error("native risk tab unavailable");
    const ready = { first() { return this; }, async waitFor() {} };
    const page = {
      request: { async post() { return { ok: () => true, json: async () => ({}) }; } },
      async goto() {}, async evaluate() {},
      waitForResponse() { return pending; },
      locator(selector) {
        return selector.includes("time[datetime]") ? ready : { async click() { throw navigation; } };
      },
    };
    (async () => {
      await assert.rejects(captureState(page, 1440, "en", "populated", "unused.png"),
        error => error === navigation);
      rejectResponse(new Error("context closed during ordinary teardown"));
      await new Promise(resolve => setImmediate(resolve));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  execFileSync(process.execPath, [
    "--unhandled-rejections=strict", "-e", script,
    join(__dirname, "../../e2e/tools/capture_b_f08_9_risk_history.cjs"),
  ], { encoding: "utf8", stdio: "pipe" });
});
