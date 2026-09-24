import { describe, expect, it } from "vitest";
import { redactReceipt, validateReceipt} from "../../e2e/tools/thesisJourneyReceipt.mjs";

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
      userEmail: "operator@example.com",
      nested: { accessToken: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=" },
    })) as Record<string, unknown>;
    expect(redacted.createdAt).toBe("2026-09-24T12:00:00.000Z");
    expect(redacted.authToken).toBe("[REDACTED]");
    expect(redacted.userEmail).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).accessToken).toBe("[REDACTED]");
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
