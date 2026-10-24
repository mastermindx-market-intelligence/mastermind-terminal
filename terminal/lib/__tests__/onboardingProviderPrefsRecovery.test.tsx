// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { LS_PENDING_PREFS, SS_WIZARD } from "@/components/onboarding/types";
import { writePendingPrefs } from "@/lib/onboardingPrefsOutbox";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const PREFS = { first_name: "Ada", last_name: "Reader", market_focus: ["us"], trade_types: ["stocks"],
  theme_pref: "auto" as const, onboarded_at: "2026-10-24T00:00:00Z" };
const wizard = (email = "ada@example.com", firstName = "Ada") => JSON.stringify({ step: 5, firstName, lastName: "Reader", email,
  prefs: { market_focus: ["us"], trade_types: ["stocks"], theme_pref: "auto" }, plan: "free", period: "annual",
  confirmPending: false, trialActive: false, trialEnd: null, prefsPending: true, prefsActorEmail: email });
let root: Root, host: HTMLDivElement;
let user: { id: string; email: string };
beforeEach(() => {
  vi.clearAllMocks();const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); } };
  vi.stubGlobal("localStorage", storage);vi.stubGlobal("sessionStorage", storage);
  user = { id: "account-a", email: "ada@example.com" };
  auth.getUser.mockImplementation(async () => ({ data: { user }, error: null }));
  auth.updateUser.mockResolvedValue({ error: null });
  host = document.createElement("div");document.body.append(host);root = createRoot(host);
});
afterEach(() => { act(() => root.unmount());host.remove();vi.unstubAllGlobals(); });
async function render(email = "ada@example.com") {
  await act(async () => { root.render(<OnboardingProvider email={email}>fixture</OnboardingProvider>); });
}

it("recovers the retained wizard only after the real subject and current shell match its email context", async () => {
  sessionStorage.setItem(SS_WIZARD, wizard());await render();
  expect(auth.updateUser).toHaveBeenCalledTimes(1);
  expect(auth.updateUser.mock.calls[0][0].data).toMatchObject({ first_name: "Ada", theme_pref: "auto", market_focus: ["us"] });
  expect(localStorage.getItem(LS_PENDING_PREFS)).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(SS_WIZARD)!)).not.toHaveProperty("prefsActorEmail");
});
it("a foreign current shell never treats a retained email label as authority", async () => {
  const raw = wizard();sessionStorage.setItem(SS_WIZARD, raw);user = { id: "account-b", email: "bob@example.com" };
  await render("bob@example.com");expect(auth.updateUser).not.toHaveBeenCalled();expect(sessionStorage.getItem(SS_WIZARD)).toBe(raw);
});
it("a failed identity lookup leaves the wizard recoverable for a later mount", async () => {
  const raw = wizard();sessionStorage.setItem(SS_WIZARD, raw);
  auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "synthetic offline" } });await render();
  expect(auth.updateUser).not.toHaveBeenCalled();expect(sessionStorage.getItem(SS_WIZARD)).toBe(raw);
  await act(async () => { root.unmount();root = createRoot(host); });
  auth.getUser.mockImplementation(async () => ({ data: { user }, error: null }));await render();
  expect(auth.updateUser).toHaveBeenCalledTimes(1);expect(localStorage.getItem(LS_PENDING_PREFS)).toBeNull();
});
it("a successful pass releases the latch for a later genuine account transition", async () => {
  writePendingPrefs(PREFS, "account-a");await render();expect(auth.updateUser).toHaveBeenCalledTimes(1);
  user = { id: "account-b", email: "bob@example.com" };writePendingPrefs({ ...PREFS, first_name: "Bob" }, "account-b");
  await render("bob@example.com");expect(auth.updateUser).toHaveBeenCalledTimes(2);expect(localStorage.getItem(LS_PENDING_PREFS)).toBeNull();
});
it("an older identity result cannot recreate an outbox after the wizard intent changes", async () => {
  let release!: (value: unknown) => void;auth.getUser.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  sessionStorage.setItem(SS_WIZARD, wizard());await render();
  const newer = wizard("bob@example.com", "Bob");sessionStorage.setItem(SS_WIZARD, newer);
  await act(async () => { release({ data: { user: { id: "account-a", email: "ada@example.com" } }, error: null }); });
  expect(auth.updateUser).not.toHaveBeenCalled();expect(localStorage.getItem(LS_PENDING_PREFS)).toBeNull();
  expect(sessionStorage.getItem(SS_WIZARD)).toBe(newer);
});
it("acknowledgement never clears a newer wizard snapshot", async () => {
  sessionStorage.setItem(SS_WIZARD, wizard());const newer = wizard("bob@example.com", "Bob");
  auth.updateUser.mockImplementation(async () => { sessionStorage.setItem(SS_WIZARD, newer);return { error: null }; });
  await render();expect(auth.updateUser).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(SS_WIZARD)).toBe(newer);
});
