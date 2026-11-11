// @vitest-environment jsdom
import { StrictMode, act, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChartPositionEntry, { type ChartPositionIntent } from "@/components/ChartPositionEntry";
import { accountIdentity, identityOwnerKey } from "@/lib/accountIdentity";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { portfolioCopy } from "@/lib/portfolioWorkspace";
import type { Position } from "@/lib/portfolio";

// The chart's position form, bound to the account that opened it.
//
// The REAL PositionModal is rendered here — not a mock. A mock of the form would only prove that
// a helper sends a field; the defect lives in the WIRING between the chart's opening, the shared
// form and the POST, so the test drives the actual form (real inputs, real submit event, real
// create-intent UUID) and observes the actual request.
//
// The shell harness below mirrors `components/TerminalShell.tsx`: it opens the form with the
// owner captured at that moment, dismisses it only for the intent it belongs to, and refreshes
// the rail only after a confirmed create.

const language = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({
  useT: () => (key: string) => key,
  useLang: () => ({ lang: language.lang }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER_A = "owner-a-user";
const OWNER_B = "owner-b-user";
const CREATE_ID = "11111111-1111-4111-8111-111111111111";

type Pending = {
  url: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  /** Settle the whole request (headers + body). */
  resolve: (payload: unknown, status?: number) => void;
  /** Settle the request but hold its BODY — the "response.json()" checkpoint. */
  resolveOnly: (status?: number) => void;
  /** Settle the held body. */
  releaseBody: (payload: unknown) => void;
  reject: (cause: unknown) => void;
};

let writes: Pending[];
let reads: Pending[];
let container: HTMLDivElement;
let root: Root;
let dialogDescriptors: ReadonlyArray<readonly ["showModal" | "close", PropertyDescriptor | undefined]>;

const respond = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => payload,
}) as Response;

async function flush() {
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
}

const written: Position = {
  id: CREATE_ID, ticker: "NVDA", shares: 10, entryPrice: 100,
  entryCurrency: "USD", entryDate: null, notes: null, status: "open", createdAt: "2026-11-02T00:00:00.000Z",
};
const book = (positions: Position[]) => ({ positions, bookKey: portfolioBookKey(positions) });

/** Resolve a held request and let the controller's continuation run. */
async function settle(pending: Pending, payload: unknown, status = 200) {
  expect(pending).toBeDefined();
  await act(async () => { pending.resolve(payload, status); await Promise.resolve(); });
  await flush();
}
/** Settle a request's HEAD but keep its body pending (the "after fetch" checkpoint). */
async function settleHeadOnly(pending: Pending, status = 200) {
  expect(pending).toBeDefined();
  await act(async () => { pending.resolveOnly(status); await Promise.resolve(); });
  await flush();
}
async function releaseBody(pending: Pending, payload: unknown) {
  expect(pending).toBeDefined();
  await act(async () => { pending.releaseBody(payload); await Promise.resolve(); });
  await flush();
}

// ── the shell harness ─────────────────────────────────────────────────────────────────────────

type ShellProps = { userId: string; email?: string; strict?: boolean; openAs?: string };

function Shell({ userId, email = "fixture@example.com", strict = false, openAs }: ShellProps) {
  const [intent, setIntent] = useState<ChartPositionIntent | null>(null);
  const nonce = useRef(0);
  const [committed, setCommitted] = useState(0);
  // The dismissals the controller asked for, so a test can see WHICH opening was closed.
  const [dismissed, setDismissed] = useState<ChartPositionIntent | null>(null);

  // Exactly what TerminalShell does: the owner key comes from the immutable id, never the address.
  const observedOwner = identityOwnerKey(accountIdentity(userId, email));

  const open = useCallback((symbol: string) => {
    setIntent({ nonce: ++nonce.current, symbol, ownerId: openAs ?? userId });
  }, [userId, openAs]);
  const dismiss = useCallback((opening: ChartPositionIntent) => {
    setDismissed(opening);
    setIntent(current => (current === opening ? null : current));
  }, []);
  const committedOnce = useCallback(() => { setCommitted(count => count + 1); }, []);

  const page = <>
    <button type="button" data-testid="open" onClick={() => open("NVDA")}>open</button>
    <button type="button" data-testid="replace" onClick={() => open("AAPL")}>replace</button>
    <span data-testid="committed">{committed}</span>
    <span data-testid="dismissed">{dismissed ? String(dismissed.nonce) : "none"}</span>
    <ChartPositionEntry
      intent={intent}
      observedOwner={observedOwner}
      onDismiss={dismiss}
      onCommitted={committedOnce}
    />
  </>;
  return strict ? <StrictMode>{page}</StrictMode> : page;
}

async function mount(props: ShellProps) {
  await act(async () => { root.render(<Shell {...props} />); });
  await flush();
}
async function remount(props: ShellProps) {
  await act(async () => { root.render(<Shell {...props} />); });
  await flush();
}
async function openForm(testid = "open") {
  await act(async () => { (container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click(); });
  // The controller stays mounted while its real form loads on demand. Settle that
  // module boundary before driving the form; do not replace the form with a mock.
  await act(async () => { await vi.dynamicImportSettled(); });
  await flush();
}
function dialog() { return container.querySelector<HTMLDialogElement>("dialog"); }
function field(name: string) {
  const found = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
  if (!found) throw new Error(`Missing modal field: ${name}`);
  return found;
}
async function change(name: string, value: string) {
  const control = field(name);
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error(`Missing native value setter for ${name}`);
  await act(async () => { setter.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submit() {
  await act(async () => {
    container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}
/** The draft a real user enters, matching `written` below field for field. */
async function fillDraft() {
  await change("shares", "10");
  await change("entryPrice", "100");
  await change("entryCurrency", "USD");
}
function committedCount() { return Number(container.querySelector('[data-testid="committed"]')?.textContent ?? "0"); }
function dismissedNonce() { return container.querySelector('[data-testid="dismissed"]')?.textContent ?? "none"; }

beforeEach(() => {
  language.lang = "en";
  writes = [];
  reads = [];
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => CREATE_ID) });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  dialogDescriptors = (["showModal", "close"] as const).map(name =>
    [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute("open"); },
  });
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
    new Promise<Response>((done, reject) => {
      let releaseBody!: (payload: unknown) => void;
      const bodyGate = new Promise<unknown>((doneBody) => { releaseBody = doneBody; });
      const pending: Pending = {
        url, method: init?.method === "POST" ? "POST" : "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        reject,
        resolve: (payload, status = 200) => done(respond(payload, status)),
        resolveOnly: (status = 200) => done({
          ok: status >= 200 && status < 300, status, json: async () => bodyGate,
        } as unknown as Response),
        releaseBody,
      };
      (pending.method === "POST" ? writes : reads).push(pending);
    })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const [name, original] of dialogDescriptors) {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chart position entry — the owner that opened the form", () => {
  it("sends the account that opened it, through the real form", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    expect(dialog()).not.toBeNull();

    await fillDraft();
    await submit();

    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe("/api/portfolio");
    expect(writes[0].body).toMatchObject({
      action: "create",
      ticker: "NVDA",
      shares: "10",
      entryCurrency: "USD",
      expectedOwnerId: OWNER_A,
      clientPositionId: CREATE_ID,
    });
  });

  it("never names the owner at submit time instead of the owner at open time", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    // The account is observed as B BEFORE the form is submitted, but the form was opened by A.
    await remount({ userId: OWNER_B });
    await fillDraft();
    await submit();

    // The retired scope never reached the network: A's draft is not a B create.
    expect(writes).toHaveLength(0);
    // And the refusal says why, in the form's own words.
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(portfolioCopy("en")("ownerChanged"));
    // The transition retired the opening; it did not close the form, and it did not open one for
    // the new account.
    expect(dialog()).not.toBeNull();
    expect(dismissedNonce()).toBe("none");
  });

  it("refuses an opening whose owner is not the account the shell observes", async () => {
    // The form was opened under A; the shell already observes B.
    await mount({ userId: OWNER_B, openAs: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();

    // The scope is bound to the owner the form was opened under, so it does not match the
    // observed account and nothing is sent.
    expect(writes).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(portfolioCopy("en")("ownerChanged"));
  });

  it("refuses to write for a guest opening", async () => {
    await mount({ userId: "" });
    await openForm();
    expect(dialog()).not.toBeNull();
    await fillDraft();
    await submit();
    expect(writes).toHaveLength(0);
  });

  it("keeps a same-owner email change live — an address is not an identity", async () => {
    await mount({ userId: OWNER_A, email: "first@example.com" });
    await openForm();
    // The same immutable id behind a different address: the same account.
    await remount({ userId: OWNER_A, email: "second@example.com" });
    expect(dialog()).not.toBeNull();
    expect(dismissedNonce()).toBe("none");

    await fillDraft();
    await submit();
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ expectedOwnerId: OWNER_A });
  });
});

describe("chart position entry — an observed account transition retires the opening", () => {
  it("retires A's opening on A→B and never opens one for the new account", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    expect(dialog()).not.toBeNull();

    await remount({ userId: OWNER_B });
    // The form is retired, not closed, and nothing was opened for B.
    expect(dialog()).not.toBeNull();
    expect(dismissedNonce()).toBe("none");
    expect(container.querySelectorAll("dialog")).toHaveLength(1);

    // A→B→A: the original opening is NOT revived by the owner key returning to A, because the
    // generation kept advancing.
    await remount({ userId: OWNER_A });
    expect(dialog()).not.toBeNull();
    expect(dismissedNonce()).toBe("none");

    await fillDraft();
    await submit();
    expect(writes).toHaveLength(0);
  });

  it("keeps a later opening under B independent of the retired A opening", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await remount({ userId: OWNER_B });
    // A NEW opening under the account that is now signed in.
    await openForm("replace");
    expect(dialog()).not.toBeNull();

    await fillDraft();
    await submit();
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ expectedOwnerId: OWNER_B });
  });

  it("issues no POST from a replaced opening's callback", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    // A NEW opening replaces the first one: a different form, a different create intent.
    await openForm("replace");
    expect(dialog()).not.toBeNull();

    await fillDraft();
    await submit();
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ ticker: "AAPL", expectedOwnerId: OWNER_A });
  });
});

describe("chart position entry — a late completion cannot touch a newer opening", () => {
  it("a POST held across a transition cannot close the new form or refresh the rail", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    expect(writes).toHaveLength(1);
    const held = writes[0];

    await remount({ userId: OWNER_B });
    // A NEW opening under the account that is now signed in: the retired operation must not
    // touch it.
    await openForm("replace");
    expect(dialog()).not.toBeNull();

    await settle(held, { ok: true, position: written });
    // The retired operation neither closed the new form nor refreshed the rail.
    expect(dialog()).not.toBeNull();
    expect(committedCount()).toBe(0);
    // And it claimed no confirmation: the retired operation's outcome never surfaced in the
    // new form, which stays clean and open.
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelectorAll("dialog")).toHaveLength(1);
  });

  it("a response BODY held across a transition cannot close the new form or refresh the rail", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    const held = writes[0];

    await remount({ userId: OWNER_B });
    await openForm("replace");

    await settleHeadOnly(held);
    await releaseBody(held, { ok: true, position: written });
    expect(dialog()).not.toBeNull();
    expect(committedCount()).toBe(0);
  });

  it("a canonical readback held across a transition cannot close the new form or refresh the rail", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    await settle(writes[0], { ok: true, position: written });
    expect(reads).toHaveLength(1);
    const heldRead = reads[0];

    await remount({ userId: OWNER_B });
    await openForm("replace");

    await settle(heldRead, book([written]));
    expect(dialog()).not.toBeNull();
    expect(committedCount()).toBe(0);
  });

  it("a POST held across an account transition cannot confirm, read back or refresh", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    const held = writes[0];

    // The account transitions while the write is in flight. The opening is RETIRED, not
    // replaced — so the lifetime fence is the only thing that can refuse this completion.
    await remount({ userId: OWNER_B });
    expect(dialog()).not.toBeNull();

    await settle(held, { ok: true, position: written });
    // The retired operation read nothing back, confirmed nothing, closed nothing and refreshed
    // nothing.
    expect(reads).toHaveLength(0);
    expect(dialog()).not.toBeNull();
    expect(committedCount()).toBe(0);
    // And it told the truth: the request WAS sent and may have committed, so the form says the
    // save could not be confirmed — it never claims the change was applied, and never claims a
    // rollback that did not happen.
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(portfolioCopy("en")("saveUnconfirmed"));
  });

  it("a retry after a dispatched write never claims the change was not applied", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    const held = writes[0];

    await remount({ userId: OWNER_B });
    await settle(held, { ok: true, position: written });
    // The first attempt WAS sent and may have committed for its own owner.
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(portfolioCopy("en")("saveUnconfirmed"));

    // A retry is refused as well — and it must not claim the change "was not applied", because
    // the first attempt may have committed. Only "could not be confirmed" is true here.
    await fillDraft();
    await submit();
    expect(writes).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(portfolioCopy("en")("saveUnconfirmed"));
  });

  it("a replaced opening's in-flight completion cannot read back, close or refresh anything", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    const held = writes[0];

    // The opening is REPLACED while the write is in flight — same account, different form.
    await openForm("replace");
    expect(dialog()).not.toBeNull();

    await settle(held, { ok: true, position: written });
    // The retired write does not continue into a canonical readback of its own.
    expect(reads).toHaveLength(0);
    // The newer opening is untouched: not closed, not refreshed, and shown no outcome.
    expect(dialog()).not.toBeNull();
    expect(committedCount()).toBe(0);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("an unmounted controller cannot close or refresh anything", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    const held = writes[0];

    await act(async () => { root.render(<div />); });
    await flush();

    await settle(held, { ok: true, position: written });
    expect(committedCount()).toBe(0);
  });

  it("a StrictMode replacement still submits the captured owner", async () => {
    await mount({ userId: OWNER_A, strict: true });
    await openForm();
    expect(dialog()).not.toBeNull();

    await fillDraft();
    await submit();
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ expectedOwnerId: OWNER_A });
  });
});

describe("chart position entry — confirmation and refusal", () => {
  it("closes and refreshes only after the canonical read confirms the record", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    await settle(writes[0], { ok: true, position: written });
    expect(dialog()).not.toBeNull();
    expect(committedCount()).toBe(0);

    await settle(reads[0], book([written]));
    expect(dialog()).toBeNull();
    expect(committedCount()).toBe(1);
  });

  it("treats a receipt without the record in the canonical read as unconfirmed, and keeps the draft", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    await settle(writes[0], { ok: true, position: written });
    await settle(reads[0], book([]));

    expect(dialog()).not.toBeNull();
    expect(committedCount()).toBe(0);
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(portfolioCopy("en")("saveUnconfirmed"));
    expect(field("shares").value).toBe("10");
  });

  it("reports a 409 owner refusal as an account change and keeps the draft and the create UUID", async () => {
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    await settle(writes[0], { error: "owner mismatch" }, 409);

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(portfolioCopy("en")("ownerChanged"));
    expect(dialog()).not.toBeNull();
    expect(field("shares").value).toBe("10");
    expect(committedCount()).toBe(0);

    // An identical legitimate retry keeps the SAME create intent.
    await fillDraft();
    await submit();
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toMatchObject({ clientPositionId: CREATE_ID, expectedOwnerId: OWNER_A });
    expect((globalThis.crypto as unknown as { randomUUID: ReturnType<typeof vi.fn> }).randomUUID)
      .toHaveBeenCalledTimes(1);
  });

  it("keeps the Chinese refusal copy for a Chinese reader", async () => {
    language.lang = "zh";
    await mount({ userId: OWNER_A });
    await openForm();
    await fillDraft();
    await submit();
    await settle(writes[0], { error: "owner mismatch" }, 409);
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(portfolioCopy("zh")("ownerChanged"));
  });
});
