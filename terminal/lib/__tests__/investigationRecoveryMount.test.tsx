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

// T03i (IW2 items 1-4): a definitive layout_conflict or reference_unavailable refusal is final for that
// exact reference set. Ordinary Save never sends it again unchanged; a deliberate change sends exactly once.
const LAYOUT_CONFLICT = "Not saved: the layout chosen in this draft no longer matches that layout as saved, so sending it unchanged would be refused again. Save that layout again in the Terminal and choose its new revision here, or choose another layout or No layout selected, then choose Save research. Your draft is unchanged.";
const LAYOUT_CONFLICT_ZH = "未保存：此草稿所选布局与该布局当前保存的内容不再一致，原样发送仍会被拒绝。请先在终端中重新保存该布局，然后在此选择其新修订；或选择其他布局或“未选择布局”，然后选择“保存研究”。草稿保持不变。";
const LAYOUT_CONFLICT_LATEST = "Not saved: the layout chosen in this draft no longer matches that layout as saved, so sending it unchanged would be refused again. Your draft is retained. Choose Open latest revision and edit it. Then save that layout again in the Terminal and choose its new revision, or choose another layout or No layout selected.";
const LAYOUT_CONFLICT_LATEST_ZH = "未保存：此草稿所选布局与该布局当前保存的内容不再一致，原样发送仍会被拒绝。草稿已保留。请选择“打开最新修订”并编辑，然后在终端中重新保存该布局并选择其新修订，或选择其他布局或“未选择布局”。";
const REFERENCE_UNAVAILABLE = "Not saved: a layout or Thesis version named in this draft is no longer available to your account, so sending it unchanged would be refused again. Choose another layout or No layout selected, or under Retained Theses use Remove reference or retain another version, then choose Save research. Your draft is unchanged.";
const REFERENCE_UNAVAILABLE_ZH = "未保存：此草稿引用的某个布局或论点版本已无法供你的账户使用，原样发送仍会被拒绝。请选择其他布局或“未选择布局”，或在“保留论点”中使用“移除引用”或保留其他版本，然后选择“保存研究”。草稿保持不变。";
const REFERENCE_UNAVAILABLE_LATEST = "Not saved: a layout or Thesis version named in this draft is no longer available to your account, so sending it unchanged would be refused again. Your draft is retained. Choose Open latest revision and edit it, then change the layout or the Thesis versions before you save.";
const REFERENCE_UNAVAILABLE_LATEST_ZH = "未保存：此草稿引用的某个布局或论点版本已无法供你的账户使用，原样发送仍会被拒绝。草稿已保留。请选择“打开最新修订”并编辑，然后更改布局或论点版本再保存。";
const LAYOUT_MISSING = "Not saved: the chosen layout is not in the layout list shown here, so its current revision cannot be confirmed. Choose another layout or No layout selected, then choose Save research. Your draft is unchanged.";
const LAYOUT_UNAVAILABLE = "Named layouts are unavailable.";
const LAYOUT_LABEL = { en: "Retain a named layout (optional)", zh: "保留已命名布局（可选）" } as const;
const THESIS_B = { thesis_id: "40000000-0000-4000-8000-000000000003", version_id: "40000000-0000-4000-8000-000000000004", role: "context" } as const;
const OTHER_LAYOUT = "30000000-0000-4000-8000-000000000009";
const layoutRow = (revision: number, id = CAPTURE.layout_id, name = "Earnings layout") => ({ id, name, mine: true, config: { schema: "workspace_layout.v1", revision } });
const LAYOUT_CONFLICT_REPLY: Reply = { status: 409, body: { status: "layout_conflict" } };
const REFERENCE_REPLY: Reply = { status: 422, body: { status: "reference_unavailable" } };
let layoutReads = 0;
/** Answers POSTs from a queue (then the default limit refusal) and every layout read from `layouts`. */
function serve(postReplies: Reply[], layouts: (read: number) => Reply | Promise<Reply>, extra?: (url: string) => Promise<Response> | undefined) {
  const baseFetch = fetch; layoutReads = 0;
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") { posts.push(JSON.parse(String(options.body))); return reply(postReplies.shift() ?? { status: 429, body: { status: "limit_reached" } }); }
    if (url === "/api/layouts") return Promise.resolve(layouts(++layoutReads)).then(reply);
    return (!options?.method && extra?.(url)) || baseFetch(url, options);
  }));
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); });
const notices = () => [...host.querySelectorAll('p[role="status"]')].map(p => p.textContent);
const layoutSelect = (lang: "en" | "zh" = "en") => [...host.querySelectorAll("label")].find(l => l.firstChild?.textContent === LAYOUT_LABEL[lang])?.querySelector("select") ?? undefined;
const layoutOptions = () => [...(layoutSelect(i18n.lang)?.options ?? [])].map(o => o.textContent);
async function chooseLayout(value: string) {
  const select = layoutSelect(i18n.lang);
  expect(select, "layout select").toBeDefined();
  expect([...select!.options].map(o => o.value), "the chosen layout is offered").toContain(value);
  await act(async () => { select!.value = value; select!.dispatchEvent(new Event("change", { bubbles: true })); });
}
/** Every visible draft value: inputs, text areas, the layout select and the retained Thesis list. */
const draftValues = () => [
  ...[...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("form input, form textarea, form select")].map(e => `${e.closest("label")?.firstChild?.textContent ?? ""}=${e.value}`),
  ...[...host.querySelectorAll("form li")].map(li => li.textContent ?? ""),
  `asOf=${formAsOf()}`,
];
async function save() { await click(i18n.lang === "zh" ? "保存研究" : "Save research"); await flush(); }
/** Fields a deliberate correction must carry over unchanged. */
const CARRIED: [string, Field][] = FIELDS.filter(([name]) => !["layout_capture", "thesis_refs"].includes(name));
function expectCarried(sent: InvestigationCommand, retained: InvestigationCommand) {
  for (const [name, field] of CARRIED) expect(field(sent), name).toEqual(field(retained));
}
function expectBlocked(messageText: string, stored: string | null, draft: string[]) {
  expect(notices()).toContain(messageText);
  expect(host.textContent).not.toContain(TITLE_REQUIRED);
  expect(host.textContent).not.toContain("Reopen the latest revision");
  expect(sessionStorage.getItem(key)).toBe(stored);
  expect(draftValues()).toEqual(draft);
}

describe("a definitive layout refusal is never sent again unchanged", () => {
  it("after Try save again is refused, ordinary Save sends nothing until the layout's current revision is chosen", async () => {
    const retained = richCreate(); // capture {L, 3}; the owner's list now shows L at revision 4
    sessionStorage.setItem(key, JSON.stringify({ owner, command: retained }));
    serve([LAYOUT_CONFLICT_REPLY], () => ({ status: 200, body: { layouts: [layoutRow(4)] } }));
    await mount(); await flush();
    expect(host.textContent).toContain(UNCERTAIN);
    reconcileReply = { status: 200, body: { status: "not_applied", id: retained.id, operation_id: retained.operation_id } };
    await click("Check original outcome");
    expect(reconciles).toEqual([retained]);
    await click("Try save again"); await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: retained.id, action: "create", layout_capture: CAPTURE });
    expect(posts[0].operation_id).not.toBe(retained.operation_id);
    // The refusal is final for that request: no retry control, no resend.
    expect(button("Try save again")).toBeUndefined();
    const stored = sessionStorage.getItem(key);
    expect(JSON.parse(stored!)).toEqual({ owner, command: posts[0], phase: "rejected", reason: "layout_conflict" });
    expect(layoutSelect()?.selectedOptions[0]?.textContent).toBe("Earnings layout · Revision 3");
    const draft = draftValues();
    await save();
    expect(posts, "ordinary Save resent the refused layout capture").toHaveLength(1);
    expectBlocked(LAYOUT_CONFLICT, stored, draft);
    expect(question()).toBe("Keep my exact draft");
    // The deliberate choice: the layout's current revision, sent once under a new operation.
    await chooseLayout(CAPTURE.layout_id);
    await save();
    expect(posts).toHaveLength(2);
    expect(posts[1].layout_capture).toEqual({ layout_id: CAPTURE.layout_id, expected_revision: 4 });
    expect(posts[1].operation_id).not.toBe(posts[0].operation_id);
    expect(posts[1].manifest.thesis_refs).toEqual(retained.manifest.thesis_refs);
    expectCarried(posts[1], retained);
  });

  it.each([["layout_conflict", "en"], ["layout_conflict", "zh"], ["reference_unavailable", "en"], ["reference_unavailable", "zh"]] as const)("reopened after %s (%s), Save sends nothing until No layout selected is chosen", async (reason, lang) => {
    i18n.lang = lang;
    const retained = richCreate();
    sessionStorage.setItem(key, JSON.stringify({ owner, command: retained, phase: "rejected", reason }));
    serve([], () => ({ status: 200, body: { layouts: [layoutRow(4)] } }));
    await mount(); await flush();
    const text = { layout_conflict: { en: LAYOUT_CONFLICT, zh: LAYOUT_CONFLICT_ZH }, reference_unavailable: { en: REFERENCE_UNAVAILABLE, zh: REFERENCE_UNAVAILABLE_ZH } }[reason][lang];
    expect(notices()).toContain(text);
    expect(receiptReads).toHaveLength(0);
    const stored = sessionStorage.getItem(key), draft = draftValues();
    expect(layoutSelect(lang)?.value).toBe("retained");
    await save();
    expect(posts).toHaveLength(0);
    expectBlocked(text, stored, draft);
    await chooseLayout("");
    await save();
    expect(posts).toHaveLength(1);
    expect(Object.hasOwn(posts[0], "layout_capture")).toBe(false);
    expect(posts[0].manifest.thesis_refs).toEqual(retained.manifest.thesis_refs);
    expectCarried(posts[0], retained);
  });

  it.each([["layout_conflict", "en"], ["layout_conflict", "zh"], ["reference_unavailable", "en"], ["reference_unavailable", "zh"]] as const)("a reopened revise refused for %s (%s) is directed to Open latest revision", async (reason, lang) => {
    i18n.lang = lang;
    const revise: InvestigationCommand = { ...richCreate(), action: "revise", expected_revision: 3 };
    sessionStorage.setItem(key, JSON.stringify({ owner, command: revise, phase: "rejected", reason }));
    serve([], () => ({ status: 200, body: { layouts: [layoutRow(4)] } }));
    await mount(); await flush();
    const text = { layout_conflict: { en: LAYOUT_CONFLICT_LATEST, zh: LAYOUT_CONFLICT_LATEST_ZH }, reference_unavailable: { en: REFERENCE_UNAVAILABLE_LATEST, zh: REFERENCE_UNAVAILABLE_LATEST_ZH } }[reason][lang];
    expect(notices()).toContain(text);
    const stored = sessionStorage.getItem(key);
    await save();
    expect(posts).toHaveLength(0);
    expect(notices()).toContain(text);
    expect(text).not.toContain(lang === "zh" ? "保存研究" : "Save research");
    expect(button(lang === "zh" ? "打开最新修订" : "Open latest revision")).toBeDefined();
    expect(sessionStorage.getItem(key)).toBe(stored);
  });

  it("in session, keeps the refused revision as the retained choice, refreshes the list and never bumps it silently", async () => {
    const retained = richCreate(); delete retained.layout_capture;
    fenceCreate(retained);
    serve([LAYOUT_CONFLICT_REPLY], read => ({ status: 200, body: { layouts: [layoutRow(read === 1 ? 3 : 4)] } }));
    await mount(); await flush();
    expect(layoutOptions()).toEqual(["No layout selected", "Earnings layout · Revision 3"]);
    await chooseLayout(CAPTURE.layout_id);
    await save();
    expect(posts).toHaveLength(1);
    expect(posts[0].layout_capture).toEqual(CAPTURE);
    expect(notices()).toContain(LAYOUT_CONFLICT);
    // The refused capture stays selected as it was sent; the refreshed list offers the new revision beside it.
    expect(layoutReads).toBe(2);
    expect(layoutSelect()?.value).toBe("retained");
    expect(layoutOptions()).toEqual(["No layout selected", "Earnings layout · Revision 3", "Earnings layout · Revision 4"]);
    const stored = sessionStorage.getItem(key), draft = draftValues();
    await save();
    expect(posts, "ordinary Save resent the refused layout capture").toHaveLength(1);
    expectBlocked(LAYOUT_CONFLICT, stored, draft);
    await chooseLayout(CAPTURE.layout_id);
    await save();
    expect(posts).toHaveLength(2);
    expect(posts[1].layout_capture).toEqual({ layout_id: CAPTURE.layout_id, expected_revision: 4 });
    expectCarried(posts[1], retained);
  });

  it("in session, a failed list refresh is shown and the refused capture stays blocked", async () => {
    const retained = richCreate(); delete retained.layout_capture;
    fenceCreate(retained);
    serve([LAYOUT_CONFLICT_REPLY], read => read === 1 ? { status: 200, body: { layouts: [layoutRow(3)] } } : { status: 503, body: { status: "unavailable" } });
    await mount(); await flush();
    await chooseLayout(CAPTURE.layout_id);
    await save();
    expect(posts).toHaveLength(1);
    expect(layoutReads).toBe(2);
    expect(notices()).toContain(LAYOUT_UNAVAILABLE);
    expect(layoutSelect()?.selectedOptions[0]?.textContent).toBe("Retained layout · Revision 3");
    const stored = sessionStorage.getItem(key), draft = draftValues();
    await save();
    expect(posts).toHaveLength(1);
    expectBlocked(LAYOUT_CONFLICT, stored, draft);
    await chooseLayout("");
    await save();
    expect(posts).toHaveLength(2);
    expect(Object.hasOwn(posts[1], "layout_capture")).toBe(false);
  });

  it("blocks a chosen layout that the refreshed list no longer shows", async () => {
    const retained = richCreate(); delete retained.layout_capture;
    fenceCreate(retained);
    let release!: (value: Reply) => void;
    const refreshed = new Promise<Reply>(resolve => { release = resolve; });
    serve([LAYOUT_CONFLICT_REPLY], read => read === 1 ? { status: 200, body: { layouts: [layoutRow(3), layoutRow(2, OTHER_LAYOUT, "Margins layout")] } } : refreshed);
    await mount(); await flush();
    await chooseLayout(CAPTURE.layout_id);
    await save();
    expect(posts).toHaveLength(1);
    // Before the refresh answers, the other layout is still offered and the user chooses it.
    await chooseLayout(OTHER_LAYOUT);
    await act(async () => { release({ status: 200, body: { layouts: [layoutRow(4)] } }); }); await flush();
    expect(layoutSelect()?.selectedOptions[0]?.textContent).toBe("Chosen layout (not in the current list)");
    const stored = sessionStorage.getItem(key), draft = draftValues();
    await save();
    expect(posts, "a layout absent from the list was sent with a revision the list no longer confirms").toHaveLength(1);
    expectBlocked(LAYOUT_MISSING, stored, draft);
    await chooseLayout("");
    await save();
    expect(posts).toHaveLength(2);
    expect(Object.hasOwn(posts[1], "layout_capture")).toBe(false);
  });
});

describe("a definitive reference refusal is never sent again unchanged", () => {
  it("after Try save again is refused, Remove reference sends once and a second refusal blocks again", async () => {
    const retained = richCreate();
    retained.manifest.thesis_refs = [{ ...THESIS }, { ...THESIS_B }];
    fenceCreate(retained);
    serve([REFERENCE_REPLY, REFERENCE_REPLY], () => ({ status: 200, body: { layouts: [layoutRow(3)] } }));
    await mount(); await flush();
    await click("Try save again"); await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: retained.id, layout_capture: CAPTURE });
    expect(posts[0].manifest.thesis_refs).toEqual([THESIS, THESIS_B]);
    expect(button("Try save again")).toBeUndefined();
    const stored = sessionStorage.getItem(key), draft = draftValues();
    expect(notices()).toContain(REFERENCE_UNAVAILABLE);
    await save();
    expect(posts, "ordinary Save resent the refused reference set").toHaveLength(1);
    expectBlocked(REFERENCE_UNAVAILABLE, stored, draft);
    for (const word of ["evidence", "Earnings", "baseline"]) expect(REFERENCE_UNAVAILABLE).not.toContain(word);
    // The deliberate correction: remove the context Thesis version.
    const removeB = [...host.querySelectorAll("form li")].find(li => li.textContent?.startsWith("Context"))?.querySelector("button");
    expect(removeB?.textContent).toBe("Remove reference");
    await act(async () => { removeB!.click(); });
    await save();
    expect(posts).toHaveLength(2);
    expect(posts[1].manifest.thesis_refs).toEqual([THESIS]);
    expect(posts[1].layout_capture).toEqual(CAPTURE);
    expect(posts[1].operation_id).not.toBe(posts[0].operation_id);
    expectCarried(posts[1], retained);
    // That set was refused as well; the block re-arms for it.
    expect(notices()).toContain(REFERENCE_UNAVAILABLE);
    const again = sessionStorage.getItem(key);
    expect(JSON.parse(again!)).toMatchObject({ phase: "rejected", reason: "reference_unavailable", command: { operation_id: posts[1].operation_id } });
    await save();
    expect(posts, "the re-refused set was sent again").toHaveLength(2);
    expect(sessionStorage.getItem(key)).toBe(again);
  });

  it("a refusal on one saved record never blocks an edit of another", async () => {
    sessionStorage.clear();
    const B = "10000000-0000-4000-8000-000000000005";
    const manifest = (title: string) => ({ schema: "investigation_manifest.v2", argument_relations: [], intent: { title, question: "Keep my exact draft", subjects: [{ kind: "security", owner: "terminal.analysis_symbol", object_id: "AAPL" }] }, layout_refs: [], thesis_refs: [{ ...THESIS }], evidence_refs: [], continuation: {} });
    const records: Record<string, string> = { [original.id]: "Record A", [B]: "Record B" };
    serve([REFERENCE_REPLY], () => ({ status: 200, body: { layouts: [] } }), url => {
      if (url === "/api/investigations") return reply({ status: 200, body: { status: "listed", items: Object.entries(records).map(([id, title]) => ({ id, revision: 1, lifecycle: "active", title, question: "Keep my exact draft", updated_at: "2026-10-09T00:00:00.000Z" })) } });
      if (url.startsWith("/api/investigations?id=")) {
        const id = new URL(url, "https://terminal.test").searchParams.get("id")!;
        return reply({ status: 200, body: { status: "found", id, revision: 1, current_revision: 1, lifecycle: "active", manifest: manifest(records[id]), committed_at: "2026-10-09T00:00:00.000Z", layouts: [] } });
      }
      return undefined;
    });
    await act(async () => { root.render(<InvestigationWorkspace ownerKey={owner} initialInvestigationId={original.id} initialRevision={1}/>); }); await flush();
    await click("Edit saved question");
    await save();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: original.id, action: "revise", expected_revision: 1 });
    expect(notices()).toContain(REFERENCE_UNAVAILABLE);
    await save();
    expect(posts, "record A's refused set was sent again").toHaveLength(1);
    // Record B is another lineage with the same references: its edit is never blocked by A's refusal.
    const recordB = [...host.querySelectorAll<HTMLButtonElement>("aside button")].find(b => b.querySelector("strong")?.textContent === "Record B");
    expect(recordB).toBeDefined();
    await act(async () => { recordB!.click(); }); await flush();
    await click("Edit saved question");
    await save();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({ id: B, action: "revise", expected_revision: 1 });
    expect(posts[1].manifest.thesis_refs).toEqual([THESIS]);
  });
});

// T03i (IW2 item 3): a reopened revise has no saved record in view, so its retry copy names Open latest revision.
const RETRY_LATEST = {
  asOf: { en: `Not sent: the retained request's as-of date ${LEGACY_DATE} has no time of day, so it cannot be sent again unchanged. Your draft is retained. Choose Open latest revision and edit it, then set the as-of date before you save.`, zh: `未发送：保留请求的截至日期 ${LEGACY_DATE} 没有具体时间，无法原样重新发送。草稿已保留。请选择“打开最新修订”并编辑，然后设置截至日期再保存。` },
  layout: { en: "Not sent: the retained request's layout was recorded in an older format, so it cannot be sent again unchanged. Your draft is retained. Choose Open latest revision and edit it, then choose the layout again before you save.", zh: "未发送：保留请求中的布局以旧格式记录，无法原样重新发送。草稿已保留。请选择“打开最新修订”并编辑，然后重新选择布局再保存。" },
  refused: { en: "This draft cannot be sent again unchanged. It is retained. Choose Open latest revision and edit it before you save.", zh: "此草稿无法原样重新发送，已保留。请选择“打开最新修订”并编辑后再保存。" },
} as const;
const reviseScenario: Record<keyof typeof RETRY_LATEST, (command: InvestigationCommand) => void> = {
  asOf: () => {},
  layout: command => {
    command.manifest.intent.research_as_of = "2026-10-04T16:00:00.000Z"; command.manifest.argument_relations = [];
    (command as { layout_capture?: unknown }).layout_capture = { ...CAPTURE, revision_id: "30000000-0000-4000-8000-000000000002" };
  },
  // A legacy record may name a baseline outside its evidence; the current contract refuses that unchanged.
  refused: command => { delete command.manifest.intent.research_as_of; command.manifest.review_baseline_ref = { ...EVIDENCE }; },
};

describe("a reopened revise that cannot be retried unchanged is directed to its latest revision", () => {
  it.each((Object.keys(RETRY_LATEST) as (keyof typeof RETRY_LATEST)[]).flatMap(kind => (["en", "zh"] as const).map(lang => [kind, lang] as const)))("%s (%s)", async (kind, lang) => {
    i18n.lang = lang;
    fenceLegacyCreate(command => { command.action = "revise"; command.expected_revision = 3; reviseScenario[kind](command); });
    await mount(); await flush();
    const retained = sessionStorage.getItem(key);
    expect(JSON.parse(retained!)).toMatchObject({ phase: "rejected", reason: "not_applied" });
    await click(lang === "zh" ? "重新保存" : "Try save again");
    expect(posts).toHaveLength(0);
    expect(notices()).toContain(RETRY_LATEST[kind][lang]);
    expect(RETRY_LATEST[kind][lang]).not.toContain(lang === "zh" ? "保存研究" : "Save research");
    expect(button(lang === "zh" ? "打开最新修订" : "Open latest revision")).toBeDefined();
    expect(sessionStorage.getItem(key)).toBe(retained);
  });

  it("keeps the create copy for a reopened create", async () => {
    fenceLegacyCreate();
    await mount(); await flush();
    await click("Try save again");
    expect(notices()).toContain(`Not sent: the retained request's as-of date ${LEGACY_DATE} has no time of day, so it cannot be sent again unchanged. Fix the as-of date in the draft below, then choose Save research. Your draft is unchanged.`);
  });
});

// T03i (IW2 item 4): while the original outcome is unconfirmed, the as-of control is inert even to a
// scripted click that bypasses the disabled fieldset. The editLocked guards are what stop that click.
describe("the as-of control is inert while the save outcome is unconfirmed", () => {
  it("ignores typed values and scripted clicks, then reconciles exactly the original request", async () => {
    const legacy = structuredClone(original);
    delete (legacy.manifest as Partial<typeof legacy.manifest>).argument_relations;
    legacy.manifest.intent.research_as_of = LEGACY_DATE;
    sessionStorage.setItem(key, JSON.stringify({ owner, command: legacy })); // the receipt read answers 404
    await mount(); await flush();
    expect(receiptReads).toEqual([legacy.operation_id]);
    expect(host.textContent).toContain(UNCERTAIN);
    const stored = sessionStorage.getItem(key), shown = notices();
    for (const label of [DATE_LABEL, TIME_LABEL]) expect(input(label)?.matches(":disabled"), label).toBe(true);
    for (const label of ["Use this exact time", "Remove the as-of date"]) expect(button(label)?.matches(":disabled"), label).toBe(true);
    await type(DATE_LABEL, "2026-10-04"); await type(TIME_LABEL, "16:30");
    for (const label of ["Use this exact time", "Remove the as-of date"]) {
      const target = button(label);
      expect(target, label).toBeDefined();
      await act(async () => { target!.click(); });
      await act(async () => { target!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    }
    expect(formAsOf()).toBe(LEGACY_DATE);
    expect(control()).not.toBeNull();
    expect(control()?.querySelector('[role="alert"]')).toBeNull();
    expect(notices()).toEqual(shown);
    expect(sessionStorage.getItem(key)).toBe(stored);
    expect(posts).toHaveLength(0);
    await click("Check original outcome");
    expect(reconciles).toEqual([legacy]);
    expect(posts).toHaveLength(0);
  });
});
