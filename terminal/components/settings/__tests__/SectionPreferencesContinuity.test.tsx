// @vitest-environment jsdom
import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let authId = "";
const updates: Record<string, unknown>[] = [];
let updateResult: () => Promise<{ error?: unknown }> = async () => ({ error: null });
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  getUser: async () => ({ data: { user: { id: authId, user_metadata: { trade_types: ["stocks", "options"] } } }, error: null }),
  updateUser: ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return updateResult(); },
} }) }));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({ useOptionalSharedShellPresentation: () => null }));

import SectionPreferences from "@/components/settings/SectionPreferences";
import { LangProvider, tPlain } from "@/lib/i18n";
import { accountIdentity, GUEST_IDENTITY, ownerKeyFor, type AccountIdentity } from "@/lib/accountIdentity";
import { __loadOwner, __marketPrefsSnapshot, __resetMarketPrefsStore } from "@/lib/useMarketPrefs";
import type { SectionProps } from "@/components/settings/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A_ID = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22", B_ID = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";
const A = accountIdentity(A_ID, "a@example.com"), B = accountIdentity(B_ID, "b@example.com");
let host: HTMLDivElement; let root: Root; const patch = vi.fn();
function props(identity: AccountIdentity): SectionProps {
  return { identity, email: identity.kind === "account" ? identity.email : "", lang: "en", t: tPlain,
    user: identity.kind === "account" ? { id: identity.userId, email: identity.email, createdAt: null, lastSignInAt: null, provider: null, meta: { trade_types: ["stocks", "options"] } } : null,
    onClose: () => {}, onPatchMeta: patch, onRefreshUser: async () => {} };
}
const chip = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="What you trade: ${name}"]`)!;
const note = () => host.querySelector('[role="group"][aria-label="What you trade"]')!.closest(".acs-row")!.querySelector(".acs-msg")!;
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); }); }
async function render(identity: AccountIdentity = A) {
  await act(async () => root.render(<LangProvider><SectionPreferences {...props(identity)} /></LangProvider>));
  await flush();
}
const click = async (name: string) => { await act(async () => chip(name).click()); await flush(); };
function heldWrite() {
  let release!: (result: { error?: unknown }) => void;
  updateResult = () => new Promise(resolve => { release = resolve; });
  return (result: { error?: unknown } = { error: null }) => release(result);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.clear(); localStorage.setItem("mm.lang", "en"); document.documentElement.dataset.lang = "en";
  __resetMarketPrefsStore(); authId = A_ID; updates.length = 0; patch.mockClear(); updateResult = async () => ({ error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); __resetMarketPrefsStore(); vi.useRealTimers(); });

describe("Preference trade edits survive section navigation", () => {
  it("queues immediately and completes after the section leaves before the former debounce", async () => {
    const release = heldWrite(); await render(); await click("Crypto");
    act(() => root.render(null)); act(() => vi.advanceTimersByTime(600)); await flush();
    expect(updates).toEqual([{ trade_types: ["stocks", "options", "crypto"] }]);
    expect(patch).toHaveBeenCalledWith({ trade_types: ["stocks", "options", "crypto"] });
    expect(__marketPrefsSnapshot().sync.phase).toBe("syncing");
    release(); await flush(); expect(__marketPrefsSnapshot().sync.phase).toBe("saved");
  });
  it("shows Saving until the actual response acknowledges the edit", async () => {
    const release = heldWrite(); await render(); await click("Crypto");
    expect(chip("Crypto").getAttribute("aria-pressed")).toBe("true");
    expect(note().textContent).toContain("Saving"); expect(note().textContent).not.toContain("Saved");
    release(); await flush(); expect(note().textContent).toContain("Saved");
  });
  it("uses the existing single in-flight pump and coalesces to the latest complete choice", async () => {
    const releaseFirst = heldWrite(); await render(); await click("Crypto"); await click("Stocks"); await click("Options");
    expect(updates).toEqual([{ trade_types: ["stocks", "options", "crypto"] }]);
    updateResult = async () => ({ error: null }); releaseFirst(); await flush();
    expect(updates).toEqual([{ trade_types: ["stocks", "options", "crypto"] }, { trade_types: ["crypto"] }]);
    expect(note().textContent).toContain("Saved");
  });
  it.each(["different owner", "same-owner new generation"] as const)("rejects a stale rendered click after %s", async kind => {
    await render();
    chip("Crypto").addEventListener("click", () => {
      if (kind === "different owner") { authId = B_ID; __loadOwner(ownerKeyFor(B_ID)); }
      else { __loadOwner("guest"); __loadOwner(ownerKeyFor(A_ID)); }
    }, { capture: true, once: true });
    await click("Crypto"); act(() => vi.advanceTimersByTime(600)); await flush();
    expect(updates).toHaveLength(0); expect(patch).not.toHaveBeenCalled();
  });
  it("rejects an identity/store mismatch before the incoming owner's load effect", async () => {
    await render(); authId = B_ID;
    function Incoming() {
      useLayoutEffect(() => { chip("Crypto").click(); }, []);
      return <SectionPreferences {...props(B)} />;
    }
    await act(async () => root.render(<LangProvider><Incoming /></LangProvider>));
    act(() => vi.advanceTimersByTime(600)); await flush();
    expect(updates).toHaveLength(0); expect(patch).not.toHaveBeenCalled();
  });
  it("keeps guest choices local to the mounted section", async () => {
    await render(GUEST_IDENTITY); await click("Crypto");
    expect(chip("Crypto").getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(600)); await flush();
    expect(updates).toHaveLength(0); expect(patch).not.toHaveBeenCalled();
  });
  it("retains failure feedback and uses the real manual retry before reporting Saved", async () => {
    updateResult = async () => ({ error: { message: "unavailable" } }); await render(); await click("Crypto");
    expect(note().textContent).toContain("Retry");
    const release = heldWrite(); await act(async () => host.querySelector<HTMLButtonElement>(".acs-msg-retry")!.click()); await flush();
    expect(note().textContent).toContain("Saving"); expect(updates).toHaveLength(2);
    release(); await flush(); expect(note().textContent).toContain("Saved");
  });
});
