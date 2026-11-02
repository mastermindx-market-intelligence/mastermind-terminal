import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as lib from "../../e2e/tools/thesisJourneyLib.mjs";

// Execute the actual incumbent Phase B/C composition, without importing the CLI's
// main() or launching a browser. Only external browser/filesystem inputs are fake.
const source = readFileSync(new URL("../../e2e/tools/prove-thesis-journey-live.mjs", import.meta.url), "utf8");
const body = source.slice(source.indexOf("async function runPhaseB("), source.indexOf("// Phase B's receipt"));
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const thesisId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const identity = (id: string | null) => ({ status: () => id ? 200 : 401, json: async () => ({ schema: "mmx.cookie-principal.v1", verified: true, principalId: id }) });
class Failure extends Error {}

async function fixture({ ownerId = owner as string | null, closeFailure = false, laterOwnerFailure = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "f11-composition-"));
  const controls = Object.fromEntries(["workspace", "rail", "thesesTab", "coverageTab", "newThesis", "subject", "title", "statement", "catalysts", "risks", "horizon", "revisionNote", "save", "archive"].map((key) => [key, {
    click: vi.fn(async () => {}), fill: vi.fn(async () => {}), selectOption: vi.fn(async () => {}),
    getAttribute: vi.fn(async () => "ready"), isDisabled: vi.fn(async () => true), and() { return this; },
  }]));
  const locator = { getByRole: () => locator, filter: () => locator };
  const ownerRequest = { get: vi.fn(async () => identity(ownerId)), post: vi.fn(async () => ({ status: () => 409 })) };
  const page = { request: ownerRequest, on: vi.fn(), getByTestId: () => locator, locator: () => locator,
    waitForURL: vi.fn(async () => {}), url: () => `https://terminal.test/analysis?thesis=${thesisId}`, reload: vi.fn(async () => {}) };
  const otherRequest = { get: vi.fn(async (url: string) => url.endsWith("/api/auth/principal") ? identity(other) : ({ status: () => 200, json: async () => ({}) })), post: vi.fn() };
  const otherPage = { request: otherRequest, on: vi.fn(), goto: vi.fn() };
  const context = { newPage: async () => page, close: vi.fn(async () => {}) };
  const otherContext = { newPage: async () => otherPage, close: vi.fn(async () => { if (closeFailure) throw new Error("synthetic-close-secret"); }) };
  const browser = { newContext: vi.fn().mockResolvedValueOnce(context).mockResolvedValueOnce(otherContext), close: vi.fn(async () => {}) };
  const cleanupProofThesis = vi.fn(async () => true);
  const assertResponse = vi.fn(async () => { if (laterOwnerFailure && assertResponse.mock.calls.length === 2) throw new Error("synthetic-owner-secret"); });
  let reads = 0;
  const readThesis = vi.fn(async () => {
    const version = [1, 2, 2, 3][reads++];
    return { currentVersion: version, lifecycleState: version === 3 ? "archived" : "active", current: { version, previousVersion: version === 1 ? null : version - 1, content: {}, subject: {} }, history: Array.from({ length: version }, () => ({})) };
  });
  const dependencies = { ...lib, chromium: { launch: async () => browser }, ProofFailure: Failure,
    assertion: () => { throw new Failure(); }, assertResponse, preflightLocators: async () => controls,
    settle: async (value: unknown) => value, settleVersion: async () => {}, readThesis,
    readJson: async () => ({ error: "version_conflict", currentVersion: 2 }),
    subjectPayload: () => ({}), contentPayload: () => ({}), randomUUID: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    storageStateArgument: "owner.json", realpathSync: (s: string) => s, resolve: (s: string) => s,
    readFileSync: () => "{}", mkdirSync, writeFileSync, join, liveStateDir: dir,
    base: "https://terminal.test", release: "a".repeat(40), symbol: "NVDA", cleanupProofThesis,
    console: { log: vi.fn() } };
  const run = new Function(...Object.keys(dependencies), `${body}; return runPhaseB;`)(...Object.values(dependencies));
  return { dir, run, page, controls, otherRequest, cleanupProofThesis };
}

describe("actual Phase B/C composition and retained partial evidence", () => {
  it("verifies the owner before any create", async () => {
    const f = await fixture({ ownerId: null });
    try {
      await expect(f.run({}, { path: "other.json" })).rejects.toThrow();
      expect(f.controls.newThesis.click).not.toHaveBeenCalled();
      expect(f.otherRequest.get).not.toHaveBeenCalled();
    } finally { rmSync(f.dir, { recursive: true }); }
  });

  it("preserves an unsafe read across other-context close failure while preserving owner archive", async () => {
    const f = await fixture({ closeFailure: true });
    try {
      const result = await f.run({}, { path: "other.json" });
      expect(result.phaseC).toMatchObject({ ran: true, read: 200, revise: null, archive: null, reason: "phase_c_error", ok: false, leak: true });
      expect(f.otherRequest.post).not.toHaveBeenCalled();
      expect(f.controls.archive.click).toHaveBeenCalledOnce();
      expect(f.cleanupProofThesis).not.toHaveBeenCalled();
      const persisted = readFileSync(join(f.dir, "receipt-phase-c.json"), "utf8");
      expect(JSON.parse(persisted).phaseC).toMatchObject({ ran: true, read: 200, reason: "phase_c_error" });
      expect(persisted).not.toContain(owner);
      expect(persisted).not.toContain(other);
      expect(persisted).not.toContain("synthetic-close-secret");
    } finally { rmSync(f.dir, { recursive: true }); }
  });

  it("retains partial C evidence when later owner work fails and original owner cleanup runs", async () => {
    const f = await fixture({ laterOwnerFailure: true });
    try {
      await expect(f.run({}, { path: "other.json" })).rejects.toThrow();
      expect(f.otherRequest.post).not.toHaveBeenCalled();
      expect(f.cleanupProofThesis).toHaveBeenCalledWith(f.page, thesisId, true, expect.any(String));
      const retained = JSON.parse(readFileSync(join(f.dir, "receipt-phase-c.json"), "utf8"));
      expect(retained).toMatchObject({ ownerJourney: "in_progress", phaseC: { ran: true, read: 200, revise: null, archive: null, reason: "read_not_denied" } });
    } finally { rmSync(f.dir, { recursive: true }); }
  });
});
