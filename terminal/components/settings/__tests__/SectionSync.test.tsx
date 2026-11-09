// @vitest-environment jsdom
/**
 * The Sync card's headline is a CLAIM about the account's authority (macro#6819 C2 / C4, F12).
 *
 * The previous component said "Sync is on" from `user?.email || email` — an identity prop. That
 * reads as success while (1) an edit is HELD outside the delivery pump because the account read
 * has not answered, (2) the store still holds the PREVIOUS owner's snapshot on the render before
 * this owner's load effect, (3) the pump is retrying a failed delivery, and it did so inside a
 * `role="alert"` idiom. Every case marked [red on master] fails against that component.
 *
 * Real store, real pump. Only the two impure edges are mocked, exactly as
 * lib/__tests__/marketPrefsOwner.test.ts does: the account read and the account write.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

type GetUserResult = { data: { user: unknown }; error: unknown };
let getUser: () => Promise<GetUserResult> = async () => ({ data: { user: null }, error: new Error("unset") });
const updates: Record<string, unknown>[] = [];
let updateResult: () => Promise<{ error?: unknown }> = async () => ({ error: null });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => getUser(),
      updateUser: ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return updateResult();
      },
    },
  }),
}));
vi.mock("@/lib/i18n", () => ({ applyLang: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: {
    href: string; children: React.ReactNode; onClick?: () => void; className?: string;
  }) => <a href={href} onClick={onClick} className={className}>{children}</a>,
}));

import { accountIdentity, GUEST_IDENTITY, ownerKeyFor, type AccountIdentity } from "@/lib/accountIdentity";
import { __resetMarketPrefsStore, persistStartTf } from "@/lib/useMarketPrefs";
import SectionSync, { syncClaim } from "@/components/settings/SectionSync";
import type { SectionProps } from "@/components/settings/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UUID_A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const UUID_B = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";
const A = accountIdentity(UUID_A, "a@example.com");
const B = accountIdentity(UUID_B, "b@example.com");

/** A valid startup timeframe — persistStartTf drops an unknown one silently, which would make
 *  the "held" cases pass for the wrong reason, so the held assertion itself guards this. */
const TF = "D";

const userWith = (id: string, meta: Record<string, unknown>): GetUserResult => ({
  data: { user: { id, user_metadata: meta } }, error: null,
});

/** An account read the test resolves (or rejects) by hand. */
function deferredRead() {
  let resolve!: (v: GetUserResult) => void;
  let reject!: (e: unknown) => void;
  getUser = () => new Promise<GetUserResult>((res, rej) => { resolve = res; reject = rej; });
  return { resolve: (v: GetUserResult) => resolve(v), reject: (e: unknown) => reject(e) };
}

let container: HTMLDivElement;
let root: Root | null = null;

const props = (identity: AccountIdentity, email = ""): SectionProps => ({
  t: (key: string) => key,
  lang: "en",
  identity,
  email,
  user: null,
  onClose: vi.fn(),
  onPatchMeta: vi.fn(),
  onRefreshUser: async () => {},
});

function render(p: SectionProps) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  const r = root;
  act(() => { r.render(<SectionSync {...p} />); });
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise<void>((r) => setImmediate(r)); });
  }
}

const card = () => container.querySelector<HTMLElement>(".acs-sync")!;
const claim = () => card().getAttribute("data-claim");
const title = () => container.querySelector(".acs-sync-t")!.textContent;
const retryButton = () => container.querySelector<HTMLButtonElement>(".acs-sync button");

// jsdom under vitest exposes no usable localStorage on an opaque origin; the store reads and
// writes its per-owner slot there, so give it the same Map-backed stub the store tests use.
let lsStore: Map<string, string>;
const lsStub = {
  getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
  setItem: (k: string, v: string) => { lsStore.set(k, v); },
  removeItem: (k: string) => { lsStore.delete(k); },
  clear: () => { lsStore.clear(); },
};

beforeEach(() => {
  updates.length = 0;
  updateResult = async () => ({ error: null });
  getUser = async () => ({ data: { user: null }, error: new Error("unset") });
  lsStore = new Map();
  Object.defineProperty(globalThis, "localStorage", { value: lsStub, configurable: true, writable: true });
  __resetMarketPrefsStore();
});

afterEach(() => {
  if (root) { const r = root; act(() => { r.unmount(); }); root = null; }
  container?.remove();
  __resetMarketPrefsStore();
});

// ──────────────────────────────────────────────────────────────────────────────

describe("SectionSync claims only what the preference store proves (macro#6819 C2)", () => {
  it("guest: off, with the sign-in prompt", async () => {
    render(props(GUEST_IDENTITY));
    await settle();
    expect(claim()).toBe("off");
    expect(title()).toBe("acsSyncOff");
    expect(container.querySelector(".acs-sync-s")!.textContent).toBe("acsSignInToOn");
    expect(card().classList.contains("off")).toBe(true);
  });

  it("[red on master] account whose read has not answered: 'Signed in', never 'Sync is on'", async () => {
    deferredRead();
    render(props(A, "a@example.com"));
    await settle();
    expect(claim()).toBe("quiet");
    expect(title()).toBe("Signed in");
    expect(container.querySelector(".acs-sync-s")!.textContent).toBe("acsSignedInAs a@example.com");
    // Two materials only: every non-on claim wears the neutral `off` material; the claim itself
    // travels in data-claim (asserted above), so no third CSS class is minted for it.
    expect(card().classList.contains("off")).toBe(true);
    expect(card().classList.contains("quiet")).toBe(false);
  });

  it("[red on master] ZH twin: the neutral and pending claims read in the panel's language", async () => {
    deferredRead();
    render({ ...props(A, "a@example.com"), lang: "zh" });
    await settle();
    expect(title()).toBe("已登录");
    act(() => { persistStartTf(TF); });
    await settle();
    expect(title()).toBe("偏好设置更改仍待同步");
  });

  it("read answered, nothing outstanding: on", async () => {
    const read = deferredRead();
    render(props(A, "a@example.com"));
    await settle();
    read.resolve(userWith(UUID_A, { terminal: { start_tf: "D" } }));
    await settle();
    expect(claim()).toBe("on");
    expect(title()).toBe("acsSyncOn");
    expect(card().className).toBe("acs-sync");
  });

  it("[red on master] an edit held for the merge base: pending until the read answers AND the pump acks", async () => {
    const read = deferredRead();
    render(props(A, "a@example.com"));
    await settle();

    act(() => { persistStartTf(TF); });
    await settle();
    // Guard against a silently-dropped timeframe: the hold must actually exist.
    expect(claim()).toBe("pending");
    expect(title()).toBe("Preference changes are pending");
    expect(retryButton()).toBeNull();          // the pump is not failing; nothing to retry
    expect(updates).toHaveLength(0);           // nothing has been sent — it is HELD

    read.resolve(userWith(UUID_A, {}));
    await settle();
    expect(updates.length).toBeGreaterThan(0); // the hold was flushed into the pump
    expect(claim()).toBe("on");
  });

  it("[red on master] a delivery the authority rejected: pending with Retry; a retry that acks: on", async () => {
    const read = deferredRead();
    render(props(A, "a@example.com"));
    await settle();
    read.resolve(userWith(UUID_A, {}));
    await settle();
    expect(claim()).toBe("on");

    updateResult = async () => ({ error: new Error("503") });
    act(() => { persistStartTf(TF); });
    await settle();
    expect(claim()).toBe("pending");
    const btn = retryButton();
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("acsPrefRetry");

    updateResult = async () => ({ error: null });
    act(() => { btn!.click(); });
    await settle();
    expect(claim()).toBe("on");
    expect(retryButton()).toBeNull();
  });

  it("[red on master] owner switch: never 'on' for the incoming owner until THEIR read answers", async () => {
    const readA = deferredRead();
    render(props(A, "a@example.com"));
    await settle();
    readA.resolve(userWith(UUID_A, {}));
    await settle();
    expect(claim()).toBe("on");

    const readB = deferredRead();
    render(props(B, "b@example.com"));
    // Synchronously after the rerender (effects flushed by act): the store is at most B's
    // loading snapshot — in no state may the card say "on" for b@example.com yet.
    expect(claim()).toBe("quiet");
    expect(container.querySelector(".acs-sync-s")!.textContent).toBe("acsSignedInAs b@example.com");
    await settle();
    expect(claim()).toBe("quiet");

    readB.resolve(userWith(UUID_B, {}));
    await settle();
    expect(claim()).toBe("on");
  });

  it("[red on master] a failed read: 'Signed in' with nothing held; pending once something is", async () => {
    const read = deferredRead();
    render(props(A, "a@example.com"));
    await settle();
    read.reject(new Error("network"));
    await settle();
    expect(claim()).toBe("quiet");
    expect(title()).toBe("Signed in");

    act(() => { persistStartTf(TF); });
    await settle();
    expect(claim()).toBe("pending");
    expect(updates).toHaveLength(0);           // still held — no merge base, no write
  });

  it("[red on master] the headline is a polite status, never an alert", async () => {
    deferredRead();
    render(props(A, "a@example.com"));
    await settle();
    expect(container.querySelector(".acs-sync-t")!.getAttribute("role")).toBe("status");
    expect(container.querySelector('.acs-sync [role="alert"]')).toBeNull();
  });
});

describe("syncClaim (pure) — the ladder, first match wins", () => {
  const who = ownerKeyFor(UUID_A);
  const acked = { phase: "saved" as const, attempts: 0, revision: 3, acked: 3 };

  it("guest identity is off regardless of the store", () => {
    expect(syncClaim({ who: "guest", owner: who, base: "loaded", held: false, sync: acked })).toBe("off");
  });
  it("the previous owner's snapshot (pre-effect render) is quiet, not on", () => {
    expect(syncClaim({ who, owner: ownerKeyFor(UUID_B), base: "loaded", held: false, sync: acked })).toBe("quiet");
  });
  it("an unsettled base is quiet, even with an acked pump", () => {
    expect(syncClaim({ who, owner: who, base: "pending", held: false, sync: acked })).toBe("quiet");
    expect(syncClaim({ who, owner: who, base: "retrying", held: false, sync: acked })).toBe("quiet");
  });
  it("held, syncing, failed, or an unacked revision is pending", () => {
    expect(syncClaim({ who, owner: who, base: "loaded", held: true, sync: acked })).toBe("pending");
    // The case the finding was about: a hold exists only while the base is unknown, so `held`
    // must outrank an unsettled base — otherwise "pending" is unreachable in practice.
    const local = { phase: "idle" as const, attempts: 0, revision: 0, acked: 0 };
    expect(syncClaim({ who, owner: who, base: "pending", held: true, sync: local })).toBe("pending");
    expect(syncClaim({ who, owner: who, base: "retrying", held: true, sync: local })).toBe("pending");
    expect(syncClaim({ who, owner: who, base: "loaded", held: false, sync: { ...acked, phase: "syncing" } })).toBe("pending");
    expect(syncClaim({ who, owner: who, base: "loaded", held: false, sync: { ...acked, phase: "failed", attempts: 1 } })).toBe("pending");
    expect(syncClaim({ who, owner: who, base: "loaded", held: false, sync: { ...acked, revision: 4 } })).toBe("pending");
  });
  it("loaded, nothing held, newest revision acked is on", () => {
    expect(syncClaim({ who, owner: who, base: "loaded", held: false, sync: acked })).toBe("on");
    expect(syncClaim({ who, owner: who, base: "loaded", held: false, sync: { ...acked, phase: "idle", revision: 0, acked: 0 } })).toBe("on");
  });
});
