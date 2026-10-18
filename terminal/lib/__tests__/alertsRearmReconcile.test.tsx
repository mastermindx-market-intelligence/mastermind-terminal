// @vitest-environment jsdom
//
// F08-REARM (macro#6819, C4 comment 5990007233; adopted by CEO B in 5990460847): `rearm()` turned
// every non-acknowledgement — a lost reply, a 2xx without a usable row, a gateway page — into
// "Could not re-arm", which ASSERTS the write failed when the client cannot know that. The fired
// row stayed actionable with no per-row fence, so a repeat click could clear a NEWER trigger the
// first (committed, unacknowledged) re-arm had already let the engine stamp.
//
// The contract under test, mounted for real (`ExistingAlertsPanel` inside the real LangProvider,
// only `fetch` replaced by a tiny in-memory server whose PATCH can be held, committed and answered
// independently, and whose inventory GETs are held until released):
//   1. a lost reply after a commit is UNCONFIRMED, never "failed": one PATCH, the same row cannot
//      be re-armed again while unsettled, and the existing inventory GET reconciles it;
//   2. a reply without this row's acknowledgement (malformed, another row, this row still fired,
//      a gateway page) takes the same path — and so does a 2xx whose row could not be rendered
//      (condition missing, null, a scalar or an array; symbol or created_at missing) (C4 5991393156);
//   3. the reconciliation shows the LATEST OBSERVATION (armed, or a newer trigger) without
//      another PATCH, and keeps the "not confirmed" qualification — a GET is not proof the
//      unacknowledged PATCH finished;
//   4. a failed reconciliation keeps the uncertainty and offers a GET-only "Check status";
//   5. an inventory read that lands while the PATCH is still in flight is NOT settlement;
//   6. a refusal issued before any write (401/404) stays a distinct, localized failure with no
//      reconciliation, and a later attempt clears its message as it starts; the route's
//      post-update 400 is NOT such a refusal; and an older inventory read can never overwrite a
//      newer acknowledgement or reconciliation;
//   7. an earlier attempt whose outcome was never learned STAYS qualified after a later attempt is
//      acknowledged or refused: the later result settles only itself (C4 5991393156, 5992243085).
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { ExistingAlertsPanel } from "@/components/AlertsView";
import { LangProvider } from "@/lib/i18n";
import { ALERTS_CHANGED_EVENT } from "@/lib/alertsView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = {
  id: string; symbol: string; active: boolean; created_at: string;
  condition: { type: string; target: string; triggered?: { at: string; value: number; note: string } };
};

const fired = (at: string, value: number): Row => ({
  id: "a1", symbol: "NVDA", active: false, created_at: "2026-09-20T12:00:00Z",
  condition: { type: "signal", target: "BUY", triggered: { at, value, note: "crossed" } },
});
const OLD_FIRE = fired("2026-10-01T14:00:00Z", 101.5);
const NEWER_FIRE = fired("2026-10-03T15:30:00Z", 222.25);
const armed = (r: Row): Row => ({ ...r, active: true, condition: { type: r.condition.type, target: r.condition.target } });

const COPY = {
  en: {
    rearm: "Re-arm", rearming: "Re-arming…", couldNot: "Could not re-arm the alert.",
    checking: "Re-arm not confirmed — checking the alert's current state…",
    unconfirmed: "Re-arm not confirmed — showing the latest saved state.",
    checkFailed: "Re-arm not confirmed, and the alert's current state could not be checked.",
    checkStatus: "Check status", armed: "Armed",
    earlier: "An earlier re-arm of this alert was never confirmed — it may still take effect.",
  },
  zh: {
    rearm: "重新启用", rearming: "正在重新启用…", couldNot: "无法重新启用提醒。",
    checking: "重新启用未获确认——正在核对提醒的当前状态…",
    unconfirmed: "重新启用未获确认——以下为最新保存的状态。",
    checkFailed: "重新启用未获确认，且无法核对提醒的当前状态。",
    checkStatus: "核对状态", armed: "已启用",
    earlier: "此提醒先前的一次重新启用从未获得确认——它仍可能生效。",
  },
} as const;
type Lang = keyof typeof COPY;

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const htmlPage = (status: number) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => { throw new SyntaxError("Unexpected token <"); } }) as unknown as Response;

type Reply =
  | "ack" | "ack-other-row" | "ack-still-fired" | "lost" | "malformed" | "gateway" | "update-error" | "refuse"
  | "ack-no-condition" | "ack-null-condition" | "ack-scalar-condition" | "ack-array-condition"
  | "ack-no-symbol" | "ack-no-created-at";
type GetAnswer = { rows: Row[] } | { status: number } | "transport";
type HeldPatch = { id: string; commit: () => void; reply: (r: Reply) => Promise<void> };

describe("Existing alerts — re-arm acknowledgement, uncertainty and reconciliation (F08-REARM)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let realFetch: typeof globalThis.fetch;
  let server: Map<string, Row>;
  let gets: Array<(a?: GetAnswer) => void>;
  let patches: HeldPatch[];
  let getCount: number;
  let patchCount: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    realFetch = globalThis.fetch;
    server = new Map([["a1", OLD_FIRE]]);
    gets = []; patches = []; getCount = 0; patchCount = 0;
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/alerts" && method === "GET") {
        getCount++;
        return new Promise<Response>((resolve, reject) => {
          // Default answer = the server's state at RELEASE time (what a real read would see).
          gets.push((a) => {
            const ans = a ?? { rows: [...server.values()] };
            if (ans === "transport") reject(new TypeError("Failed to fetch"));
            else if ("rows" in ans) resolve(res(200, { alerts: ans.rows }));
            else resolve(res(ans.status, { error: "store unavailable" }));
          });
        });
      }
      if (url === "/api/alerts" && method === "PATCH") {
        patchCount++;
        const { id } = JSON.parse(String(init?.body)) as { id: string };
        return new Promise<Response>((resolve, reject) => {
          patches.push({
            id,
            commit: () => { const r = server.get(id); if (r) server.set(id, armed(r)); },
            reply: async (kind) => {
              await act(async () => {
                if (kind === "lost") reject(new TypeError("Failed to fetch"));
                else if (kind === "ack") resolve(res(200, { alert: server.get(id) }));
                else if (kind === "ack-other-row") resolve(res(200, { alert: { ...armed(OLD_FIRE), id: "zz" } }));
                else if (kind === "ack-still-fired") resolve(res(200, { alert: OLD_FIRE })); // this row, not re-armed
                else if (kind === "malformed") resolve(res(200, {}));
                else if (kind === "ack-no-condition") resolve(res(200, { alert: { id, active: true } }));
                else if (kind === "ack-null-condition") resolve(res(200, { alert: { ...armed(OLD_FIRE), condition: null } }));
                else if (kind === "ack-scalar-condition") resolve(res(200, { alert: { ...armed(OLD_FIRE), condition: "signal" } }));
                else if (kind === "ack-array-condition") resolve(res(200, { alert: { ...armed(OLD_FIRE), condition: [] } }));
                else if (kind === "ack-no-symbol") { const rest: Record<string, unknown> = { ...armed(OLD_FIRE) }; delete rest.symbol; resolve(res(200, { alert: rest })); }
                else if (kind === "ack-no-created-at") { const rest: Record<string, unknown> = { ...armed(OLD_FIRE) }; delete rest.created_at; resolve(res(200, { alert: rest })); }
                else if (kind === "gateway") resolve(htmlPage(504));
                else if (kind === "update-error") resolve(res(400, { error: "Could not update alert" }));
                else resolve(res(404, { error: "not found" }));
              });
              await flush();
            },
          });
        });
      }
      return Promise.resolve(res(404, {}));
    }) as typeof globalThis.fetch;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    document.documentElement.removeAttribute("data-lang");
    globalThis.fetch = realFetch;
  });

  const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

  async function mount(lang: Lang) {
    document.documentElement.setAttribute("data-lang", lang);
    await act(async () => {
      root = createRoot(container);
      root!.render(React.createElement(
        LangProvider, null, React.createElement(ExistingAlertsPanel, { email: "test@example.com" }),
      ));
    });
    await flush();
    await releaseGet(); // the mount read: the fired row
  }

  async function releaseGet(a?: GetAnswer) {
    const next = gets.shift();
    expect(next, "an inventory read must be in flight to release").toBeDefined();
    await act(async () => { next!(a); });
    await flush();
  }

  async function otherRead() {
    // The /alerts page composes a SECOND instance that re-reads on this signal; so does this one.
    await act(async () => { window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT)); });
    await flush();
  }

  const row = () => container.querySelector(".arow") as HTMLElement;
  const buttonNamed = (name: string) =>
    [...row().querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement | undefined;
  const status = () => container.querySelector("[data-rearm-state]") as HTMLElement | null;
  const errText = () => container.querySelector(".alert-err")?.textContent ?? null;
  async function click(b: HTMLButtonElement | undefined) {
    expect(b, "button must exist").toBeDefined();
    await act(async () => { b!.click(); });
    await flush();
  }

  /** The row is unsettled: no live re-arm control, and any click on the pending one sends nothing. */
  async function expectFenced(c: (typeof COPY)[Lang], patchesSoFar: number) {
    expect(buttonNamed(c.rearm)).toBeUndefined();
    const pending = buttonNamed(c.rearming);
    if (pending) {
      expect(pending.disabled).toBe(true);
      await click(pending);
    }
    expect(patchCount).toBe(patchesSoFar);
  }

  for (const lang of ["en", "zh"] as const) {
    const c = COPY[lang];

    it(`${lang.toUpperCase()}: a reply lost after the commit is unconfirmed, fenced, and reconciled by one GET`, async () => {
      await mount(lang);
      await click(buttonNamed(c.rearm));
      expect(patchCount).toBe(1);
      await expectFenced(c, 1);                       // in flight: a second click sends nothing

      const p = patches[0];
      p.commit();                                      // the write lands …
      await p.reply("lost");                           // … and its acknowledgement does not
      expect(errText()).toBeNull();                    // NOT "Could not re-arm": we do not know that
      expect(status()?.dataset.rearmState).toBe("checking");
      expect(status()?.textContent).toBe(c.checking);
      await expectFenced(c, 1);
      expect(getCount).toBe(2);                        // mount + the reconciliation read

      await releaseGet();                              // the server's latest state: armed
      expect(status()?.dataset.rearmState).toBe("unconfirmed");
      expect(status()?.textContent).toBe(c.unconfirmed);
      expect(row().querySelector(".dot.off")).toBeNull();
      expect(row().textContent).toContain(c.armed);
      expect(buttonNamed(c.rearm)).toBeUndefined();
      expect(patchCount).toBe(1);
      expect(errText()).toBeNull();
    });

    it(`${lang.toUpperCase()}: a failed reconciliation keeps the uncertainty and offers a GET-only Check status`, async () => {
      await mount(lang);
      await click(buttonNamed(c.rearm));
      patches[0].commit();
      await patches[0].reply("lost");
      await releaseGet({ status: 503 });               // the reconciliation read fails too

      expect(status()?.dataset.rearmState).toBe("check-failed");
      expect(status()?.textContent).toContain(c.checkFailed);
      expect(errText()).toBeNull();
      await expectFenced(c, 1);                        // still unknown: no re-arm offered

      const check = [...status()!.querySelectorAll("button")].find((b) => b.textContent === c.checkStatus);
      expect(check).toBeDefined();
      const readsBefore = getCount;
      await click(check);
      expect(getCount).toBe(readsBefore + 1);          // Check status is a READ …
      expect(patchCount).toBe(1);                      // … never a write
      expect(status()?.dataset.rearmState).toBe("checking");

      await releaseGet();
      expect(status()?.dataset.rearmState).toBe("unconfirmed");
      expect(row().textContent).toContain(c.armed);
      expect(patchCount).toBe(1);
    });

    it(`${lang.toUpperCase()}: an explicit refusal is a distinct, localized failure with no reconciliation`, async () => {
      await mount(lang);
      await click(buttonNamed(c.rearm));
      await patches[0].reply("refuse");                // 404 {error} — refused before any update
      expect(errText()).toBe(c.couldNot);              // localized — never the server's raw "not found"
      expect(status()).toBeNull();
      expect(getCount).toBe(1);                        // no reconciliation read
      expect(buttonNamed(c.rearm)?.disabled).toBe(false);

      await click(buttonNamed(c.rearm));                // a new attempt supersedes that verdict …
      expect(errText()).toBeNull();                     // … the moment it starts, not when it lands
      patches[1].commit();
      await patches[1].reply("ack");
      expect(errText()).toBeNull();
      expect(row().textContent).toContain(c.armed);
      expect(patchCount).toBe(2);
    });

    /** P1's reply is lost and nothing has landed; the read shows the row still fired; P2 is sent. */
    async function earlierUnknownThenSecondAttempt() {
      await mount(lang);
      await click(buttonNamed(c.rearm));
      await patches[0].reply("lost");                  // P1: delayed, its outcome unknown
      await releaseGet();                              // the read still sees the fired row
      expect(status()?.dataset.rearmState).toBe("unconfirmed");
      expect(row().textContent).toContain("101.5");
      await click(buttonNamed(c.rearm));               // P2: an explicit, informed new attempt
      expect(patchCount).toBe(2);
      expect(status()?.dataset.rearmState).toBe("earlier-unconfirmed");
      expect(status()?.textContent).toBe(c.earlier);
    }

    it(`${lang.toUpperCase()}: a later acknowledgement does not settle an earlier unknown re-arm`, async () => {
      await earlierUnknownThenSecondAttempt();
      patches[1].commit();
      await patches[1].reply("ack");                   // P2 is acknowledged …
      expect(row().textContent).toContain(c.armed);
      expect(errText()).toBeNull();
      expect(status()?.dataset.rearmState).toBe("earlier-unconfirmed"); // … P1 is still unknown
      expect(status()?.textContent).toBe(c.earlier);

      patches[0].commit();                             // P1 lands late — the copy already allowed for it
      await otherRead();
      await releaseGet();
      expect(status()?.dataset.rearmState).toBe("earlier-unconfirmed");
      expect(patchCount).toBe(2);
    });

    it(`${lang.toUpperCase()}: a later refusal does not settle an earlier unknown re-arm`, async () => {
      await earlierUnknownThenSecondAttempt();
      await patches[1].reply("refuse");                // P2 is refused before any write …
      expect(errText()).toBe(c.couldNot);
      expect(status()?.dataset.rearmState).toBe("earlier-unconfirmed"); // … P1 may still land
      expect(status()?.textContent).toBe(c.earlier);

      patches[0].commit();                             // and it does, late
      await otherRead();
      await releaseGet();
      expect(row().textContent).toContain(c.armed);
      expect(status()?.dataset.rearmState).toBe("earlier-unconfirmed");
      expect(patchCount).toBe(2);
    });
  }

  // update-error: the route's 400 AFTER its update call — supabase-js reports a reply lost between
  // the route and the database as an error too, so the route cannot know the write did not land.
  // The ack-* shapes are 2xx replies naming this row, armed, that could not stand in for it on
  // screen: rendering them would show a blank or broken row as the acknowledged state.
  for (const reply of [
    "malformed", "ack-other-row", "ack-still-fired", "gateway", "update-error",
    "ack-no-condition", "ack-null-condition", "ack-scalar-condition", "ack-array-condition",
    "ack-no-symbol", "ack-no-created-at",
  ] as const) {
    it(`a reply without this row's acknowledgement (${reply}) is unconfirmed, not failed`, async () => {
      await mount("en");
      await click(buttonNamed(COPY.en.rearm));
      patches[0].commit();
      await patches[0].reply(reply);
      expect(errText()).toBeNull();
      expect(status()?.dataset.rearmState).toBe("checking");
      expect(row().textContent).not.toContain("zz");
      await releaseGet();
      expect(status()?.dataset.rearmState).toBe("unconfirmed");
      expect(row().textContent).toContain(COPY.en.armed);
      expect(patchCount).toBe(1);
    });
  }

  it("the reconciliation shows a NEWER trigger as observed, keeps the qualification, and sends nothing", async () => {
    const c = COPY.en;
    await mount("en");
    await click(buttonNamed(c.rearm));
    patches[0].commit();                               // the re-arm commits …
    server.set("a1", NEWER_FIRE);                      // … and the engine fires again before we look
    await patches[0].reply("lost");
    await releaseGet();

    expect(status()?.dataset.rearmState).toBe("unconfirmed");
    expect(status()?.textContent).toBe(c.unconfirmed);
    expect(row().textContent).toContain("222.25");     // the newer event, not the stale one
    expect(row().textContent).not.toContain("101.5");
    expect(patchCount).toBe(1);

    // The row now shows what is actually stored; re-arming it again is a NEW, informed write.
    await click(buttonNamed(c.rearm));
    expect(patchCount).toBe(2);
    expect(patches[1].id).toBe("a1");
  });

  it("an inventory read that lands while the PATCH is in flight is not settlement", async () => {
    const c = COPY.en;
    await mount("en");
    await click(buttonNamed(c.rearm));
    await otherRead();
    await releaseGet();                                // sees the OLD fired row: nothing committed yet
    expect(row().textContent).toContain("101.5");
    expect(status()).toBeNull();
    expect(errText()).toBeNull();
    await expectFenced(c, 1);                          // still pending — the read settled nothing

    patches[0].commit();
    await patches[0].reply("ack");
    expect(row().textContent).toContain(c.armed);
    expect(buttonNamed(c.rearm)).toBeUndefined();
    expect(status()).toBeNull();
    expect(errText()).toBeNull();
  });

  it("a read that began before the acknowledgement cannot revert the acknowledged row", async () => {
    const c = COPY.en;
    await mount("en");
    await click(buttonNamed(c.rearm));
    await otherRead();                                 // read A starts BEFORE the write lands
    patches[0].commit();
    await patches[0].reply("ack");                     // acknowledged: armed
    expect(row().textContent).toContain(c.armed);

    await releaseGet({ rows: [OLD_FIRE] });            // read A finishes late with what it saw
    expect(row().textContent).toContain(c.armed);
    expect(row().textContent).not.toContain("101.5");
    expect(buttonNamed(c.rearm)).toBeUndefined();
  });

  it("an older inventory read cannot overwrite the current reconciliation", async () => {
    const c = COPY.en;
    await mount("en");
    await otherRead();                                 // read A starts before the re-arm
    await click(buttonNamed(c.rearm));
    patches[0].commit();
    await patches[0].reply("lost");                    // reconciliation read B starts

    const readA = gets.shift()!;
    await releaseGet();                                // B lands first: armed (observed)
    expect(status()?.dataset.rearmState).toBe("unconfirmed");
    expect(row().textContent).toContain(c.armed);

    await act(async () => { readA({ rows: [OLD_FIRE] }); });
    await flush();                                     // A lands late with the pre-write state
    expect(row().textContent).toContain(c.armed);
    expect(row().textContent).not.toContain("101.5");
    expect(status()?.dataset.rearmState).toBe("unconfirmed");
  });
});
