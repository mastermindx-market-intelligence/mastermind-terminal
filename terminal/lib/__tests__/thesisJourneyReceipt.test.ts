import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  detailFromResponse,
  exitCodeFor,
  redactReceipt,
  storageStateError,
  thesisIdFromUrl,
  validateReceipt,
  validateVersions,
} from "../../e2e/tools/thesisJourneyReceipt.mjs";

const root = "/terminal";
const release = "a".repeat(40);

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    capturedAt: "2026-09-24T10:00:00.000Z",
    base: "https://app.mastermind-x.com",
    expectedRelease: release,
    phaseA: Array.from({ length: 5 }, (_, index) => ({
      case: `case-${index}`,
      status: index < 2 ? 200 : 401,
      ok: true,
    })),
    phaseB: { ran: false, route: "none", versions: [], archived: false },
    browserErrors: [],
    ...overrides,
  };
}

describe("redactReceipt", () => {
  it("preserves proof identity and UUIDs", () => {
    const input = receipt({
      thesisId: "123e4567-e89b-42d3-a456-426614174000",
      longStatement: "Ordinary evidence can be long without becoming a credential.",
    });
    expect(redactReceipt(input)).toEqual(input);
  });

  it("preserves ISO timestamps and redacts JWTs, emails, and credential-shaped strings", () => {
    const redacted = redactReceipt(receipt({
      createdAt: "2026-09-24T12:00:00.000Z",
      authToken: "header.payload.signature",
      "operator@example": "operator@example.com",
      nested: { refreshToken: "header.payload.signature" },
      longCredential: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=",
    })) as Record<string, unknown>;
    expect(redacted.createdAt).toBe("2026-09-24T12:00:00.000Z");
    expect(redacted.authToken).toBe("[REDACTED]");
    expect(redacted["operator@example"]).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).refreshToken).toBe("[REDACTED]");
    expect(redacted.longCredential).toBe("[REDACTED]");
  });
});

describe("storageStateError", () => {
  const liveState = "/terminal/e2e/.live-state/state.json";
  const dependencies = {
    existsSync: () => true,
    readFileSync: () => "e2e/.live-state/",
    resolve: () => liveState,
    root,
    trackedPaths: () => new Set<string>(),
  };

  it("reports absence and outside paths without exposing the path", () => {
    expect(storageStateError("", {
      ...dependencies,
      existsSync: () => false,
    })).toBe("operator storage state was not supplied");
    expect(storageStateError(liveState, {
      ...dependencies,
      existsSync: () => false,
    })).toBe("operator storage state file does not exist");
    expect(storageStateError(liveState, {
      ...dependencies,
      resolve: () => "/terminal/insecure/state.json",
    })).toBe("operator storage state must be inside the git-ignored live-state directory");
  });

  it("fails closed when the ignore line is missing or git status is unavailable", () => {
    expect(storageStateError(liveState, {
      ...dependencies,
      readFileSync: () => "",
    })).toBe("operator storage state directory is not git-ignored");
    expect(storageStateError(liveState, {
      ...dependencies,
      trackedPaths: () => null,
    })).toBe("operator storage state git status is unavailable");
  });

  it("rejects only a tracked live-state file", () => {
    expect(storageStateError(liveState, {
      ...dependencies,
      trackedPaths: () => new Set(["e2e/.live-state/state.json"]),
    })).toBe("operator storage state is tracked by git");
    expect(storageStateError(liveState, dependencies)).toBeNull();
  });
});

describe("proof identity", () => {
  it("accepts only the UUID in the thesis URL query", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(thesisIdFromUrl(`https://app.test/analysis?view=theses&thesis=${id}`)).toBe(id);
    expect(() => thesisIdFromUrl("https://app.test/analysis?view=theses")).toThrow("Created proof thesis id was not returned through the URL.");
  });

  it("accepts only a detail response for the URL-derived thesis", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(detailFromResponse({ id }, id)?.id).toBe(id);
    expect(() => detailFromResponse(null, id)).toThrow("Detail response did not return the proof thesis.");
    expect(() => detailFromResponse({ id: "00000000-0000-4000-8000-000000000000" }, id)).toThrow("Detail response did not return the proof thesis.");
  });
});

describe("version invariants", () => {
  it("requires exact create, revision, and archive lineage", () => {
    const version = (version: number, previousVersion: number | null) => ({ version, previousVersion });
    expect(validateVersions({
      created: { currentVersion: 1, lifecycleState: "active", current: version(1, null), history: [version(1, null)] },
      revised: { currentVersion: 2, lifecycleState: "active", current: version(2, 1), history: [{}, {}] },
      archived: { currentVersion: 3, lifecycleState: "archived", current: version(3, 2), history: [{}, {}, {}] },
    })).toBe(true);
    expect(validateVersions({
      created: { currentVersion: 1, lifecycleState: "active", current: version(1, null), history: [version(1, null)] },
      revised: { currentVersion: 2, lifecycleState: "active", current: version(2, 1), history: [{}] },
      archived: { currentVersion: 3, lifecycleState: "archived", current: version(3, 2), history: [{}, {}, {}] },
    })).toBe(false);
  });
});

describe("exit codes", () => {
  it("separates malformed releases, assertion failures, and success", () => {
    expect(exitCodeFor("release")).toBe(2);
    expect(exitCodeFor("assertion")).toBe(1);
    expect(exitCodeFor("unexpected")).toBe(1);
    expect(exitCodeFor(null)).toBe(0);
  });
});

describe("prover source contract", () => {
  const prover = readFileSync(new URL("../../e2e/tools/prove-thesis-journey-live.mjs", import.meta.url), "utf8");

  it("actually invokes the storage-state guard and tracks browser errors by count", () => {
    expect(prover).toContain('import { execFileSync } from "node:child_process";');
    expect(prover).toContain("return storageStateError(path, {");
    expect(prover).not.toContain("browserErrors: phaseA.browserErrors");
  });

  it("binds Phase B identity through the URL and asserted controls", () => {
    expect(prover).toContain('getByRole("button", { name: "New thesis", exact: true })');
    expect(prover).not.toContain('getByLabel("New thesis")');
    expect(prover).not.toContain("data-thesis-id");
    expect(prover).toContain("const thesisId = thesisIdFromUrl(page.url());");
    expect(prover).toContain("if (thesisIdFromUrl(page.url()) !== thesisId)");
  });

  it("release-checks navigation and declares the signed receipt locally", () => {
    expect(prover).toContain("await assertResponse(page, `${base}/alerts`);");
    expect(prover).not.toMatch(/textContent\(\)[\s\S]*release/);
    expect(prover).toContain("const signedReceipt = receiptFor(phaseA, phaseB, browserErrorCount);");
  });
});

describe("validateReceipt", () => {
  it("accepts only a complete anonymous proof receipt", () => {
    expect(validateReceipt(receipt())).toBe(true);
  });

  it("rejects a redacted release", () => {
    expect(validateReceipt(receipt({ expectedRelease: "[REDACTED]" }))).toBe(false);
  });

  it("rejects incomplete Phase A or browser errors", () => {
    const incomplete = receipt();
    incomplete.phaseA = incomplete.phaseA.slice(0, 4);
    expect(validateReceipt(incomplete)).toBe(false);
    expect(validateReceipt(receipt({ browserErrors: ["page error"] }))).toBe(false);
  });

  it("never accepts a signed-in receipt as anonymous proof", () => {
    expect(validateReceipt(receipt({
      phaseB: { ran: true, route: "rail", versions: [1], archived: true },
    }))).toBe(false);
  });
});
