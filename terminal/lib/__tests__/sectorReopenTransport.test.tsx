// @vitest-environment jsdom
/**
 * sectorReopenTransport.test.tsx — r2 SF-2 gates for the lane 3 transport seam
 * (InvestigationWorkspace's SECTOR_REOPEN_TRANSPORT) and its mount path.
 *
 * Laws pinned here:
 *   - A rejected `fetch` for the reopen (`/api/sector-intelligence?x=…` or the
 *     bare current form) is a TRANSPORT FAILURE, never an exception into the
 *     caller: it classifies as {kind:"error"}, the decision module
 *     (sectorInvestigationReopen) maps it to {state:"retry"} and the mounted
 *     card shows the retry state WITH a Retry control — the card can never
 *     stick on "Reopening…" forever (the pre-fix behavior: the unhandled
 *     rejection left sectorReopen === "loading" with no way out).
 *   - A 200 with an empty (non-JSON) body is the same transport failure on
 *     both forms — lane 6's exact ok-branch hunk (`body ? ok : error`).
 *   - The catch is not a blanket denial: a valid page whose capture identity
 *     matches the saved reference still opens as the ORIGINAL, and clicking
 *     Retry on a failed card recovers to it.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import InvestigationWorkspace, { SECTOR_REOPEN_TRANSPORT } from "@/components/workspaces/InvestigationWorkspace";
import { reopenCurrent, reopenOriginal } from "@/lib/sectorInvestigationReopen";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "sector_population.captured.v11_page1.json"), "utf8")) as {
  page: { context_ref: string; capture: { owner_ref: { generation_id: string; content_id: string } } };
} & Record<string, unknown>;
const CONTEXT_REF = fixture.page.context_ref;
const IDENTITY = { generation_id: fixture.page.capture.owner_ref.generation_id, content_id: fixture.page.capture.owner_ref.content_id };
const ID = "10000000-0000-4000-8000-000000000009";
const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SECTOR_REOPEN_TRANSPORT — transport failure is an answer, never an exception (SF-2)", () => {
  it("a rejected fetch classifies as error, so reopenOriginal ends in retry", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await SECTOR_REOPEN_TRANSPORT.openByContextRef(CONTEXT_REF)).toEqual({ kind: "error" });
    expect(await reopenOriginal(IDENTITY, CONTEXT_REF, SECTOR_REOPEN_TRANSPORT))
      .toEqual({ state: "retry", reason: "transport_error" });
  });

  it("a 200 with an empty body classifies as error on the retained-capture form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(undefined, 200)));
    expect(await SECTOR_REOPEN_TRANSPORT.openByContextRef(CONTEXT_REF)).toEqual({ kind: "error" });
    expect(await reopenOriginal(IDENTITY, CONTEXT_REF, SECTOR_REOPEN_TRANSPORT))
      .toEqual({ state: "retry", reason: "transport_error" });
  });

  it("a 200 with an empty body classifies as error on the current form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(undefined, 200)));
    expect(await SECTOR_REOPEN_TRANSPORT.openCurrent()).toEqual({ kind: "error" });
    expect(await reopenCurrent(SECTOR_REOPEN_TRANSPORT)).toEqual({ state: "retry", reason: "transport_error" });
  });

  it("a rejected current-form fetch also ends in retry", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await SECTOR_REOPEN_TRANSPORT.openCurrent()).toEqual({ kind: "error" });
    expect(await reopenCurrent(SECTOR_REOPEN_TRANSPORT)).toEqual({ state: "retry", reason: "transport_error" });
  });

  it("a valid page with the saved identity still opens as the original — the catch is not a blanket denial", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(fixture)));
    expect(await SECTOR_REOPEN_TRANSPORT.openByContextRef(CONTEXT_REF)).toEqual({ kind: "ok", body: fixture });
    const outcome = await reopenOriginal(IDENTITY, CONTEXT_REF, SECTOR_REOPEN_TRANSPORT);
    expect(outcome.state).toBe("original");
  });
});

describe("mounted workspace — a failed reopen lands in the retry card, never a permanent Reopening (SF-2)", () => {
  let root: Root, host: HTMLDivElement;
  let sectorAnswer: () => Response | Promise<Response>;
  // SP14 saved records carry a v3 manifest: `context_ref` on a macro.sector
  // evidence reference is admitted only by the v3 schema.
  const manifest = {
    schema: "investigation_manifest.v3",
    intent: {
      title: "Sector leadership", question: "Is the financials leadership retained?",
      subjects: [{ kind: "sector", owner: "macro.sector", object_id: "xlf" }],
    },
    layout_refs: [], thesis_refs: [],
    evidence_refs: [{ owner: "macro.sector", object_type: "sector_observation", object_id: "xlf", mode: "pinned",
      version_ref: IDENTITY.generation_id, fingerprint: IDENTITY.content_id, context_ref: CONTEXT_REF }],
    continuation: {},
  };
  beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    sectorAnswer = () => json(fixture);
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.startsWith("/api/sector-intelligence?")) return sectorAnswer();
      if (url.startsWith("/api/investigations?")) return Promise.resolve(json({ status: "found", id: ID, revision: 1, current_revision: 1, lifecycle: "active", manifest, committed_at: "2026-11-06T00:00:00Z", layouts: [] }));
      if (url === "/api/investigations") return Promise.resolve(json({ status: "listed", items: [] }));
      if (url === "/api/layouts") return Promise.resolve(json({ layouts: [] }));
      if (url === "/api/alerts") return Promise.resolve(json({ alerts: [] }));
      if (url === "/api/alerts/receipts") return Promise.resolve(json({ outbox: [] }));
      return Promise.resolve(json({}));
    }));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const mount = async () => {
    await act(async () => { root.render(<InvestigationWorkspace ownerKey="local-preview" initialInvestigationId={ID} initialRevision={1} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const retryCard = () => {
    const card = host.querySelector('[data-testid="sector-context-card"]');
    expect(card, "sector context card missing").not.toBeNull();
    expect(host.textContent).not.toContain("Reopening");
    expect(host.textContent).toContain("could not be reopened");
    const retry = [...host.querySelectorAll("button")].find(b => b.textContent === "Retry");
    expect(retry, "retry card must carry a Retry control").toBeDefined();
    return retry!;
  };

  it("a rejected reopen fetch shows the retry card with a working Retry control", async () => {
    sectorAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
    await mount();
    retryCard();
  });

  it("a 200 with an empty body shows the retry card, and Retry recovers to the original", async () => {
    sectorAnswer = () => json(undefined, 200);
    await mount();
    const retry = retryCard();
    sectorAnswer = () => json(fixture);
    await act(async () => { retry.click(); });
    expect(host.querySelector('[data-sector-reopen="original"]')).not.toBeNull();
    expect(host.textContent).not.toContain("could not be reopened");
  });
});
