// @vitest-environment jsdom
//
// A2: a nothing-pending delivery (foreign-only outbox) must not render the
// Done step's prefs-pending line. persistPrefs used to treat any status other
// than "delivered" as pending, so nothing-pending painted the syncing sentence.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { SS_WIZARD, STEP_PREFS } from "@/components/onboarding/types";

const deliverOutcome = vi.hoisted(() => ({ current: { status: "nothing-pending" as string } }));
const account = vi.hoisted(() => ({ email: "ada@example.com", wait: null as null | (() => Promise<unknown>) }));

vi.mock("@/lib/onboardingPrefsOutbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/onboardingPrefsOutbox")>();
  return {
    ...actual,
    deliverPendingPrefs: vi.fn(async () => deliverOutcome.current),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { updateUser: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => account.wait ? account.wait() : ({ data: { user: { id: "account-a", email: account.email } }, error: null })) },
  }),
}));

import OnboardingSheet from "@/components/onboarding/OnboardingSheet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("OnboardingSheet — a nothing-pending outbox does not claim prefs are still syncing", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    deliverOutcome.current = { status: "nothing-pending" };
    account.email = "ada@example.com"; account.wait = null;
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
    };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    sessionStorage.setItem(SS_WIZARD, JSON.stringify({
      step: STEP_PREFS,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      prefs: { market_focus: ["us"], trade_types: ["stocks"], theme_pref: "dark" },
      plan: "free",
      period: "annual",
      confirmPending: false,
      trialActive: false,
      trialEnd: null,
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    root = undefined;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("a foreign-only outbox leaves the Done step without prefs-pending", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OnboardingSheet, {
        mode: "signup",
        visible: true,
        email: "ada@example.com",
        onClose: () => {},
      }));
    });
    const continueBtn = Array.from(document.body.querySelectorAll("button"))
      .find((b) => (b.textContent || "").trim() === "Continue") as HTMLButtonElement;
    expect(continueBtn).toBeTruthy();
    await act(async () => { continueBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    const freeBtn = Array.from(document.body.querySelectorAll("button"))
      .find((b) => /Continue with Free|or continue with Free/.test((b.textContent || "").trim())) as HTMLButtonElement;
    expect(freeBtn).toBeTruthy();
    await act(async () => { freeBtn.click(); });
    expect(document.body.querySelector('[data-testid="prefs-pending"]')).toBeNull();
  });

  it("a delayed A identity reply cannot enqueue A after the shell changes to B", async () => {
    let release!: (value: unknown) => void;
    account.wait = () => new Promise(resolve => { release = resolve; });
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OnboardingSheet, { mode: "signup", visible: true, email: "ada@example.com", onClose() {} }));
    });
    const button = Array.from(document.body.querySelectorAll("button"))
      .find(b => b.textContent?.trim() === "Continue")!;
    await act(async () => { button.click(); });
    await act(async () => {
      root!.render(React.createElement(OnboardingSheet, { mode: "signup", visible: true, email: "bob@example.com", onClose() {} }));
    });
    await act(async () => { release({ data: { user: { id: "account-a", email: "ada@example.com" } }, error: null }); });
    expect(localStorage.getItem("mm.pendingPrefs")).toBeNull();
  });
});
