import { describe, expect, it } from "vitest";
import {
  CLAIM_OWNER_LAST_CLOSE,
  CLAIM_OWNERS,
  THRESHOLD_MAX,
  buildInsertRow,
  clientClaimPayload,
  composeClaimText,
  hashClaimId,
  validateClaimInput,
} from "@/lib/claimAuthoring";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const TOMORROW = "2026-09-10";
const TOMORROW_ISO = "2026-09-10T23:59:59.999Z";
const OWNER = CLAIM_OWNERS[0].owner;

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: { kind: "security", id: "NVDA" },
    condition: {
      metric: "close",
      comparator: ">=",
      threshold: 150,
      owner: OWNER,
    },
    resolves_at: TOMORROW_ISO,
    claim_text: composeClaimText({
      symbol: "NVDA",
      comparator: ">=",
      threshold: 150,
      date: TOMORROW,
      lang: "en",
    }),
    evidence: [],
    ...overrides,
  };
}

describe("claim authoring validation", () => {
  it("accepts a valid claim and produces a 16-hex-char claim_id", () => {
    const result = buildInsertRow(validBody(), "user-A", "2026-09-09T12:00:00.000Z", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.claim_id).toMatch(/^[0-9a-f]{16}$/);
    expect(hashClaimId(
      "user-A",
      result.row.subject,
      result.row.condition,
      result.row.stated_at,
      result.row.resolves_at,
    )).toBe(result.row.claim_id);
  });

  it("rejects a threshold that is zero or negative", () => {
    expect(validateClaimInput(validBody({
      condition: { metric: "close", comparator: ">=", threshold: 0, owner: OWNER },
    }), NOW)).toEqual({ ok: false, error: "invalid_threshold" });
    expect(validateClaimInput(validBody({
      condition: { metric: "close", comparator: ">=", threshold: -1, owner: OWNER },
    }), NOW)).toEqual({ ok: false, error: "invalid_threshold" });
  });

  it("rejects a threshold above the 1,000,000 ceiling", () => {
    expect(validateClaimInput(validBody({
      condition: { metric: "close", comparator: ">=", threshold: THRESHOLD_MAX + 1, owner: OWNER },
    }), NOW)).toEqual({ ok: false, error: "invalid_threshold" });
    expect(validateClaimInput(validBody({
      condition: { metric: "close", comparator: ">=", threshold: 1_000_000.01, owner: OWNER },
    }), NOW)).toEqual({ ok: false, error: "invalid_threshold" });
  });

  it("rejects a resolves_at date before tomorrow", () => {
    expect(validateClaimInput(validBody({
      resolves_at: "2026-09-09T23:59:59.999Z",
    }), NOW)).toEqual({ ok: false, error: "invalid_resolves_at" });
  });

  it("rejects a resolves_at date more than 730 days out", () => {
    expect(validateClaimInput(validBody({
      resolves_at: "2028-09-09T23:59:59.999Z",
    }), NOW)).toEqual({ ok: false, error: "invalid_resolves_at" });
  });

  it("omits stated_probability entirely when the opt-in checkbox is unchecked", () => {
    const payload = clientClaimPayload({
      symbol: "NVDA",
      owner: OWNER,
      comparator: ">=",
      threshold: 150,
      resolvesAtDate: TOMORROW,
      probabilityOptIn: false,
      probabilityPercent: 50,
      note: "",
      lang: "en",
    });
    expect(payload).not.toHaveProperty("stated_probability");
    expect(Object.prototype.hasOwnProperty.call(payload, "stated_probability")).toBe(false);
  });

  it("includes stated_probability only when explicitly opted in, and only in [0,1]", () => {
    const payload = clientClaimPayload({
      symbol: "NVDA",
      owner: OWNER,
      comparator: ">=",
      threshold: 150,
      resolvesAtDate: TOMORROW,
      probabilityOptIn: true,
      probabilityPercent: 50,
      note: "",
      lang: "en",
    });
    expect(payload.stated_probability).toBe(0.5);
    const low = validateClaimInput(validBody({ stated_probability: 0 }), NOW);
    const high = validateClaimInput(validBody({ stated_probability: 1 }), NOW);
    const over = validateClaimInput(validBody({ stated_probability: 1.1 }), NOW);
    const under = validateClaimInput(validBody({ stated_probability: -0.01 }), NOW);
    expect(low.ok).toBe(true);
    expect(high.ok).toBe(true);
    expect(over).toEqual({ ok: false, error: "invalid_probability" });
    expect(under).toEqual({ ok: false, error: "invalid_probability" });
  });

  it("composes a non-empty claim_text from structured fields alone with no note", () => {
    const text = composeClaimText({
      symbol: "NVDA",
      comparator: ">=",
      threshold: 150,
      date: TOMORROW,
      lang: "en",
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toBe("NVDA closing price at or above 150 on 2026-09-10.");
    expect(text).not.toContain("undefined");
    const zh = composeClaimText({
      symbol: "NVDA",
      comparator: ">=",
      threshold: 150,
      date: TOMORROW,
      lang: "zh",
    });
    expect(zh).toBe("NVDA 在 2026-09-10 的收盘价大于等于150。");
  });

  it("appends a non-empty note to the composed base sentence", () => {
    const text = composeClaimText({
      symbol: "NVDA",
      comparator: ">",
      threshold: 200,
      date: TOMORROW,
      note: "If demand holds.",
      lang: "en",
    });
    expect(text).toBe("NVDA closing price above 200 on 2026-09-10. If demand holds.");
  });

  it("rejects a note that would push claim_text over 280 characters", () => {
    const note = "x".repeat(280);
    const text = composeClaimText({
      symbol: "NVDA",
      comparator: ">=",
      threshold: 150,
      date: TOMORROW,
      note,
      lang: "en",
    });
    expect(text.length).toBeGreaterThan(280);
    expect(validateClaimInput(validBody({ claim_text: text }), NOW)).toEqual({
      ok: false,
      error: "claim_text_too_long",
    });
  });

  it("rejects an owner value outside CLAIM_OWNERS", () => {
    expect(validateClaimInput(validBody({
      condition: { metric: "close", comparator: ">=", threshold: 150, owner: "not-an-owner" },
    }), NOW)).toEqual({ ok: false, error: "invalid_owner" });
  });

  it("rejects a comparator outside >=, <=, >, <", () => {
    expect(validateClaimInput(validBody({
      condition: { metric: "close", comparator: "==", threshold: 150, owner: OWNER },
    }), NOW)).toEqual({ ok: false, error: "invalid_comparator" });
  });

  it("CLAIM_OWNER_LAST_CLOSE is the single last-close owner with metric close", () => {
    expect(CLAIM_OWNER_LAST_CLOSE).toEqual({ owner: "hub/lib/anchor.js", metric: "close" });
    expect(CLAIM_OWNERS).toHaveLength(1);
    expect(CLAIM_OWNERS[0].owner).toBe(CLAIM_OWNER_LAST_CLOSE.owner);
    expect(CLAIM_OWNERS[0].metric).toBe(CLAIM_OWNER_LAST_CLOSE.metric);
    expect(CLAIM_OWNERS[0].labelEn).toBe("Closing price");
    expect(CLAIM_OWNERS[0].labelZh).toBe("收盘价");
    const result = buildInsertRow(validBody(), "user-A", "2026-09-09T12:00:00.000Z", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.condition.metric).toBe("close");
    expect(result.row.condition.owner).toBe("hub/lib/anchor.js");
  });

  it("rejects an empty claim_text with claim_text_empty, not claim_text_too_long", () => {
    expect(validateClaimInput(validBody({ claim_text: "" }), NOW)).toEqual({
      ok: false,
      error: "claim_text_empty",
    });
  });

  it("rejects a resolves_at instant that is not YYYY-MM-DD and has no UTC designator", () => {
    expect(validateClaimInput(validBody({
      resolves_at: "2026-09-10T00:00:00",
    }), NOW)).toEqual({ ok: false, error: "invalid_resolves_at" });
  });

  it("accepts the client's T23:59:59.999Z resolves_at form", () => {
    const result = validateClaimInput(validBody({ resolves_at: TOMORROW_ISO }), NOW);
    expect(result.ok).toBe(true);
  });

  it("never accepts a client-supplied claim_id, user_id, stated_at, status, or resolution", () => {
    const statedAt = "2026-09-09T12:00:00.000Z";
    const result = buildInsertRow(validBody({
      claim_id: "deadbeefdeadbeef",
      user_id: "attacker",
      stated_at: "1999-01-01T00:00:00.000Z",
      status: "resolved",
      resolution: { outcome: 1 },
    }), "user-A", statedAt, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.claim_id).not.toBe("deadbeefdeadbeef");
    expect(result.row.claim_id).toMatch(/^[0-9a-f]{16}$/);
    expect(result.row.user_id).toBe("user-A");
    expect(result.row.stated_at).toBe(statedAt);
    expect(result.row.status).toBe("open");
    expect(result.row.resolution).toBeNull();
  });
});
