// @vitest-environment jsdom
// Focused mounted reproductions for MarketOntology B/F08, macro#6819
// comments6091394282 and6091529927. Requests retain immutable start-time
// snapshots; changing server state at release time would hide the DELETE race.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ExistingAlertsPanel, NewAlertPanel } from "@/components/AlertsView";
import { LangProvider } from "@/lib/i18n";
import { ALERTS_CHANGED_EVENT } from "@/lib/alertsView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Row = { id: string; symbol: string; active: boolean; created_at: string; condition: { type: string; target: string } };
const row = (id: string, symbol: string): Row => ({ id, symbol, active: true,
  created_at: "2026-10-10T12:00:00Z", condition: { type: "signal", target: "BUY" } });
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300,
  status, json: async () => body }) as Response;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Read = { snapshot: Row[]; resolve: (r: Response) => void };
type Write = { method: string; body: unknown; resolve: (r: Response) => void };

describe("F08 mutation/read and draft races", () => {
  let container: HTMLDivElement;
  let root: Root;
  let server: Row[];
  let reads: Read[];
  let writes: Write[];
  let changed: ReturnType<typeof vi.fn>;
  const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

  beforeEach(() => {
    container = document.createElement("div"); document.body.appendChild(container);
    server = [row("a", "NVDA"), row("b", "MSFT")]; reads = []; writes = [];
    changed = vi.fn(); window.addEventListener(ALERTS_CHANGED_EVENT, changed);
    vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? "GET";
      if (url === "/api/alerts" && method === "GET") {
        const snapshot = clone(server);
        return new Promise<Response>((resolve) => reads.push({ snapshot, resolve }));
      }
      if (url.startsWith("/api/alerts") && (method === "POST" || method === "DELETE")) {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        return new Promise<Response>((resolve) => writes.push({ method, body, resolve }));
      }
      if (url.includes("manifest.json")) return Promise.resolve(reply({ symbols: { NVDA: {}, MSFT: {} } }));
      return Promise.resolve(reply({}));
    }));
  });
  afterEach(async () => {
    await act(async () => root?.unmount()); container.remove();
    window.removeEventListener(ALERTS_CHANGED_EVENT, changed);
    document.documentElement.removeAttribute("data-lang"); vi.unstubAllGlobals();
  });
  async function mount(lang: "en" | "zh", create = false) {
    document.documentElement.setAttribute("data-lang", lang);
    await act(async () => {
      root = createRoot(container);
      root.render(<LangProvider>{create ? <NewAlertPanel email="fixture@example.com" />
        : <ExistingAlertsPanel email="fixture@example.com" />}</LangProvider>);
    });
    await releaseRead(0);
  }
  async function releaseRead(index: number, status = 200, body?: unknown) {
    const read = reads[index]; expect(read).toBeDefined();
    await act(async () => read.resolve(reply(body ?? (status === 200 ? { alerts: read.snapshot } : { error: "unavailable" }), status)));
    await flush();
  }
  async function click(button: HTMLButtonElement | null) {
    expect(button).not.toBeNull(); await act(async () => button!.click()); await flush();
  }
  const symbols = () => [...container.querySelectorAll(".arow .tk")].map((x) => x.textContent);
  async function startDelete() {
    const first = container.querySelector(".arow")!;
    await click(first.querySelector("button.icbtn"));
    const controls = first.querySelectorAll("button"); expect(controls.length).toBe(3);
    await click(controls[1]); expect(writes.map((w) => w.method)).toEqual(["DELETE"]);
    expect(symbols()).not.toContain("NVDA");
  }
  async function acknowledgeDelete() {
    server = server.filter((r) => r.id !== "a");
    await act(async () => writes[0].resolve(reply({ deleted: true })));
    await flush();
  }
  async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
    const input = control instanceof HTMLInputElement;
    const prototype = input ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
      control.dispatchEvent(new Event(input ? "input" : "change", { bubbles: true }));
    }); await flush();
  }

  for (const lang of ["en", "zh"] as const) {
    for (const timing of ["before acknowledgement", "after acknowledgement"] as const) {
      it(`${lang}: a stale inventory ${timing} cannot resurrect an acknowledged delete`, async () => {
        await mount(lang);
        server[1] = row("b", "TSLA");
        await act(async () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT)));
        await startDelete();
        if (timing === "before acknowledgement") await releaseRead(1);
        await acknowledgeDelete();
        if (timing === "after acknowledgement") await releaseRead(1);
        await releaseRead(2, 503);
        expect(symbols()).toContain("TSLA"); // useful sibling changes must still apply
        expect(writes).toHaveLength(1); // recovery never replays DELETE
        expect(container.querySelector('[data-alerts-state="stale"]')).not.toBeNull();
        expect(symbols()).not.toContain("NVDA");
      });
    }
    it(`${lang}: ordinary acknowledged delete without stale read stays removed`, async () => {
      await mount(lang); await startDelete(); await acknowledgeDelete(); await releaseRead(1);
      expect(symbols()).toEqual(["MSFT"]); expect(writes).toHaveLength(1);
    });
    it(`${lang}: post-ack inventory is authoritative even for a returned same-ID row`, async () => {
      await mount(lang);
      await act(async () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT)));
      await startDelete(); await acknowledgeDelete();
      await releaseRead(2, 200, { alerts: [row("a", "RESTORED"), row("b", "MSFT")] });
      await releaseRead(1);
      expect(symbols()).toEqual(["RESTORED", "MSFT"]);
    });
    for (const firstAnswer of ["success", "failure", "malformed"] as const) {
      it(`${lang}: a pre-ack ${firstAnswer} does not remove protection against another old read`, async () => {
        await mount(lang);
        await act(async () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT)));
        server[1] = row("b", "TSLA");
        await act(async () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT)));
        await startDelete(); await acknowledgeDelete();
        await releaseRead(1, firstAnswer === "failure" ? 503 : 200,
          firstAnswer === "malformed" ? { alerts: null } : undefined);
        await releaseRead(2);
        expect(symbols()).toEqual(["TSLA"]);
        await releaseRead(3, 503);
        expect(symbols()).toEqual(["TSLA"]);
      });
    }
    for (const edit of [false, true]) {
      it(`${lang}: create acknowledgement ${edit ? "preserves a newer" : "clears an unchanged"} draft`, async () => {
        await mount(lang, true);
        const type = [...container.querySelectorAll<HTMLSelectElement>(".alert-form select")]
          .find((s) => [...s.options].some((o) => o.value === "price_above"))!;
        await change(type, "price_above");
        const input = container.querySelector<HTMLInputElement>('.alert-form input[type="number"]')!;
        await change(input, "100");
        await click(container.querySelector(".alert-form button.btn-primary"));
        expect(writes).toHaveLength(1);
        expect(writes[0].body).toMatchObject({ condition: { type: "price", op: "above", value: 100 } });
        if (edit) await change(input, "200");
        await act(async () => writes[0].resolve(reply({ alert: row("new", "NVDA") })));
        await flush();
        expect(changed).toHaveBeenCalledTimes(1);
        expect(container.querySelector<HTMLButtonElement>(".alert-form button.btn-primary")!.disabled).toBe(false);
        expect(writes).toHaveLength(1);
        expect(input.value).toBe(edit ? "200" : "");
      });
    }
    for (const edit of ["ABA", "condition", "options"] as const) {
      it(`${lang}: ${edit} edits preserve the numeric draft without suppressing acknowledgement`, async () => {
        await mount(lang, true);
        const selects = () => [...container.querySelectorAll<HTMLSelectElement>(".alert-form select")];
        const type = selects().find((s) => [...s.options].some((o) => o.value === "price_above"))!;
        await change(type, "price_above");
        await change(container.querySelector<HTMLInputElement>('.alert-form input[type="number"]')!, "100");
        const category = selects().find((s) => [...s.options].some((o) => o.value === "options"))!;
        if (edit === "options") await change(category, "options");
        await click(container.querySelector(".alert-form button.btn-primary"));
        expect(writes).toHaveLength(1);
        if (edit === "ABA") {
          const input = container.querySelector<HTMLInputElement>('.alert-form input[type="number"]')!;
          await change(input, "200"); await change(input, "100");
        } else if (edit === "condition") await change(type, "price_below");
        else {
          const rootSelect = selects().find((s) => [...s.options].some((o) => o.value === "QQQ"))!;
          await change(rootSelect, "QQQ");
        }
        await act(async () => writes[0].resolve(reply({ alert: row("new", "NVDA") })));
        await flush();
        expect(changed).toHaveBeenCalledTimes(1);
        expect(container.querySelector<HTMLButtonElement>(".alert-form button.btn-primary")!.disabled).toBe(false);
        // The options edit must protect latent val while acknowledgement settles in OPTIONS.
        if (edit === "options") await change(category, "signal");
        expect(container.querySelector<HTMLInputElement>('.alert-form input[type="number"]')!.value).toBe("100");
      });
    }
    it(`${lang}: edits while response JSON is pending survive the earlier POST acknowledgement`, async () => {
      await mount(lang, true);
      const type = [...container.querySelectorAll<HTMLSelectElement>(".alert-form select")]
        .find((s) => [...s.options].some((o) => o.value === "price_above"))!;
      await change(type, "price_above");
      const input = container.querySelector<HTMLInputElement>('.alert-form input[type="number"]')!;
      await change(input, "100"); await click(container.querySelector(".alert-form button.btn-primary"));
      let resolveJson!: (body: unknown) => void;
      const json = new Promise((resolve) => { resolveJson = resolve; });
      await act(async () => writes[0].resolve({ ok: true, status: 200, json: () => json } as Response));
      await change(input, "200");
      await act(async () => resolveJson({ alert: row("new", "NVDA") })); await flush();
      expect(input.value).toBe("200"); expect(changed).toHaveBeenCalledTimes(1);
    });
  }
});
