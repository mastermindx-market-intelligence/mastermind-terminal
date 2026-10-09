// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import type { InvestigationCommand } from "../investigations";

const i18n = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: i18n.lang }) }));
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
const TITLE_REQUIRED = "Add a title and question within the displayed limits.";
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
  vi.stubGlobal("React", React); i18n.lang = "en";
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


describe("IW2 exact-source calendar-context cutover counterexamples", () => {
  it.each(["2026-10-04", "2026-10-04T00:00:00.000Z", undefined])("editing saved research preserves its existing as-of value %s", async asOf => {
    sessionStorage.clear();
    const existing = structuredClone(original.manifest);
    if (asOf) existing.intent.research_as_of = asOf;
    if (asOf && !asOf.includes("T")) delete (existing as Partial<typeof existing>).argument_relations;
    const baseFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (!options?.method && url.startsWith("/api/investigations?id=")) return reply({status:200,body:{status:"found",id:original.id,revision:1,current_revision:1,lifecycle:"active",manifest:existing,committed_at:"2026-10-09T00:00:00.000Z",layouts:[]}});
      return baseFetch(url, options);
    }));
    await act(async () => { root.render(<InvestigationWorkspace ownerKey={owner} initialInvestigationId={original.id} initialRevision={1}/>); });
    if (asOf) expect(host.textContent).toContain(asOf);
    await click("Edit saved question");
    await click("Save research");
    if (!asOf || asOf.includes("T")) expect(posts).toHaveLength(1);
    // The current contract cannot accept a calendar date in a new revision.
    // Blocking with the draft intact is safe; silently omitting it is not.
    for (const posted of posts) expect(posted.manifest.intent.research_as_of, "Saving an unrelated edit silently dropped the existing date").toBe(asOf);
    // Strengthened (T03h): a calendar date blocks visibly and sends nothing; every other value is sent once, exactly.
    if (asOf && !asOf.includes("T")) {
      expect(posts, "A calendar date must block the save, not send it").toHaveLength(0);
      expect(host.textContent).toContain(`Not saved: the as-of date ${asOf} has no time of day`);
      expect(host.textContent).not.toContain(TITLE_REQUIRED);
      expect(question()).toBe("Keep my exact draft");
      expect(sessionStorage.getItem(key)).toBeNull();
    } else {
      expect(posts).toHaveLength(1);
      expect(Object.hasOwn(posts[0].manifest.intent, "research_as_of")).toBe(asOf !== undefined);
    }
  });

  it("does not drop a legacy recovered date through the ordinary Save button after a no-effect fence", async () => {
    const legacy = structuredClone(original);
    delete (legacy.manifest as Partial<typeof legacy.manifest>).argument_relations;
    legacy.manifest.intent.research_as_of = "2026-10-04";
    sessionStorage.setItem(key, JSON.stringify({owner,command:legacy}));
    receiptReply={status:200,body:{status:"not_applied",id:legacy.id,operation_id:legacy.operation_id}};
    await mount();
    expect(host.textContent).toContain("Save failure confirmed");
    expect(JSON.parse(sessionStorage.getItem(key)!).command).toEqual(legacy);
    const retained = sessionStorage.getItem(key);
    await click("Try save again");
    expect(posts).toHaveLength(0); // Exact retry refuses to manufacture an instant.
    // Strengthened (T03h): the refusal is visible and the retained request is untouched.
    expect(host.textContent).toContain("Not sent: the retained request's as-of date 2026-10-04 has no time of day");
    expect(sessionStorage.getItem(key)).toBe(retained);
    await click("Save research");
    for (const posted of posts) expect(posted.manifest.intent.research_as_of, "Ordinary Save bypassed the exact retry and silently dropped the date").toBe(legacy.manifest.intent.research_as_of);
    expect(posts, "Ordinary Save must block a calendar date, not send it").toHaveLength(0);
    expect(host.textContent).toContain("Not saved: the as-of date 2026-10-04 has no time of day");
    expect(host.textContent).not.toContain(TITLE_REQUIRED);
    expect(sessionStorage.getItem(key)).toBe(retained);
    expect(question()).toBe("Keep my exact draft");
  });
});

// T03h: the deliberate path for a calendar as-of date. The instant is composed only from what the
// user types and checked by the strict parser; nothing is sent until Save research.
const LEGACY_DATE = "2026-10-04";
const AS_OF_LABEL = "Research as-of date (optional)";
const DATE_LABEL = "Date (UTC, YYYY-MM-DD)", TIME_LABEL = "Time (UTC, 24-hour HH:MM or HH:MM:SS)";
const INVALID = "Not changed: enter a real date as YYYY-MM-DD and a time as HH:MM or HH:MM:SS (UTC). Nothing was sent.";
const BLOCKED = `Not saved: the as-of date ${LEGACY_DATE} has no time of day`;
const input = (label: string) => [...host.querySelectorAll("label")].find(l => l.firstChild?.textContent === label)?.querySelector("input") ?? undefined;
async function type(label: string, value: string) {
  const target = input(label);
  expect(target, label).toBeDefined();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, value);
    target!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const control = () => host.querySelector<HTMLElement>('form [role="group"]');
const formAsOf = () => [...host.querySelectorAll("form dl div")].find(d => d.querySelector("dt")?.textContent === AS_OF_LABEL)?.querySelector("dd")?.textContent;
function fenceLegacyCreate(mutate: (command: InvestigationCommand) => void = () => {}) {
  const legacy = structuredClone(original);
  delete (legacy.manifest as Partial<typeof legacy.manifest>).argument_relations;
  legacy.manifest.intent.research_as_of = LEGACY_DATE;
  mutate(legacy);
  sessionStorage.setItem(key, JSON.stringify({ owner, command: legacy }));
  receiptReply = { status: 200, body: { status: "not_applied", id: legacy.id, operation_id: legacy.operation_id } };
  return legacy;
}
async function openLegacyRecord() {
  sessionStorage.clear();
  const existing = structuredClone(original.manifest);
  delete (existing as Partial<typeof existing>).argument_relations;
  existing.intent.research_as_of = LEGACY_DATE;
  const baseFetch = fetch;
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (!options?.method && url.startsWith("/api/investigations?id=")) return reply({ status: 200, body: { status: "found", id: original.id, revision: 1, current_revision: 1, lifecycle: "active", manifest: existing, committed_at: "2026-10-09T00:00:00.000Z", layouts: [] } });
    return baseFetch(url, options);
  }));
  await act(async () => { root.render(<InvestigationWorkspace ownerKey={owner} initialInvestigationId={original.id} initialRevision={1}/>); });
  await click("Edit saved question");
}

describe("a calendar as-of date offers a deliberate path while editing", () => {
  it("shows the retained date and empty inputs, and sends nothing when left untouched", async () => {
    await openLegacyRecord();
    expect(control()?.textContent).toContain(`The retained as-of date ${LEGACY_DATE} has no time of day`);
    expect(formAsOf()).toBe(LEGACY_DATE);
    for (const label of [DATE_LABEL, TIME_LABEL]) { expect(input(label)?.value, label).toBe(""); expect(input(label)?.placeholder, label).toBe(""); }
    await click("Save research");
    expect(posts).toHaveLength(0);
    expect(host.textContent).toContain(BLOCKED);
    expect(control()).not.toBeNull();
    expect(question()).toBe("Keep my exact draft");
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("sends exactly the composed instant in a revise", async () => {
    await openLegacyRecord();
    await type(DATE_LABEL, "2026-10-04"); await type(TIME_LABEL, "16:30:15");
    await click("Use this exact time");
    expect(posts).toHaveLength(0);
    expect(control()).toBeNull();
    expect(formAsOf()).toBe("2026-10-04T16:30:15.000Z");
    await click("Save research");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: original.id, action: "revise", expected_revision: 1 });
    expect(posts[0].manifest.intent.research_as_of).toBe("2026-10-04T16:30:15.000Z");
    expect(posts[0].manifest.argument_relations).toEqual([]);
  });

  it("after a no-effect fence, sends the exact instant under a new operation and never the original", async () => {
    const legacy = fenceLegacyCreate();
    await mount();
    const retained = sessionStorage.getItem(key);
    const details = host.querySelector("details")?.textContent;
    expect(details).toContain(AS_OF_LABEL); expect(details).toContain(LEGACY_DATE);
    expect(formAsOf()).toBe(LEGACY_DATE);
    await type(DATE_LABEL, "2026-10-04"); await type(TIME_LABEL, "16:30");
    await click("Use this exact time");
    expect(host.textContent).toContain("As-of time set to 2026-10-04T16:30:00.000Z. Choose Save research to save it.");
    expect(posts).toHaveLength(0);
    expect(sessionStorage.getItem(key)).toBe(retained);
    await click("Save research");
    expect(posts).toHaveLength(1);
    expect(posts[0].manifest.intent.research_as_of).toBe("2026-10-04T16:30:00.000Z");
    expect(posts[0].manifest.argument_relations).toEqual([]);
    expect(posts[0].manifest.intent.question).toBe("Keep my exact draft");
    expect(posts[0].operation_id).not.toBe(legacy.operation_id);
    expect(posts.map(p => p.operation_id)).not.toContain(original.operation_id);
    expect(receiptReads).toEqual([legacy.operation_id]);
  });

  it("after a no-effect fence, removing the as-of date sends a new operation without one", async () => {
    const legacy = fenceLegacyCreate();
    await mount();
    const retained = sessionStorage.getItem(key);
    await click("Remove the as-of date");
    expect(posts).toHaveLength(0);
    expect(sessionStorage.getItem(key)).toBe(retained);
    expect(control()).toBeNull();
    expect(formAsOf()).toBe("No as-of date");
    await click("Save research");
    expect(posts).toHaveLength(1);
    expect(Object.hasOwn(posts[0].manifest.intent, "research_as_of")).toBe(false);
    expect(posts[0].operation_id).not.toBe(legacy.operation_id);
  });

  it.each([
    ["2026-10-04", ""], ["", "16:30"], ["2026-02-30", "16:30"], ["2026-10-04", "25:00"], ["2026-10-04", "24:00"],
    ["2026/10/04", "16:30"], ["2026-10-04", "16:30 "], ["2026-10-04", "4:30"], ["2026-10-04", "16:30:00.000"], ["0000-01-01", "00:00"],
  ])("refuses date %j with time %j visibly and sends nothing", async (date, time) => {
    fenceLegacyCreate();
    await mount();
    const retained = sessionStorage.getItem(key);
    await type(DATE_LABEL, date); await type(TIME_LABEL, time);
    await click("Use this exact time");
    expect(control()?.querySelector('[role="alert"]')?.textContent).toBe(INVALID);
    expect(formAsOf()).toBe(LEGACY_DATE);
    await click("Save research");
    expect(posts).toHaveLength(0);
    expect(host.textContent).toContain(BLOCKED);
    expect(sessionStorage.getItem(key)).toBe(retained);
  });

  it("applies the typed time with the Enter key without submitting the form", async () => {
    fenceLegacyCreate();
    await mount();
    await type(DATE_LABEL, "2026-10-04"); await type(TIME_LABEL, "16:30");
    await act(async () => { input(TIME_LABEL)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(posts).toHaveLength(0);
    expect(formAsOf()).toBe("2026-10-04T16:30:00.000Z");
    expect(document.activeElement?.textContent).toBe("Save research");
  });

  it("shows the control and the retained date in Chinese", async () => {
    i18n.lang = "zh";
    fenceLegacyCreate();
    await mount();
    expect(control()?.textContent).toContain(`保留的截至日期 ${LEGACY_DATE} 没有具体时间`);
    expect(input("日期（UTC，YYYY-MM-DD）")).toBeDefined();
    expect(input("时间（UTC，24 小时制 HH:MM 或 HH:MM:SS）")).toBeDefined();
    expect(button("使用此确切时间")).toBeDefined(); expect(button("移除截至日期")).toBeDefined();
    expect(host.querySelector("details")?.textContent).toContain("研究截至日期（可选）");
  });
});

describe("a fenced request that cannot be sent again unchanged says why", () => {
  it("names the older layout format and leaves the retained request byte-identical", async () => {
    fenceLegacyCreate(command => {
      command.manifest.intent.research_as_of = "2026-10-04T16:00:00.000Z";
      command.manifest.argument_relations = [];
      (command as { layout_capture?: unknown }).layout_capture = { layout_id: "30000000-0000-4000-8000-000000000001", expected_revision: 3, revision_id: "30000000-0000-4000-8000-000000000002" };
    });
    await mount();
    const retained = sessionStorage.getItem(key);
    await click("Try save again");
    expect(posts).toHaveLength(0);
    expect(host.textContent).toContain("Not sent: the retained request's layout was recorded in an older format");
    expect(sessionStorage.getItem(key)).toBe(retained);
  });
});

// T03h FIX 3: a recovered create keeps every retained field on ordinary Save. The retained command is the
// base for a recovered create the way the saved record is for a revise; only a new operation is sent.
const EVIDENCE = { owner: "earnings.workspace_generation", object_type: "event_workspace", object_id: "evt-aapl-2026q3", mode: "pinned", version_ref: "gen-7", fingerprint: "a".repeat(64) } as const;
const THESIS = { thesis_id: "40000000-0000-4000-8000-000000000001", version_id: "40000000-0000-4000-8000-000000000002", role: "primary" } as const;
const CAPTURE = { layout_id: "30000000-0000-4000-8000-000000000001", expected_revision: 3 };
const LAYOUT_REF = { layout_id: "30000000-0000-4000-8000-000000000003", layout_revision_id: "30000000-0000-4000-8000-000000000004", digest: "b".repeat(64), role: "supporting" } as const;
function richCreate(): InvestigationCommand {
  const endpoint = { owner: EVIDENCE.owner, object_type: EVIDENCE.object_type, object_id: EVIDENCE.object_id, mode: EVIDENCE.mode, version_ref: EVIDENCE.version_ref };
  return {
    id: "10000000-0000-4000-8000-000000000002", operation_id: "20000000-0000-4000-8000-000000000002", action: "create", expected_revision: 0, layout_capture: { ...CAPTURE },
    manifest: {
      schema: "investigation_manifest.v2",
      argument_relations: [{ source: { kind: "thesis", thesis_id: THESIS.thesis_id, version_id: THESIS.version_id }, target: { kind: "evidence", ...endpoint }, relation: "supports", rationale: "Guidance raised on services" }],
      intent: { title: "Retained question", question: "Keep my exact draft", subjects: [{ kind: "security", owner: "terminal.analysis_symbol", object_id: "AAPL" }, { kind: "issuer", owner: "data_os.security_master", object_id: "issuer-aapl" }], horizon: "Two quarters", research_as_of: "2026-10-04T16:00:00.000Z" },
      layout_refs: [], thesis_refs: [{ ...THESIS }], evidence_refs: [{ ...EVIDENCE }],
      continuation: { next_question: "What changes next quarter?", next_observation: "Gross margin held above guidance" },
      review_baseline_ref: { ...EVIDENCE },
    },
  };
}
function fenceCreate(command: InvestigationCommand) {
  sessionStorage.setItem(key, JSON.stringify({ owner, command }));
  receiptReply = { status: 200, body: { status: "not_applied", id: command.id, operation_id: command.operation_id } };
}
type Field = (command: InvestigationCommand) => unknown;
const FIELDS: [string, Field][] = [
  ["intent.research_as_of", c => c.manifest.intent.research_as_of],
  ["intent.subjects", c => c.manifest.intent.subjects],
  ["evidence_refs", c => c.manifest.evidence_refs],
  ["review_baseline_ref", c => c.manifest.review_baseline_ref],
  ["continuation (next_question and next_observation)", c => c.manifest.continuation],
  ["layout_capture", c => c.layout_capture],
  ["thesis_refs", c => c.manifest.thesis_refs],
  ["argument_relations", c => c.manifest.argument_relations],
  ["intent.horizon", c => c.manifest.intent.horizon],
];

describe("a recovered create keeps its retained context on ordinary Save", () => {
  it.each(FIELDS)("keeps %s exactly", async (_name, field) => {
    const retained = richCreate();
    fenceCreate(retained);
    await mount();
    expect(host.textContent).toContain(CONFLICT);
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ phase: "rejected", reason: "not_applied" });
    await click("Save research");
    expect(posts).toHaveLength(1);
    expect(field(posts[0])).toBeDefined();
    expect(field(posts[0])).toEqual(field(retained));
    expect(posts[0].operation_id).not.toBe(retained.operation_id);
    expect(receiptReads).toEqual([retained.operation_id]);
  });

  it("keeps non-empty layout_refs when the retained create had no layout capture", async () => {
    const retained = richCreate();
    delete retained.layout_capture;
    retained.manifest.layout_refs = [{ ...LAYOUT_REF }];
    fenceCreate(retained);
    await mount();
    await click("Save research");
    expect(posts).toHaveLength(1);
    expect(posts[0].manifest.layout_refs).toEqual([LAYOUT_REF]);
    expect(Object.hasOwn(posts[0], "layout_capture")).toBe(false);
  });

  it("shows the retained layout as the selected choice and keeps the symbol of the retained subjects", async () => {
    fenceCreate(richCreate());
    await mount();
    const select = [...host.querySelectorAll("label")].find(l => l.firstChild?.textContent === "Retain a named layout (optional)")?.querySelector("select");
    expect(select?.selectedOptions[0]?.textContent).toBe("Retained layout · Revision 3");
    expect([...host.querySelectorAll("label")].find(l => l.firstChild?.textContent === "Security symbol")?.querySelector("input")?.disabled).toBe(true);
  });

  it("refuses a retained layout in the older format visibly, then saves after a deliberate layout choice", async () => {
    const retained = richCreate();
    (retained as { layout_capture?: unknown }).layout_capture = { ...CAPTURE, revision_id: "30000000-0000-4000-8000-000000000002" };
    fenceCreate(retained);
    await mount();
    const stored = sessionStorage.getItem(key);
    await click("Save research");
    expect(posts).toHaveLength(0);
    expect(host.textContent).toContain("Not saved: the retained layout was recorded in an older format.");
    expect(host.textContent).not.toContain(TITLE_REQUIRED);
    expect(sessionStorage.getItem(key)).toBe(stored);
    const select = [...host.querySelectorAll("label")].find(l => l.firstChild?.textContent === "Retain a named layout (optional)")?.querySelector("select");
    await act(async () => { select!.value = ""; select!.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("Save research");
    expect(posts).toHaveLength(1);
    expect(Object.hasOwn(posts[0], "layout_capture")).toBe(false);
    expect(posts[0].manifest.evidence_refs).toEqual(retained.manifest.evidence_refs);
    expect(posts[0].operation_id).not.toBe(retained.operation_id);
  });
});
