// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ExistingAlertsPanel } from "@/components/AlertsView";
import { LangProvider } from "@/lib/i18n";
import { ALERTS_CHANGED_EVENT, buildAlertsView, lanesForArmedAlerts } from "@/lib/alertsView";

const H = vi.hoisted(() => ({ identity: {
  kind: "account" as "account" | "guest",
  userId: "10000000-0000-4000-8000-000000000001", email: "first@example.com",
} }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => H.identity }));
vi.mock("@/lib/entitlementStore", () => ({ useGateEntitlement: () => ({ tier: "free" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const ID = "30000000-0000-4000-8000-000000000001";
const saved = (user = A, id = ID, pair = "USDJPY") => ({
  id, user_id: user, symbol: pair, active: false, created_at: "2026-10-21T12:00:00Z",
  condition: { type: "forex_price_close", schema_version: 1, condition_id: id, revision: 1,
    kind: "price_close", pair, quote_basis: "literal", interval: "4H", calendar: "fx-utc-4h/v1",
    operator: "lt", threshold: 149.5, consecutive: 2, expires_at: "2100-01-02T03:04:05.000Z", feed: null },
});
type Row = ReturnType<typeof saved>;
const response = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
type Read = { snapshot: Row[]; resolve: (r: Response) => void };
type Write = { url: URL; signal?: AbortSignal | null; resolve: (r: Response) => void };

describe("Forex saved inventory: account and uncertain-delete boundaries", () => {
  let container: HTMLDivElement, root: Root, server: Row[], reads: Read[], writes: Write[];
  const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  beforeEach(() => {
    vi.useFakeTimers();
    H.identity = { kind: "account", userId: A, email: "first@example.com" };
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    server = [saved()]; reads = []; writes = [];
    vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? "GET";
      if (url === "/api/alerts" && method === "GET") {
        const snapshot = copy(server);
        return new Promise<Response>((resolve) => reads.push({ snapshot, resolve }));
      }
      if (url.startsWith("/api/alerts?") && method === "DELETE") {
        return new Promise<Response>((resolve, reject) => {
          writes.push({ url: new URL(url, "https://fixture.invalid"), signal: init?.signal, resolve });
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      return Promise.resolve(response({ symbols: {} }));
    }));
  });
  afterEach(async () => {
    await act(async () => root?.unmount()); container.remove();
    document.documentElement.removeAttribute("data-lang");
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  });
  async function render(lang: "en" | "zh") {
    document.documentElement.setAttribute("data-lang", lang);
    await act(async () => {
      root.render(<LangProvider><ExistingAlertsPanel email={H.identity.email} /></LangProvider>);
    }); await flush();
  }
  async function releaseRead(index: number, body?: unknown) {
    const read = reads[index]; expect(read).toBeDefined();
    await act(async () => read.resolve(response(body ?? { alerts: read.snapshot }))); await flush();
  }
  async function click(button: HTMLButtonElement | null) {
    expect(button).not.toBeNull(); await act(async () => button!.click()); await flush();
  }
  const row = () => container.querySelector<HTMLElement>("[data-forex-watch]");
  const pending = (state: string) => container.querySelector('[data-forex-delete="' + state + '"]');
  async function startDelete() {
    await click(row()!.querySelector(".icbtn"));
    await click(row()!.querySelector(".btn-danger"));
    expect(writes).toHaveLength(1);
    expect(pending("sending")).not.toBeNull(); // No optimistic disappearance.
    expect(writes[0].url.searchParams.get("expected_user_id")).toBe(A);
    expect(writes[0].url.searchParams.get("expected_revision")).toBe("1");
  }
  async function resolveWrite(body: unknown, status = 200) {
    await act(async () => writes[0].resolve(response(body, status))); await flush();
  }
  for (const lang of ["en", "zh"] as const) {
    it(lang + ": an email update keeps the same owner's uncertain operation", async () => {
      await render(lang); await releaseRead(0); await startDelete();
      await resolveWrite({ state: "unconfirmed" }, 503);
      H.identity.email = "updated@example.com";
      await render(lang);
      expect(reads).toHaveLength(1);
      expect(pending("unconfirmed")).not.toBeNull();
      expect(row()!.querySelector<HTMLButtonElement>(".icbtn")!.disabled).toBe(true);
      expect(writes).toHaveLength(1);
    });
    it(lang + ": changing the UUID clears old rows and a late old-account response cannot replace the new account", async () => {
      await render(lang); await releaseRead(0); await startDelete();
      H.identity = { kind: "account", userId: B, email: "first@example.com" }; // Same email is not same owner.
      server = [saved(B, "30000000-0000-4000-8000-000000000002", "EURUSD")];
      await render(lang);
      expect(container.textContent).not.toContain("USDJPY");
      await releaseRead(1);
      await resolveWrite({ ok: true, id: ID, deleted: true });
      expect(container.textContent).toContain("EURUSD");
      expect(container.textContent).not.toContain("USDJPY");
      expect(pending("sending")).toBeNull(); expect(pending("unconfirmed")).toBeNull();
      expect(writes).toHaveLength(1);
    });
    it(lang + ": an absence read started before the uncertain response cannot settle the deletion", async () => {
      await render(lang); await releaseRead(0); await startDelete();
      server = [];
      await act(async () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT))); await flush();
      await resolveWrite({ state: "unconfirmed" }, 503);
      await releaseRead(1);
      expect(row()).not.toBeNull(); expect(pending("unconfirmed")).not.toBeNull();
      await click(pending("unconfirmed")!.querySelector("button")); await releaseRead(2);
      expect(row()).toBeNull();
      expect(container.querySelector('[data-alerts-state="empty"]')).not.toBeNull();
      expect(writes).toHaveLength(1);
    });
    it(lang + ": the request deadline preserves uncertainty and recovery only reads", async () => {
      await render(lang); await releaseRead(0); await startDelete();
      await act(async () => { await vi.advanceTimersByTimeAsync(12_001); }); await flush();
      expect(writes[0].signal?.aborted).toBe(true);
      expect(pending("unconfirmed")).not.toBeNull();
      expect(row()!.querySelector<HTMLButtonElement>(".icbtn")!.disabled).toBe(true);
      await click(pending("unconfirmed")!.querySelector("button")); await releaseRead(1);
      expect(pending("unconfirmed")).not.toBeNull();
      expect(writes).toHaveLength(1);
    });
    it(lang + ": an old inventory cannot resurrect an acknowledged deletion", async () => {
      await render(lang); await releaseRead(0);
      await act(async () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT))); await flush();
      await startDelete(); server = [];
      await resolveWrite({ ok: true, id: ID, deleted: true });
      await releaseRead(1);
      expect(row()).toBeNull();
      await releaseRead(2); expect(row()).toBeNull(); expect(writes).toHaveLength(1);
    });
    it(lang + ": a successful response for another ID is still unconfirmed", async () => {
      await render(lang); await releaseRead(0); await startDelete();
      await resolveWrite({ ok: true, id: "another-id", deleted: true });
      expect(row()).not.toBeNull(); expect(pending("unconfirmed")).not.toBeNull();
      expect(writes).toHaveLength(1);
    });
  }
});

describe("Forex saved conditions do not claim monitoring", () => {
  const input = () => ({ alerts: [saved()], alertsState: "READ_OK" as const,
    run: null, lastSuccessAt: null, runsState: "READ_OK_ZERO" as const,
    outbox: [], outboxState: "READ_OK_ZERO" as const, now: Date.parse("2026-10-21T13:00:00Z") });
  it("keeps a readable saved inventory outside tracked coverage and offers an actual watch", () => {
    const view = buildAlertsView(input());
    expect(view.coverage).toEqual({ state: "READ_OK", count: 0 });
    expect(view.emptyAction).toBe("add_watch"); expect(view.rows).toEqual([]);
  });
  it("does not admit malformed active or triggered Forex data to monitoring or delivery", () => {
    const forex = { ...saved(), active: true, condition: { ...saved().condition, triggered: true } };
    const suiteAlert = { ...saved(), id: "suite", active: true, condition: { type: "suite_event" } };
    const engine = { run: null, runsState: "READ_UNAVAILABLE" as const };
    const suite = { run: null, runsState: "READ_OK_ZERO" as const };
    expect(lanesForArmedAlerts([forex, suiteAlert], engine, suite).map((x) => x.id)).toEqual(["suite"]);
    const view = buildAlertsView({ ...input(), alerts: [forex] });
    expect(view.rows).toEqual([]); expect(view.coverage.count).toBe(0);
  });
  it("preserves legacy coverage beside saved Forex and keeps an unavailable read unknown", () => {
    const legacy = { ...saved(), id: "legacy", active: true, condition: { type: "price", value: 100 } };
    expect(buildAlertsView({ ...input(), alerts: [saved(), legacy] }).coverage.count).toBe(1);
    expect(buildAlertsView({ ...input(), alertsState: "READ_UNAVAILABLE" }).coverage.count).toBeNull();
  });
});
