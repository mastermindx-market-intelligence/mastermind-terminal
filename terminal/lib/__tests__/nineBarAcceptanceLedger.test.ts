import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const terminal = path.resolve(__dirname, "../..");
const repo = path.resolve(terminal, "..");
const ledger = readFileSync(path.join(repo, "docs/verification/NINE_BAR_EXHAUSTION_ACCEPTANCE_2026-10-15.md"), "utf8");
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("Nine-Bar acceptance ledger artifact identities", () => {
  it("quotes the current research receipt and browser-report hashes", () => {
    const research = JSON.parse(readFileSync(path.join(repo, "docs/research/NINE_BAR_RESEARCH_RESULTS_2026-10-13.json"), "utf8"));
    const nineReport = sha256(path.join(terminal, "docs/pr-crops/nine-bar-exhaustion/browser-report.json"));
    const visualReport = sha256(path.join(terminal, "docs/pr-crops/terminal-visual-intelligence/browser-report.json"));
    expect(ledger).toContain(research.receiptSha256);
    expect(ledger).toContain(nineReport);
    expect(ledger).toContain(visualReport);
  });
});
