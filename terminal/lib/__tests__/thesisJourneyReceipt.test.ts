import { describe, expect, it } from "vitest";
import { redactReceipt, validateReceipt, type ThesisJourneyReceipt } from "../thesisJourneyReceipt";

describe("redactReceipt", () => {
  it("passes through a clean receipt unchanged", () => {
    const receipt: ThesisJourneyReceipt = {
      capturedAt: "2026-09-24T10:00:00.000Z",
      base: "https://app.mastermind-x.com",
      expectedRelease: "1d2ac1e6da1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
      phaseA: [
        { case: "GET /analysis?symbol=NVDA", status: 200, ok: true, heading: "Analysis", testid: "not-thesis-workspace" },
      ],
      phaseB: { ran: false, route: "none", versions: [], archived: false },
      browserErrors: [],
    };
    expect(redactReceipt(receipt)).toEqual(receipt);
  });

  it("redacts JWT-like tokens", () => {
    const receipt = {
      capturedAt: "2026-09-24T10:00:00.000Z",
      base: "https://app.mastermind-x.com",
      expectedRelease: "1d2ac1e6da1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
      phaseA: [],
      phaseB: { ran: false, route: "none", versions: [], archived: false },
      browserErrors: [],
      authToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    } as unknown as ThesisJourneyReceipt;
    const redacted = redactReceipt(receipt);
    expect((redacted as unknown as Record<string, unknown>).authToken).toBe("[REDACTED]");
  });

  it("redacts long base64-like tokens", () => {
    const receipt = {
      capturedAt: "2026-09-24T10:00:00.000Z",
      base: "https://app.mastermind-x.com",
      expectedRelease: "1d2ac1e6da1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
      phaseA: [],
      phaseB: { ran: false, route: "none", versions: [], archived: false },
      browserErrors: [],
      accessToken: "abc123xyzABC123xyzABC123xyzABC123xyzABC==",
    } as unknown as ThesisJourneyReceipt;
    const redacted = redactReceipt(receipt);
    expect((redacted as unknown as Record<string, unknown>).accessToken).toBe("[REDACTED]");
  });

  it("redacts email addresses", () => {
    const receipt = {
      capturedAt: "2026-09-24T10:00:00.000Z",
      base: "https://app.mastermind-x.com",
      expectedRelease: "1d2ac1e6da1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
      phaseA: [],
      phaseB: { ran: false, route: "none", versions: [], archived: false },
      browserErrors: [],
      userEmail: "user@example.com",
    } as unknown as ThesisJourneyReceipt;
    const redacted = redactReceipt(receipt);
    expect((redacted as unknown as Record<string, unknown>).userEmail).toBe("[REDACTED]");
  });

  it("recursively redacts nested objects and arrays", () => {
    const receipt = {
      capturedAt: "2026-09-24T10:00:00.000Z",
      base: "https://app.mastermind-x.com",
      expectedRelease: "1d2ac1e6da1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
      phaseA: [],
      phaseB: { ran: false, route: "none", versions: [], archived: false },
      browserErrors: [],
      nested: {
        secretToken: "abc123xyzABC123xyzABC123xyzABC==",
        user: { email: "test@test.com" },
        items: ["ordinary string", "user@domain.com"],
      },
    } as unknown as ThesisJourneyReceipt;
    const redacted = redactReceipt(receipt) as unknown as Record<string, unknown>;
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.secretToken).toBe("[REDACTED]");
    expect((nested.user as Record<string, unknown>).email).toBe("[REDACTED]");
    expect((nested.items as string[])[0]).toBe("ordinary string");
    expect((nested.items as string[])[1]).toBe("[REDACTED]");
  });

  it("does not redact ordinary strings that happen to be long", () => {
    const receipt = {
      capturedAt: "2026-09-24T10:00:00.000Z",
      base: "https://app.mastermind-x.com",
      expectedRelease: "1d2ac1e6da1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
      phaseA: [],
      phaseB: { ran: false, route: "none", versions: [], archived: false },
      browserErrors: [],
      longStatement: "This is a very long thesis statement that is longer than twenty characters and is not a token or email but just ordinary prose.",
    } as unknown as ThesisJourneyReceipt;
    const redacted = redactReceipt(receipt);
    expect((redacted as unknown as Record<string, unknown>).longStatement).toBe(
      "This is a very long thesis statement that is longer than twenty characters and is not a token or email but just ordinary prose."
    );
  });
});

describe("validateReceipt", () => {
  it("returns true for a valid receipt", () => {
    const receipt = {
      capturedAt: "2026-09-24T10:00:00.000Z",
      base: "https://app.mastermind-x.com",
      expectedRelease: "1d2ac1e6da1e2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
      phaseA: [],
      phaseB: { ran: false, route: "none", versions: [], archived: false },
      browserErrors: [],
    };
    expect(validateReceipt(receipt)).toBe(true);
  });

  it("returns false for a non-object", () => {
    expect(validateReceipt(null)).toBe(false);
    expect(validateReceipt("string")).toBe(false);
    expect(validateReceipt(123)).toBe(false);
  });

  it("returns false when required fields are missing", () => {
    expect(validateReceipt({ capturedAt: "2026-09-24T10:00:00.000Z" })).toBe(false);
    expect(validateReceipt({ base: "https://app.mastermind-x.com" })).toBe(false);
  });
});
