// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import type { InvestigationCommand } from "../investigations";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const owner = "local-preview";
const key = `mm.investigation.pending.v2:${owner}`;
const original: InvestigationCommand = {
  id: "10000000-0000-4000-8000-000000000001", operation_id: "20000000-0000-4000-8000-000000000001", action: "create", expected_revision: 0,
  manifest: { schema: "investigation_manifest.v2", argument_relations: [], intent: { title: "Retained question", question: "Keep my exact draft", subjects: [{ kind: "security", owner: "terminal.analysis_symbol", object_id: "AAPL" }] }, layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} },
};
const LIMIT = "Save not completed: this account has reached its saved-research limit. No records were created. Your draft is retained.";
const UNCERTAIN = "The save outcome is not confirmed.";
const CONFLICT = "The save was not committed. Your draft is retained. Reopen the latest revision before editing again.";
type Reply = { status: number; body: unknown };
let host: HTMLDivElement, root: Root;
let receiptReads: string[], receiptKeys: string[][], reconciles: InvestigationCommand[], posts: InvestigationCommand[];
let receiptReply: Reply, reconcileReply: Reply;
const reply = ({ status, body }: Reply) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
const question = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Research question"]')?.value;
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label);
async function click(label: string) {
  expect(button(label), label).toBeDefined();
  await act(async () => { button(label)!.click(); });
}
async function mount() {
  await act(async () => { root.render(<InvestigationWorkspace ownerKey={owner} />); });
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  sessionStorage.clear(); receiptReads = []; receiptKeys = []; reconciles = []; posts = [];
  receiptReply = { status: 404, body: { status: "not_found" } };
  reconcileReply = { status: 503, body: { status: "unavailable" } };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") { posts.push(JSON.parse(String(options.body))); return reply({ status: 429, body: { status: "limit_reached" } }); }
    if (options?.method === "PUT") { reconciles.push(JSON.parse(String(options.body))); return reply(reconcileReply); }
    if (url.startsWith("/api/investigations?operation_id=")) {
      // The real route answers 400 to any other query key, so record the exact key list as well.
      const query = new URL(url, "https://terminal.test").searchParams;
      receiptKeys.push([...query.keys()]); receiptReads.push(query.get("operation_id")!); return reply(receiptReply);
    }
    if (url === "/api/investigations") return reply({ status: 200, body: { status: "listed", items: [] } });
    if (url === "/api/layouts") return reply({ status: 200, body: { layouts: [] } });
    throw Error(`Unexpected request: ${url}`);
  }));
  // A previous page left the original request without a confirmed outcome.
  sessionStorage.setItem(key, JSON.stringify({ owner, command: original }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("reopening a save whose outcome is not confirmed", () => {
  it("reads the original receipt exactly once and never resends the original", async () => {
    await mount();
    expect(receiptReads).toEqual([original.operation_id]);
    expect(receiptKeys).toEqual([["operation_id"]]);
    expect(posts).toHaveLength(0); expect(reconciles).toHaveLength(0);
    expect(host.textContent).toContain(UNCERTAIN);
    expect(question()).toBe("Keep my exact draft");
    expect(button("Start new research")?.disabled).toBe(true);
  });

  it("lets the receipt read decide what is shown, still without a resend", async () => {
    receiptReply = { status: 200, body: { status: "not_applied", id: original.id, operation_id: original.operation_id } };
    await mount();
    expect(receiptReads).toEqual([original.operation_id]);
    expect(receiptKeys).toEqual([["operation_id"]]);
    expect(host.textContent).toContain("Save failure confirmed. No records were created.");
    expect(host.textContent).not.toContain(UNCERTAIN);
    expect(posts).toHaveLength(0); expect(reconciles).toHaveLength(0);
  });

  it("ends the uncertainty at the receipt cap with a limit message and keeps the draft", async () => {
    await mount();
    reconcileReply = { status: 200, body: { status: "not_applied", id: original.id, operation_id: original.operation_id, reason: "limit_reached" } };
    await click("Check original outcome");
    expect(reconciles).toEqual([original]);
    expect(host.textContent).toContain(LIMIT);
    expect(host.textContent).not.toContain(UNCERTAIN);
    expect(button("Try save again")).toBeUndefined();
    expect(question()).toBe("Keep my exact draft");
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ owner, command: original, phase: "rejected", reason: "limit_reached" });
    expect(posts).toHaveLength(0);
    // A new save is a new operation; the cap refuses it as well.
    await click("Save research");
    expect(posts).toHaveLength(1); expect(posts[0].operation_id).not.toBe(original.operation_id);
    expect(host.textContent).toContain(LIMIT);
    // Reopening keeps the conclusive answer without reading or sending the original again.
    act(() => root.unmount()); root = createRoot(host); await mount();
    expect(receiptReads).toEqual([original.operation_id]);
    expect(receiptKeys).toEqual([["operation_id"]]);
    expect(host.textContent).toContain(LIMIT);
    expect(question()).toBe("Keep my exact draft");
    expect(posts.map(p => p.operation_id)).not.toContain(original.operation_id);
  });
});

describe("reopening a revise that the saved-research limit refused", () => {
  it("keeps the limit message when Save is pressed without the record, and sends nothing", async () => {
    const revise: InvestigationCommand = { ...original, action: "revise", expected_revision: 3 };
    sessionStorage.setItem(key, JSON.stringify({ owner, command: revise, phase: "rejected", reason: "limit_reached" }));
    await mount();
    expect(host.textContent).toContain(LIMIT);
    expect(question()).toBe("Keep my exact draft");
    await click("Save research");
    expect(host.textContent).toContain(LIMIT);
    expect(host.textContent).not.toContain(CONFLICT);
    expect(posts).toHaveLength(0); expect(reconciles).toHaveLength(0); expect(receiptReads).toHaveLength(0);
    expect(question()).toBe("Keep my exact draft");
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ owner, command: revise, phase: "rejected", reason: "limit_reached" });
  });
});
