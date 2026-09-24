import { describe, expect, it, vi } from "vitest";
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
  validateSignedInReceipt,
  validateVersions,
  signedReceiptFor,
  PHASE_A_CASES,
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

describe("archive failure safety", () => {
  const proverUrl = new URL("../../e2e/tools/prove-thesis-journey-live.mjs", import.meta.url);
  const source = readFileSync(proverUrl, "utf8");

  it("archival takes the URL-derived thesis id directly instead of parsing it as a URL", async () => {
    expect(source).toContain("async function archiveBestEffort(request, thesisId)");
    expect(source).toContain("await archiveBestEffort(page.request, thesisId);");
    expect(source).not.toContain("await archiveBestEffort(page.request, thesisIdFromUrl");

    const functionStart = source.indexOf("async function archiveBestEffort");
    const functionEnd = source.indexOf("\nasync function runPhaseA", functionStart);
    const prefix = `const base = "https://app.mastermind-x.com";\nconst randomUUID = () => "99999999-9999-4999-8999-999999999999";\n${source.slice(functionStart, functionEnd)}\nexport { archiveBestEffort };`;
    const moduleNamespace = await import("data:text/javascript;base64," + Buffer.from(prefix).toString("base64"));
    const archiveBestEffort = moduleNamespace.archiveBestEffort;
    expect(archiveBestEffort).toBeTypeOf("function");

    const id = "123e4567-e89b-42d3-a456-426614174000";
    const calls: unknown[][] = [];
    const response = (status: number, body: unknown) => ({ status: () => status, json: async () => body });
    const request = {
      get: async (url: string) => {
        calls.push(["GET", url]);
        return response(200, { thesis: {
          id,
          currentVersion: 2,
          lifecycleState: "active",
          current: { subject: { key: "NVDA" }, content: { title: "Proof thesis" } },
        } });
      },
      post: async (url: string, options: { data: unknown }) => {
        calls.push(["POST", url, options.data]);
        return response(200, {});
      },
    };

    await expect(archiveBestEffort(request, id)).resolves.toBe(true);
    expect(calls).toEqual([
      ["GET", "https://app.mastermind-x.com/api/theses?id=" + id],
      ["POST", "https://app.mastermind-x.com/api/theses", {
        action: "archive",
        id,
        expectedVersion: 2,
        clientRequestId: expect.any(String),
        subject: { key: "NVDA" },
        content: { title: "Proof thesis" },
      }],
    ]);
  });

  it("keeps the one helper import graph in the named module", () => {
    expect(source).toContain('from "./thesisJourneyLib.mjs"');
  });

  it("cleanup after a failed run archives by id, or by the deterministic title when the URL never yielded an id", async () => {
    const functionStart = source.indexOf("async function archiveBestEffort");
    const functionEnd = source.indexOf("\nasync function runPhaseA", functionStart);
    const prefix = `const base = "https://app.mastermind-x.com";\nconst randomUUID = () => "99999999-9999-4999-8999-999999999999";\n${source.slice(functionStart, functionEnd)}\nexport { archiveBestEffort, cleanupProofThesis };`;
    const { cleanupProofThesis } = await import("data:text/javascript;base64," + Buffer.from(prefix).toString("base64"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const title = "Proof run for release aaaaaaaa · NVDA · 2026-09-24";
    type Row = { id: string; title: string; lifecycleState: string; currentVersion?: number; current?: { subject: { key: string }; content: { title: string } } };
    type Call = [string, string, string?, string?];
    const active = (id: string): Row => ({ id, title, lifecycleState: "active", currentVersion: 1, current: { subject: { key: "NVDA" }, content: { title } } });
    const stub = (rows: Row[]) => {
      const calls: Call[] = [];
      const request = {
        get: async (url: string) => {
          calls.push(["get", url]);
          if (url.endsWith("/api/theses")) return { status: () => 200, json: async () => ({ theses: rows }) };
          const id = url.split("id=")[1];
          const row = rows.find((entry: Row) => entry.id === id);
          return row ? { status: () => 200, json: async () => ({ thesis: row }) } : { status: () => 404, json: async () => ({}) };
        },
        post: async (url: string, options: { data: { action: string; id: string } }) => { calls.push(["post", url, options.data.action, options.data.id]); return { status: () => 200 }; },
      };
      return { page: { request }, calls };
    };
    try {
      const byId = stub([active("11111111-1111-4111-8111-111111111111")]);
      await expect(cleanupProofThesis(byId.page, "11111111-1111-4111-8111-111111111111", true, title)).resolves.toBe(true);
      expect(byId.calls.filter((call: Call) => call[0] === "post")).toEqual([["post", "https://app.mastermind-x.com/api/theses", "archive", "11111111-1111-4111-8111-111111111111"]]);

      const byTitle = stub([active("22222222-2222-4222-8222-222222222222"), { id: "33333333-3333-4333-8333-333333333333", title: "another", lifecycleState: "active" }]);
      await expect(cleanupProofThesis(byTitle.page, null, true, title)).resolves.toBe(true);
      expect(byTitle.calls.filter((call: Call) => call[0] === "post")).toEqual([["post", "https://app.mastermind-x.com/api/theses", "archive", "22222222-2222-4222-8222-222222222222"]]);

      const ambiguous = stub([active("44444444-4444-4444-8444-444444444444"), active("55555555-5555-4555-8555-555555555555")]);
      await expect(cleanupProofThesis(ambiguous.page, null, true, title)).resolves.toBe(false);
      expect(ambiguous.calls.filter((call: Call) => call[0] === "post")).toEqual([]);

      const untouched = stub([active("66666666-6666-4666-8666-666666666666")]);
      await expect(cleanupProofThesis(untouched.page, null, false, title)).resolves.toBe(false);
      expect(untouched.calls).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it("rejects the previous implementation when a URL-derived UUID is passed directly", async () => {
    const oldSource = `
async function archiveBestEffort(request, rawUrl) {
  try {
    const thesisId = thesisIdFromUrl(rawUrl);
    const detailResponse = await request.get(\`\${base}/api/theses?id=\${thesisId}\`);
    if (detailResponse.status() !== 200) return false;
    const thesis = (await detailResponse.json())?.thesis;
    if (!thesis || thesis.id !== thesisId || thesis.lifecycleState !== "active") return false;
    const archiveResponse = await request.post(\`\${base}/api/theses\`, { data: { action: "archive", id: thesisId } });
    return archiveResponse.status() === 200;
  } catch {
    return false;
  }
}
`;
    const functionStart = oldSource.indexOf("async function archiveBestEffort");
    const functionEnd = oldSource.indexOf("\nasync function runPhaseA", functionStart);
    const prefix = `const base = "https://app.mastermind-x.com";\nconst thesisIdFromUrl = () => { throw new Error("The URL parser failed."); };\n${oldSource.slice(functionStart, functionEnd)}\nexport { archiveBestEffort };`;
    const oldArchiveBestEffort = (await import("data:text/javascript;base64," + Buffer.from(prefix).toString("base64"))).archiveBestEffort;
    const request = {
      get: () => { throw new Error("No HTTP call should be needed after the URL parser fails."); },
      post: () => { throw new Error("No HTTP call should be needed after the URL parser fails."); },
    };

    await expect(oldArchiveBestEffort(request, "123e4567-e89b-42d3-a456-426614174000")).resolves.toBe(false);
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

describe("validateSignedInReceipt", () => {
  const completePhaseB = {
    ran: true,
    route: "operator_url",
    versions: [
      { version: 1, previousVersion: null },
      { version: 2, previousVersion: 1 },
      { version: 3, previousVersion: 2 },
    ],
    archived: true,
  };

  it("accepts only the complete operator journey with Phase B's own error count", () => {
    expect(validateSignedInReceipt(receipt({ phaseB: completePhaseB }))).toBe(true);
  });

  it("rejects an unarchived journey, broken lineage, and a browser error", () => {
    expect(validateSignedInReceipt(receipt({
      phaseB: { ...completePhaseB, archived: false },
    }))).toBe(false);
    expect(validateSignedInReceipt(receipt({
      phaseB: { ...completePhaseB, versions: completePhaseB.versions.slice(0, 2) },
    }))).toBe(false);
    expect(validateSignedInReceipt(receipt({
      phaseB: completePhaseB,
      browserErrorCount: 1,
    }))).toBe(false);
  });
});

describe("signedReceiptFor", () => {
  const phaseA = PHASE_A_CASES.map(([name, status]) => ({ case: name, ok: true, status }));
  const phaseB = {
    ran: true,
    route: "operator_url",
    versions: [
      { version: 1, previousVersion: null },
      { version: 2, previousVersion: 1 },
      { version: 3, previousVersion: 2 },
    ],
    archived: true,
    browserErrorCount: 0,
  };
  const meta = { base: "https://app.mastermind-x.com", expectedRelease: "a".repeat(40) };

  it("binds the receipt's error count to the Phase B result's own count", () => {
    expect(signedReceiptFor(phaseA, phaseB, meta).browserErrorCount).toBe(0);
    expect(signedReceiptFor(phaseA, { ...phaseB, browserErrorCount: 2 }, meta).browserErrorCount).toBe(2);
    expect(signedReceiptFor(phaseA, phaseB, meta).phaseB).toBe(phaseB);
  });

  it("refuses a Phase B result that did not run or does not carry its own count (the round-4 defect)", () => {
    expect(() => signedReceiptFor(phaseA, { ...phaseB, browserErrorCount: undefined }, meta)).toThrow(TypeError);
    expect(() => signedReceiptFor(phaseA, { ...phaseB, ran: false }, meta)).toThrow(TypeError);
    expect(() => signedReceiptFor(phaseA, undefined, meta)).toThrow(TypeError);
  });

  it("produces a receipt validateSignedInReceipt accepts, and one it rejects when Phase B saw a browser error", () => {
    expect(validateSignedInReceipt(signedReceiptFor(phaseA, phaseB, meta))).toBe(true);
    expect(validateSignedInReceipt(signedReceiptFor(phaseA, { ...phaseB, browserErrorCount: 1 }, meta))).toBe(false);
  });
});
