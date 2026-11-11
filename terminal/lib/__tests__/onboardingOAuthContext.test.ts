// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth } }),
}));

import { startGoogleOAuth } from "@/components/onboarding/oauth";
import { LS_ONBOARD_RESUME, type OnboardResumeStash } from "@/components/onboarding/types";

const stash: OnboardResumeStash = {
  step: 2,
  firstName: "Research",
  lastName: "Visitor",
  plan: "free",
  period: "monthly",
  prefs: { market_focus: [], trade_types: [], theme_pref: "dark" },
};

describe("Google OAuth research navigation", () => {
  beforeEach(() => {
    signInWithOAuth.mockReset();
    signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: null }, error: null });
    localStorage.clear();
    history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    history.replaceState(null, "", "/");
    localStorage.clear();
  });

  it("returns to the selected company and complete research context after Google sign-in", async () => {
    const ret = "https://www.mastermind-x.com/commodities.html#cw/relationships/oil?window=60&compare=oil%2Cgold&hypothesis=supply";
    const query = new URLSearchParams({
      symbol: "A", page: "intelligence", from: "macro", ret,
      mo_from: "transmission", mo_chain: "oil_inflation_duration_derate",
      mo_channel: "long_duration_valuation", mo_asof: "2026-10-16",
      mo_security: "SEC:US-XNYS-A",
    });
    history.replaceState(null, "", "/analysis?" + query);

    expect(await startGoogleOAuth(stash)).toEqual({ error: null });
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    const call = signInWithOAuth.mock.calls[0][0];
    expect(call.provider).toBe("google");
    const callback = new URL(call.options.redirectTo);
    expect(callback.origin + callback.pathname).toBe(location.origin + "/auth/callback");
    const next = new URL(callback.searchParams.get("next")!, location.origin);
    expect(next.pathname).toBe("/analysis");
    expect(next.searchParams.get("symbol")).toBe("A");
    expect(next.searchParams.get("page")).toBe("intelligence");
    expect(next.searchParams.get("from")).toBe("macro");
    expect(next.searchParams.get("ret")).toBe(ret);
    expect(next.searchParams.get("mo_from")).toBe("transmission");
    expect(next.searchParams.get("mo_chain")).toBe("oil_inflation_duration_derate");
    expect(next.searchParams.get("mo_channel")).toBe("long_duration_valuation");
    expect(next.searchParams.get("mo_asof")).toBe("2026-10-16");
    expect(next.searchParams.get("mo_security")).toBe("SEC:US-XNYS-A");
    expect(next.searchParams.getAll("onboard")).toEqual(["resume"]);
    expect(JSON.parse(localStorage.getItem(LS_ONBOARD_RESUME)!)).toEqual(stash);
  });

  it("replaces onboarding controls without collapsing duplicate research fields or forwarding outer fragments", async () => {
    history.replaceState(null, "", "/analysis?symbol=A&mo_chain=first&mo_chain=second&onboard=old&onboard=again&ref=oil%20%26%20gas#access_token=not-for-callback");

    await startGoogleOAuth(stash);

    const callback = new URL(signInWithOAuth.mock.calls[0][0].options.redirectTo);
    const next = new URL(callback.searchParams.get("next")!, location.origin);
    expect(next.searchParams.getAll("onboard")).toEqual(["resume"]);
    expect(next.searchParams.getAll("mo_chain")).toEqual(["first", "second"]);
    expect(next.searchParams.get("ref")).toBe("oil & gas");
    expect(next.hash).toBe("");
    expect(callback.href).not.toContain("not-for-callback");
  });

  it("still starts OAuth on a queryless route when resume storage is unavailable and surfaces provider errors", async () => {
    history.replaceState(null, "", "/terminal");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage disabled"); });
    signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: null }, error: { message: "Provider unavailable" } });

    expect(await startGoogleOAuth(stash)).toEqual({ error: "Provider unavailable" });
    const callback = new URL(signInWithOAuth.mock.calls[0][0].options.redirectTo);
    expect(callback.searchParams.get("next")).toBe("/terminal?onboard=resume");
  });
});
