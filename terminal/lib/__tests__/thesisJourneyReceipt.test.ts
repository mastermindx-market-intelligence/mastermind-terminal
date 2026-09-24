import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildProofTitle,
  checkStorageState,
  detailFromResponse,
  exitCodeFor,
  redactReceipt,
  releaseFromHtml,
  thesisIdFromUrl,
  validateReceipt,
  validateVersions,
} from "../../e2e/tools/thesisJourneyLib.mjs";

const root = "/terminal";
const release = "a".repeat(40);

function baseReceipt() {
  return {
    capturedAt: "2026-09-24T10:00:00.000Z",
    base: "https://app.mastermind-x.com",
    expectedRelease: release,
    phaseA: Array.from({ length: 5 }, (_, index) => ({
      case: [
        "Analysis gate blocks the thesis workspace.",
        "Theses view stays anonymous.",
        "Anonymous thesis list is rejected.",
        "Anonymous thesis creation is rejected.",
        "Anonymous saved views are rejected.",
      ][index],
      status: index < 2 ? 200 : 401,
      ok: true,
    })),
    phaseB: { ran: false, route: "none", versions: [], archived: false },
    browserErrorCount: 0,
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return { ...baseReceipt(), ...overrides };
}

describe("redactReceipt", () => {
  it("preserves proof identity and UUIDs", () => {
    const input = receipt({
      thesisId: "123e4567-e89b-42d3-a456-426614174000",
      longStatement: "Ordinary evidence can be long without becoming a credential.",
    });
    expect(redactReceipt(input)).toEqual(input);
  });

  it("redacts credential-shaped values and sensitive keys without exposing their values", () => {
    const redacted = redactReceipt(receipt({
      createdAt: "2026-09-24T12:00:00.000Z",
      authToken: "header.payload.signature",
      "operator@example": "operator@example.com",
      nested: { refreshToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc-def_1234567890" },
      longCredential: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=",
      urlCredential: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo",
    })) as Record<string, unknown>;
    expect(redacted.createdAt).toBe("2026-09-24T12:00:00.000Z");
    expect(redacted.authToken).toBe("[REDACTED]");
    expect(redacted["operator@example"]).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).refreshToken).toBe("[REDACTED]");
    expect(redacted.longCredential).toBe("[REDACTED]");
    expect(redacted.urlCredential).toBe("[REDACTED]");
  });
});

describe("checkStorageState", () => {
  const liveState = "/terminal/e2e/.live-state/state.json";
  const validState = JSON.stringify({ cookies: [], origins: [] });

  function dependencies(overrides: Record<string, unknown> = {}) {
    return {
      fs: {
        existsSync: () => true,
        readFileSync: (path: string) => (path.endsWith(".gitignore") ? "e2e/.live-state/\n" : validState),
        realpathSync: (path: string) => path,
        statSync: () => ({ isFile: () => true }),
      },
      execFileSync: () => "",
      root,
      ...overrides,
    };
  }

  it("refuses a missing state and a state outside the live-state root", () => {
    expect(checkStorageState("", dependencies())).toBe("The operator storage state was not supplied.");
    expect(checkStorageState(liveState, dependencies({
      fs: { ...dependencies().fs, existsSync: () => false },
    }))).toBe("The operator storage state file does not exist.");
    expect(checkStorageState("/terminal/insecure/state.json", dependencies())).toBe(
      "The operator storage state must be inside the git-ignored live-state directory.",
    );
  });

  it("refuses malformed state without reading a credential into the result", () => {
    expect(checkStorageState(liveState, dependencies({
      fs: { ...dependencies().fs, readFileSync: (path: string) => (path.endsWith(".gitignore") ? "e2e/.live-state/\n" : "{") },
    }))).toBe("The operator storage state file is malformed.");
    expect(checkStorageState(liveState, dependencies({
      fs: { ...dependencies().fs, readFileSync: (path: string) => (path.endsWith(".gitignore") ? "e2e/.live-state/\n" : "{\"cookies\":{}}") },
    }))).toBe("The operator storage state file is malformed.");
  });

  it("fails closed when ignore coverage or git tracking cannot be established", () => {
    expect(checkStorageState(liveState, dependencies({
      fs: { ...dependencies().fs, readFileSync: () => "" },
    }))).toBe("The operator storage state directory is not git-ignored.");
    expect(checkStorageState(liveState, dependencies({
      execFileSync: () => { throw new Error("git is unavailable"); },
    }))).toBe("The operator storage state tracking could not be checked.");
  });

  it("refuses tracked state and accepts untracked state inside the root", () => {
    expect(checkStorageState(liveState, dependencies({
      execFileSync: () => "e2e/.live-state/state.json\n",
    }))).toBe("The operator storage state is tracked by git.");
    expect(checkStorageState(liveState, dependencies())).toBeNull();
  });
});

describe("proof identity and labels", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";

  it("accepts only one valid UUID from the thesis URL", () => {
    expect(thesisIdFromUrl(`https://app.test/analysis?view=theses&thesis=${id}`)).toBe(id);
    expect(() => thesisIdFromUrl("https://app.test/analysis?view=theses")).toThrow(
      "The created proof thesis id was not returned through the URL.",
    );
    expect(() => thesisIdFromUrl(`https://app.test/analysis?thesis=${id}&thesis=${id}`)).toThrow(
      "The created proof thesis id was not returned through the URL.",
    );
  });

  it("accepts only a detail response for the URL-derived thesis", () => {
    expect(detailFromResponse({ id }, id)?.id).toBe(id);
    expect(() => detailFromResponse(null, id)).toThrow("Detail response did not return the proof thesis.");
    expect(() => detailFromResponse({ id: "00000000-0000-4000-8000-000000000000" }, id)).toThrow(
      "Detail response did not return the proof thesis.",
    );
  });

  it("builds one bilingual plain-sentence title bound to release and time", () => {
    const title = buildProofTitle(release, "NVDA", new Date("2026-09-24T17:35:00.000Z"));
    expect(title).toBe("Live proof at release aaaaaaaa: NVDA on 2026-09-24. 发布 aaaaaaaa 的 NVDA 实测。");
  });
});

describe("releaseFromHtml", () => {
  it("reads the deployment id only from the html element", () => {
    expect(releaseFromHtml(`<html lang="en" data-dpl-id="${release}"><body></body></html>`)).toBe(release);
    expect(releaseFromHtml(`<html lang="en"><body data-dpl-id="${release}"></body></html>`)).toBeNull();
    expect(releaseFromHtml(`<html lang="en" data-dpl-id="abc"></html>`)).toBeNull();
  });
});

describe("version invariants", () => {
  it("requires exact create, revision, and archive lineage", () => {
    const version = (versionNumber: number, previousVersion: number | null) => ({ version: versionNumber, previousVersion });
    const complete = {
      created: { currentVersion: 1, lifecycleState: "active", current: version(1, null), history: [version(1, null)] },
      revised: { currentVersion: 2, lifecycleState: "active", current: version(2, 1), history: [{}, {}] },
      archived: { currentVersion: 3, lifecycleState: "archived", current: version(3, 2), history: [{}, {}, {}] },
    };
    expect(validateVersions(complete)).toBe(true);
    expect(validateVersions({ ...complete, revised: { ...complete.revised, history: [{}] } })).toBe(false);
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

  it("preflights locators before each write and archives the URL-derived thesis on failure", () => {
    expect(prover).toContain("await preflightLocators(page, [");
    expect(prover).toContain("await archiveBestEffort(page.request, thesisId);");
    expect(prover).toContain("thesisId = thesisIdFromUrl(page.url());");
    expect(prover).not.toContain("console.error(`Proof failed: ${error.message}`)");
    expect(prover).not.toContain("reopen");
    expect(prover).not.toContain("invalidate");
  });
});

describe("validateReceipt", () => {
  it("accepts only a complete anonymous proof receipt", () => {
    expect(validateReceipt(receipt())).toBe(true);
  });

  it("rejects a redacted release and incomplete Phase A", () => {
    expect(validateReceipt(receipt({ expectedRelease: "[REDACTED]" }))).toBe(false);
    const incomplete = receipt();
    incomplete.phaseA = incomplete.phaseA.slice(0, 4);
    expect(validateReceipt(incomplete)).toBe(false);
    const failedCase = baseReceipt();
    failedCase.phaseA[0] = { ...failedCase.phaseA[0], ok: false };
    expect(validateReceipt(failedCase)).toBe(false);
  });

  it("rejects any browser error count other than zero", () => {
    expect(validateReceipt(receipt({ browserErrorCount: 1 }))).toBe(false);
    expect(validateReceipt(receipt({ browserErrorCount: "0" }))).toBe(false);
    const withoutCount = baseReceipt();
    expect(validateReceipt({ ...withoutCount, browserErrorCount: undefined })).toBe(false);
  });

  it("never accepts a signed-in receipt as anonymous proof", () => {
    expect(validateReceipt(receipt({
      phaseB: { ran: true, route: "operator_url", versions: [1], archived: true },
    }))).toBe(false);
  });
});
