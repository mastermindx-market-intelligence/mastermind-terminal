import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { it } from "vitest";

it("preserves full native Portfolio capture geometry and rejects incomplete packets", () => {
  execFileSync(process.execPath, ["--test", join(__dirname, "../../e2e/tools/portfolioEvidenceCapture.test.cjs")], {
    encoding: "utf8",
    stdio: "pipe",
  });
});
