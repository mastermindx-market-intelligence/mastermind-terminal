// @vitest-environment jsdom
// Mount the actual manager: no extracted/model state machine stands in for its effects.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AlertBulkManager from "@/components/alerts/AlertBulkManager";
import { ALERT_BULK_LEX } from "@/lib/alertBulkLex";

const context = vi.hoisted(() => ({ lang: "en" as "en" | "zh", userId: "fixture-a" }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () =>
  ({ kind: "account", userId: context.userId, email: "fixture@example.com" }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: context.lang }), useT: () => (key: string) => key }));
// Formatting-only dependencies; the real selection, plan, parser, runner and lexicon are retained.
vi.mock("@/lib/alertsView", () => ({ ALERTS_CHANGED_EVENT: "mm:alerts-changed", conditionText: () => "condition" }));
vi.mock("@/lib/optionsAlerts", () => ({ optAlertPreview: () => "options" }));
vi.mock("@/lib/suiteAlerts", () => ({ suiteAlertPreview: () => "suite", suiteSequencePreview: () => "sequence" }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = { id: string; symbol: string; active: boolean; created_at: string; condition: Record<string, unknown> };
const row = (id = "a", active = true): Row => ({ id, symbol: id === "a" ? "NVDA" : "MSFT", active,
  created_at: "2026-11-08T10:00:00Z", condition: { type: "signal", target: "BUY" } });
const reply = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300,
  status, json: async () => body }) as Response;
type Read = { resolve: (r: Response) => void; reject: (e: Error) => void };

describe("bulk review requires its latest matching inventory read", () => {
  let container: HTMLDivElement;
  let root: Root;
  let reads: Read[];
  let writes: unknown[];
  const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  const button = (selector: string) => container.querySelector<HTMLButtonElement>(selector)!;
  const confirm = () => button("[data-bulk-confirm]");
  const click = async (selector: string) => {
    const control = button(selector); expect(control).not.toBeNull();
    await act(async () => control.click()); await flush();
  };
  const changed = async () => {
    await act(async () => window.dispatchEvent(new Event("mm:alerts-changed"))); await flush();
  };
  const release = async (n: number, body: unknown = { alerts: [row()] }, status = 200) => {
    expect(reads[n]).toBeDefined();
    await act(async () => reads[n].resolve(reply(body, status))); await flush();
  };
  const render = async () => {
    await act(async () => root.render(<AlertBulkManager email="fixture@example.com" />)); await flush();
  };
  const open = async (active = true) => {
    await render(); await click("[data-bulk-open]");
    await release(reads.length - 1, { alerts: [row("a", active), row("b", active)] });
    const check = container.querySelector<HTMLInputElement>('[data-bulk-row="a"] input')!;
    await act(async () => check.click()); await flush();
  };
  const review = (action = "pause") => click(`[data-bulk-review-open="${action}"]`);
  const assertBlocked = async () => {
    expect(confirm().disabled).toBe(true);
    await click("[data-bulk-confirm]"); expect(writes).toEqual([]);
  };

  beforeEach(() => {
    context.userId = "fixture-a";
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container); reads = []; writes = [];
    vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe("/api/alerts");
      const method = init?.method ?? "GET";
      if (method === "GET") return new Promise<Response>((resolve, reject) => reads.push({ resolve, reject }));
      expect(method).toBe("PATCH");
      writes.push(JSON.parse(String(init?.body)));
      // Immediate refusal avoids exercising or changing the separate post-write readback proposal.
      return Promise.resolve(reply({ error: "not found" }, 404));
    }));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  });

  for (const lang of ["en", "zh"] as const) {
    it(`${lang}: a pending review cannot send; matching success admits only the captured row once`, async () => {
      context.lang = lang; await open(); await review();
      expect(reads).toHaveLength(2); await assertBlocked();
      expect(container.querySelector("[data-bulk-review-checking]")?.textContent)
        .toBe(ALERT_BULK_LEX.bkLoading[lang === "zh" ? 1 : 0]);
      await release(1, { alerts: [row(), row("b")] });
      expect(confirm().disabled).toBe(false);
      const control = confirm();
      await act(async () => { control.click(); control.click(); }); await flush();
      expect(writes).toEqual([{ id: "a", action: "pause" }]);
    });

    for (const failure of ["503", "transport", "malformed"] as const) {
      it(`${lang}: ${failure} review failure cannot send; a matching retry restores confirmation`, async () => {
        context.lang = lang; await open(); await review();
        if (failure === "transport") { await act(async () => reads[1].reject(new Error("offline"))); await flush(); }
        else await release(1, failure === "malformed" ? { alerts: null } : {}, failure === "503" ? 503 : 200);
        await assertBlocked();
        expect(container.querySelector('[data-bulk-inventory="stale"]')?.textContent)
          .toContain(ALERT_BULK_LEX.bkStale[lang === "zh" ? 1 : 0]);
        await click("[data-bulk-refresh]"); await assertBlocked(); await release(2);
        expect(confirm().disabled).toBe(false); await click("[data-bulk-confirm]");
        expect(writes).toEqual([{ id: "a", action: "pause" }]);
      });
    }

    for (const change of ["condition", "deleted"] as const) {
      it(`${lang}: ${change} invalidates review; review again needs its own read`, async () => {
        context.lang = lang; await open(); await review();
        const altered = { ...row(), condition: { type: "signal", target: "SELL" } };
        await release(1, { alerts: change === "deleted" ? [row("b")] : [altered] });
        await assertBlocked(); expect(container.querySelector('[data-bulk-review-stale="1"]')).not.toBeNull();
        // With deleted selection the existing UI intentionally has no writable target.
        if (change === "deleted") return;
        await click("[data-bulk-review-again]"); expect(reads).toHaveLength(3); await assertBlocked();
        await release(2, { alerts: [altered] }); expect(confirm().disabled).toBe(false);
        await click("[data-bulk-confirm]"); expect(writes).toEqual([{ id: "a", action: "pause" }]);
      });
    }

    for (const newest of ["matching", "failed", "changed"] as const) {
      it(`${lang}: superseded success cannot admit a ${newest} pending newer read`, async () => {
        context.lang = lang; await open(); await review(); await changed();
        expect(reads).toHaveLength(3); await release(1); await assertBlocked();
        await release(2, newest === "changed" ? { alerts: [row("b")] } : { alerts: [row()] }, newest === "failed" ? 503 : 200);
        if (newest === "matching") expect(confirm().disabled).toBe(false);
        else await assertBlocked();
      });
    }

    for (const obsolete of ["failed", "changed"] as const) {
      it(`${lang}: obsolete ${obsolete} cannot revoke a newer matching review`, async () => {
        context.lang = lang; await open(); await review(); await changed(); await release(2);
        await release(1, { alerts: [] }, obsolete === "failed" ? 503 : 200);
        expect(confirm().disabled).toBe(false); await click("[data-bulk-confirm]");
        expect(writes).toEqual([{ id: "a", action: "pause" }]);
      });
    }

    it(`${lang}: cancel and new review cannot inherit the cancelled read`, async () => {
      context.lang = lang; await open(); await review(); await click("[data-bulk-cancel]");
      await review(); await release(1); await assertBlocked(); await release(2);
      expect(confirm().disabled).toBe(false);
    });
    it(`${lang}: an event invalidates an already validated review before React repaints`, async () => {
      context.lang = lang; await open(); await review(); await release(1);
      const control = confirm(); expect(control.disabled).toBe(false);
      await act(async () => { window.dispatchEvent(new Event("mm:alerts-changed")); control.click(); }); await flush();
      expect(writes).toEqual([]); await assertBlocked(); await release(2);
      expect(confirm().disabled).toBe(false);
    });
    it(`${lang}: a changed plan stays invalid even if the original rows later return`, async () => {
      context.lang = lang; await open(); await review();
      await release(1, { alerts: [{ ...row(), condition: { type: "signal", target: "SELL" } }, row("b")] });
      await changed(); await release(2, { alerts: [row(), row("b")] }); await assertBlocked();
      expect(container.querySelector('[data-bulk-review-stale="1"]')).not.toBeNull();
      await click("[data-bulk-review-again]"); await assertBlocked(); await release(3);
      expect(confirm().disabled).toBe(false);
    });
    it(`${lang}: closing the panel retires its pending review`, async () => {
      context.lang = lang; await open(); await review();
      const label = ALERT_BULK_LEX.bkClose[lang === "zh" ? 1 : 0];
      const close = [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!;
      await act(async () => close.click()); await flush(); await release(1);
      expect(confirm()).toBeNull(); expect(writes).toEqual([]);
      await click("[data-bulk-open]"); await release(2); await review(); await assertBlocked();
      await release(3); expect(confirm().disabled).toBe(false);
    });
    it(`${lang}: response headers cannot validate while JSON is still pending`, async () => {
      context.lang = lang; await open(); await review();
      let resolveBody!: (value: unknown) => void;
      const body = new Promise<unknown>(resolve => { resolveBody = resolve; });
      await act(async () => reads[1].resolve({ ok: true, status: 200, json: () => body } as Response));
      await flush(); await assertBlocked(); await changed();
      await act(async () => resolveBody({ alerts: [row()] })); await flush(); await assertBlocked();
      await release(2); expect(confirm().disabled).toBe(false);
    });
    it(`${lang}: resume also waits for validation`, async () => {
      context.lang = lang; await open(false); await review("resume"); await assertBlocked();
      await release(1, { alerts: [row("a", false)] }); await click("[data-bulk-confirm]");
      expect(writes).toEqual([{ id: "a", action: "resume" }]);
    });
    it(`${lang}: signed-out validation drops the review without sending`, async () => {
      context.lang = lang; await open(); await review(); await release(1, {}, 401);
      expect(confirm()).toBeNull(); expect(writes).toEqual([]);
      expect(container.querySelector('[data-bulk-inventory="signed-out"]')).not.toBeNull();
    });
    it(`${lang}: owner remount does not inherit a pending validation`, async () => {
      context.lang = lang; await open(); await review(); context.userId = "fixture-b"; await render();
      await release(1); expect(confirm()).toBeNull(); expect(writes).toEqual([]);
      await open(); await review(); await assertBlocked(); await release(reads.length - 1);
      expect(confirm().disabled).toBe(false);
    });
  }
});
