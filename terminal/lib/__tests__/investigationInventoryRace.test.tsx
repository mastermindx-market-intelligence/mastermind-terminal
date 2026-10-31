// @vitest-environment jsdom
import React, { act } from "react";
import { createHash } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import type { InvestigationCommand } from "../investigations";
import { canonicalInvestigationJson } from "../investigationContracts";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
const auth = vi.hoisted(() => ({ change: null as null | ((event: string, session: null) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof auth.change) => {
  auth.change = callback;
  return { data: { subscription: { unsubscribe: () => { auth.change = null; } } } };
} } }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = "10000000-0000-4000-8000-000000000001";
const manifest = { schema: "investigation_manifest.v2", argument_relations: [], intent: { title: "Retained question", question: "Keep the exact saved question", subjects: [{ kind: "security", owner: "terminal.analysis_symbol", object_id: "AAPL" }] }, layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} };
const summary = { id, revision: 2, lifecycle: "removed", title: "Retained question", question: "Keep the exact saved question", updated_at: "2026-10-09T00:00:00.000Z" };
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
type Pending = { resolve: (value: Response) => void; reject: (error: Error) => void };
let host: HTMLDivElement, root: Root;
let inventories: Pending[], commands: InvestigationCommand[];
const library = () => host.querySelector('[aria-label="Saved questions"]')!;
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => { button!.click(); });
}
async function mount(owner = "local-preview") {
  await act(async () => { root.render(<InvestigationWorkspace ownerKey={owner} initialInvestigationId={id} initialRevision={1} />); });
  expect(inventories).toHaveLength(1);
}
async function saveRemoval() {
  await click("Remove from saved research");
  expect(commands).toHaveLength(1);
  expect(inventories).toHaveLength(2);
  await click("Removed");
}
async function listAt(index: number, items: unknown[]) {
  await act(async () => { inventories[index].resolve(response({ status: "listed", items })); });
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  sessionStorage.clear(); inventories = []; commands = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      const command: InvestigationCommand = JSON.parse(String(options.body)); commands.push(command);
      return Promise.resolve(response({ status: "committed", id: command.id, operation_id: command.operation_id, revision: 2, lifecycle: "removed", manifest: command.manifest, committed_at: "2026-10-09T00:00:00.000Z",
        investigation_id: command.id, sequence: 2, revision_id: "20000000-0000-4000-8000-000000000002", parent_revision_id: "20000000-0000-4000-8000-000000000001", author_ref: "30000000-0000-4000-8000-000000000001", recorded_at: "2026-10-09T00:00:00.000Z", manifest_digest: createHash("sha256").update(canonicalInvestigationJson(command.manifest)).digest("hex") }));
    }
    if (url === "/api/investigations") return new Promise<Response>((resolve, reject) => inventories.push({ resolve, reject }));
    if (url.startsWith("/api/investigations?")) {
      const saved = commands.length > 0;
      return Promise.resolve(response({ status: "found", id, revision: saved ? 2 : 1, current_revision: saved ? 2 : 1, lifecycle: saved ? "removed" : "active", manifest, committed_at: "2026-10-09T00:00:00.000Z", layouts: [] }));
    }
    if (url === "/api/layouts") return Promise.resolve(response({ layouts: [] }));
    throw Error(`Unexpected request: ${url}`);
  }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Saved Research inventory request ordering", () => {
  it("keeps the post-save library when the initial empty list arrives late", async () => {
    await mount(); await saveRemoval(); await listAt(1, [summary]);
    expect(library().textContent).toContain("Retained question");
    await listAt(0, []);
    expect(library().textContent).toContain("Retained question");
    expect(library().textContent).not.toContain("No saved questions yet.");
  });
  it.each(["network", "invalid"]) ("does not replace a healthy post-save library with a late %s failure", async kind => {
    await mount(); await saveRemoval(); await listAt(1, [summary]);
    await act(async () => {
      if (kind === "network") inventories[0].reject(Error("old request failed"));
      else inventories[0].resolve(response({ status: "unavailable" }));
    });
    expect(library().textContent).toContain("Retained question");
    expect(library().textContent).not.toContain("Saved research is unavailable.");
  });
  it("preserves a newer failure even when an older successful list arrives", async () => {
    await mount(); await saveRemoval();
    await act(async () => { inventories[1].reject(Error("current inventory unavailable")); });
    await listAt(0, [summary]);
    expect(library().textContent).toContain("Saved research is unavailable.");
    expect(library().textContent).not.toContain("Retained question");
    await click("Try again"); await listAt(2, [summary]);
    expect(library().textContent).toContain("Retained question");
  });
  it("still shows a current empty inventory as empty", async () => {
    await mount(); await listAt(0, []);
    expect(library().textContent).toContain("No saved questions yet.");
  });
  it("does not install an older snapshot while the post-save request is still pending", async () => {
    await mount(); await saveRemoval(); await listAt(0, [summary]);
    expect(library().textContent).toContain("Loading…");
    expect(library().textContent).not.toContain("Retained question");
    await listAt(1, [summary]);
    expect(library().textContent).toContain("Retained question");
  });
  it("ignores the prior authenticated scope's late failure", async () => {
    await mount("owner-a");
    await act(async () => { root.render(<InvestigationWorkspace ownerKey="owner-b" initialInvestigationId={id} initialRevision={1} />); });
    await listAt(1, [{ ...summary, lifecycle: "active", title: "Current owner question" }]);
    await act(async () => { inventories[0].reject(Error("prior scope unavailable")); });
    expect(library().textContent).toContain("Current owner question");
    expect(library().textContent).not.toContain("Saved research is unavailable.");
  });
  it("clears the previous authenticated scope's error while the new inventory loads", async () => {
    await mount("owner-a");
    await act(async () => { inventories[0].reject(Error("prior scope unavailable")); });
    expect(library().textContent).toContain("Saved research is unavailable.");
    await act(async () => { root.render(<InvestigationWorkspace ownerKey="owner-b" initialInvestigationId={id} initialRevision={1} />); });
    expect(library().textContent).toContain("Loading…");
    expect(library().textContent).not.toContain("Saved research is unavailable.");
    await listAt(1, []);
    expect(library().textContent).toContain("No saved questions yet.");
  });
  it("does not restore a pending inventory after the authenticated session ends", async () => {
    await mount("owner-a");
    await act(async () => { auth.change!("SIGNED_OUT", null); });
    await listAt(0, [summary]);
    expect(host.textContent).toContain("Your account changed or your session ended");
    expect(host.textContent).not.toContain("Retained question");
    expect(commands).toHaveLength(0);
  });
});
