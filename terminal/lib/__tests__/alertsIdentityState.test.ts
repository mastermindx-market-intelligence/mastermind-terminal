import { describe, expect, it } from "vitest";
import {
  canonicalizeOptAlertIdentity,
  optAlertIdentityState,
} from "../optionsAlerts";
import { normalizeStoredAlert } from "@/app/api/alerts/route";

const CASES: Array<{ symbol: string; condition: Record<string, unknown> }> = [
  { symbol: "SPY", condition: { type: "opt_gamma_flip", root: " spy " } },
  { symbol: "SPY", condition: { type: "opt_gamma_flip", root: "spy " } },
  { symbol: "SPY", condition: { type: "opt_gamma_flip", root: "" } },
  { symbol: "SPY", condition: { type: "opt_gamma_flip", root: 7 } },
  { symbol: "SPY", condition: { type: "opt_gamma_flip" } },
  { symbol: "SPY", condition: { type: "opt_gamma_flip", root: "TOOLONGROOTNAME" } },
  { symbol: "SPY", condition: { type: "opt_gamma_flip", root: "SPY" } },
  { symbol: "BRK.B", condition: { type: "opt_gamma_flip", root: "BRK.B" } },
  { symbol: "MARKET", condition: { type: "opt_gamma_flip", root: "MARKET" } },
  { symbol: "SPY", condition: { type: "opt_premium_burst", root: "garbage" } },
  { symbol: "SPY", condition: { type: "opt_0dte_spike", root: "" } },
];

describe("optAlertIdentityState", () => {
  it("returns unresolved for underivable roots and ok for canonical / market-wide kinds", () => {
    // Padded " spy " / "spy " ARE derivable under the writer's own strip+upper law, so
    // they are "ok" here. Underivable forms stay unresolved. Market-wide kinds are ok
    // regardless of root.
    expect(optAlertIdentityState("SPY", { type: "opt_gamma_flip", root: " spy " })).toBe("ok");
    expect(optAlertIdentityState("SPY", { type: "opt_gamma_flip", root: "spy " })).toBe("ok");
    expect(optAlertIdentityState("SPY", { type: "opt_gamma_flip", root: "" })).toBe("unresolved");
    expect(optAlertIdentityState("SPY", { type: "opt_gamma_flip", root: 7 })).toBe("unresolved");
    expect(optAlertIdentityState("SPY", { type: "opt_gamma_flip" })).toBe("unresolved");
    expect(optAlertIdentityState("SPY", { type: "opt_gamma_flip", root: "TOOLONGROOTNAME" })).toBe("unresolved");
    expect(optAlertIdentityState("SPY", { type: "opt_gamma_flip", root: "SPY" })).toBe("ok");
    expect(optAlertIdentityState("BRK.B", { type: "opt_gamma_flip", root: "BRK.B" })).toBe("ok");
    expect(optAlertIdentityState("MARKET", { type: "opt_gamma_flip", root: "MARKET" })).toBe("ok");
    expect(optAlertIdentityState("X", { type: "opt_premium_burst", root: "nope" })).toBe("ok");
    expect(optAlertIdentityState("X", { type: "opt_0dte_spike", root: 1 })).toBe("ok");
  });

  it("agrees with canonicalizeOptAlertIdentity on every shared input (property, not two tables)", () => {
    for (const c of CASES) {
      const canon = canonicalizeOptAlertIdentity(c.symbol, c.condition);
      const state = optAlertIdentityState(c.symbol, c.condition);
      expect(state, JSON.stringify(c.condition)).toBe(canon ? "ok" : "unresolved");
    }
  });
});

describe("normalizeStoredAlert stamps derived identity_state", () => {
  it("stamps identity_state on options rows only, and never mutates any other field of a non-options row", () => {
    const price = { id: "p1", symbol: "SPY", active: true, condition: { type: "price", op: "above", value: 100 } };
    expect(normalizeStoredAlert(price)).toBe(price);

    const suite = { id: "s1", symbol: "AAPL", active: true, condition: { type: "suite_event", suite: "smc", event: "bos" } };
    expect(normalizeStoredAlert(suite)).toBe(suite);

    const ok = {
      id: "o1",
      symbol: "spy",
      active: true,
      condition: { type: "opt_gamma_flip", root: "SPY", extra: 1 },
    };
    const stampedOk = normalizeStoredAlert(ok) as Record<string, unknown>;
    expect(stampedOk.identity_state).toBe("ok");
    expect(stampedOk).toMatchObject({ symbol: "SPY", condition: { type: "opt_gamma_flip", root: "SPY", extra: 1 } });

    const bad = {
      id: "o2",
      symbol: "SPY",
      active: true,
      note: "keep me",
      condition: { type: "opt_gamma_flip", root: "TOOLONGROOTNAME" },
    };
    const stampedBad = normalizeStoredAlert(bad) as Record<string, unknown>;
    expect(stampedBad.identity_state).toBe("unresolved");
    expect(stampedBad.symbol).toBe("SPY");
    expect(stampedBad.note).toBe("keep me");
    expect(stampedBad.condition).toEqual(bad.condition);
    expect(stampedBad).not.toHaveProperty("root");
  });
});
