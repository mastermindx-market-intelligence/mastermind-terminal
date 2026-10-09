// @vitest-environment jsdom
//
// F11 (macro#6819, C4 finding 5988747810 / C2 follow-through 5988874506): the Suggested changes
// section must describe the SELECTED thesis's proposal read, and nothing else.
//
// Before: proposal rows were one unbound array. Selecting thesis B left thesis A's rows (and their
// Accept/Reject actions) on screen until B's proposal read answered, and a failed or malformed read
// was mapped to [] — so the section said "No suggested changes yet." about a read that never landed.
//
// Mounts the real `ThesisWorkspace` (same react-dom/client + act harness as
// ThesisWorkspaceLensRail.test.tsx) with a fetch stub whose proposal reads are HELD per thesis, so
// every in-between state is observable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ThesisWorkspace from "@/components/workspaces/ThesisWorkspace";
import { LangProvider } from "@/lib/i18n";
import type { ThesisDetail, ThesisSummary, ThesisVersion } from "@/lib/theses";
import { THESIS_CONTENT_SCHEMA, THESIS_SUBJECT_SCHEMA } from "@/lib/theses";
import type { ProposalRow } from "@/lib/thesisAmendmentProposals";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function summary(id: string, title: string, key: string): ThesisSummary {
  return {
    id, currentVersion: 1, lifecycleState: "active", title, updatedAt: "2026-09-01T00:00:00.000Z",
    subject: { schema: THESIS_SUBJECT_SCHEMA, kind: "issuer", owner: "data_os.security_master", key, identityState: "resolved", display: `${title} Co` },
  };
}

function detailFor(s: ThesisSummary): ThesisDetail {
  const current: ThesisVersion = {
    id: `${s.id}-v1`, thesisId: s.id, version: 1, previousVersion: null, transition: "create",
    lifecycleState: s.lifecycleState, subject: s.subject,
    content: {
      schema: THESIS_CONTENT_SCHEMA, title: s.title, statement: `${s.title} statement`, catalysts: [], falsifiers: [],
      risks: [], horizon: "unspecified", effectiveAt: null, revisionNote: null,
    },
    clientRequestId: `cr-${s.id}`, systemRecordedAt: s.updatedAt, effectiveAt: null,
  };
  return { ...s, createdAt: "2026-01-01T00:00:00.000Z", current, history: [], historyTruncated: false };
}

function proposal(thesisId: string, body: string): ProposalRow {
  return {
    proposalId: `${thesisId}-p-${body.length}`, thesisId, amendedFrom: `${thesisId}-v1`, body, evidenceRefs: [],
    proposedBy: "assistant", state: "proposed", createdAt: "2026-09-02T00:00:00.000Z", versionNumber: 1,
    versionRecordedAt: "2026-09-01T00:00:00.000Z",
  };
}

type Outcome = { rows: ProposalRow[] } | { status: number } | { malformed: true } | { network: true };

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const A = summary("tA", "Alpha", "AAA");
const B = summary("tB", "Bravo", "BBB");
const A_ROWS = [proposal("tA", "Alpha body change one"), proposal("tA", "Alpha second suggested edit")];

/** Every proposal GET waits until the test releases it with an outcome. */
let held: Array<{ thesisId: string; settle: (o: Outcome) => void }> = [];

function installFetch() {
  const details = new Map([[A.id, detailFor(A)], [B.id, detailFor(B)]]);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://x.test");
    if (url.pathname === "/api/thesis-saved-views") return jsonResponse({ views: [] });
    if (url.pathname === "/api/thesis-fire-status") return jsonResponse({ states: {} });
    const m = /^\/api\/thesis\/([^/]+)\/proposals$/.exec(url.pathname);
    if (m) {
      const thesisId = decodeURIComponent(m[1]);
      const outcome = await new Promise<Outcome>((resolve) => { held.push({ thesisId, settle: resolve }); });
      if ("network" in outcome) throw new TypeError("Failed to fetch");
      if ("status" in outcome) return jsonResponse({ error: "unavailable" }, outcome.status);
      if ("malformed" in outcome) return jsonResponse({});
      return jsonResponse({ proposals: outcome.rows });
    }
    if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
    const id = url.searchParams.get("id");
    if (id) {
      const d = details.get(id);
      return d ? jsonResponse({ thesis: d }) : jsonResponse({ error: "thesis_not_found" }, 404);
    }
    return jsonResponse({ theses: [A, B], truncated: false });
  }));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function mount(lang: "en" | "zh" = "en") {
  document.documentElement.setAttribute("data-lang", lang);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<LangProvider><ThesisWorkspace ownerKey={`owner-proposals-${lang}`} /></LangProvider>);
  });
  await flush();
  return container;
}

/** Release the oldest held proposal read for `thesisId`. */
async function release(thesisId: string, outcome: Outcome) {
  const i = held.findIndex((h) => h.thesisId === thesisId);
  expect(i, `a proposal read for ${thesisId} is in flight`).toBeGreaterThanOrEqual(0);
  const [h] = held.splice(i, 1);
  await act(async () => { h.settle(outcome); });
  await flush();
}

async function select(el: HTMLElement, title: string) {
  const row = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="thesis-list-pane"] button'))
    .find((b) => b.textContent?.includes(title));
  expect(row, `list row for ${title}`).toBeTruthy();
  await act(async () => row!.click());
  await flush();
}

const section = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="thesis-proposals"]');
const rows = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-testid="thesis-proposal-row"]'));
const count = (el: HTMLElement) => section(el)?.querySelector("h2 + span")?.textContent ?? null;
const empty = (el: HTMLElement) => el.querySelector('[data-testid="thesis-proposals-empty"]');
const loading = (el: HTMLElement) => el.querySelector('[data-testid="thesis-proposals-loading"]');
const unavailable = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="thesis-proposals-unavailable"]');
const sectionText = (el: HTMLElement) => section(el)?.textContent ?? "";

/** Thesis A is open with its two proposals shown. */
async function openAWithRows(lang: "en" | "zh" = "en") {
  installFetch();
  const el = await mount(lang);
  await select(el, "Alpha");
  await release("tA", { rows: A_ROWS });
  expect(rows(el)).toHaveLength(2);
  expect(count(el)).toBe("2");
  return el;
}

beforeEach(() => {
  held = [];
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  if (dom) {
    Object.defineProperty(window, "localStorage", { value: dom.window.localStorage, configurable: true, writable: true });
    Object.defineProperty(window, "sessionStorage", { value: dom.window.sessionStorage, configurable: true, writable: true });
  }
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/analysis?view=theses");
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; },
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
});

afterEach(() => {
  for (const h of held) h.settle({ rows: [] });
  held = [];
  vi.unstubAllGlobals();
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.documentElement.removeAttribute("data-lang");
});

describe("Suggested changes describe only the selected thesis's proposal read (F11)", () => {
  it("switching A→B while B's read is in flight shows neither A's rows nor a count nor a false empty", async () => {
    const el = await openAWithRows();
    await select(el, "Bravo");
    expect(section(el)).not.toBeNull();                       // B's detail is ready; its proposal read is held
    expect(rows(el)).toHaveLength(0);                         // no A body or Accept/Reject under B
    expect(sectionText(el)).not.toContain("Alpha body change one");
    expect(count(el)).toBeNull();                             // no count before the read answers
    expect(empty(el)).toBeNull();                             // and no claim that B has none
    expect(loading(el)?.textContent).toBe("Loading suggested changes…");
  });

  it("ZH: the same in-flight state reads as loading, never as 目前还没有建议的修改", async () => {
    const el = await openAWithRows("zh");
    await select(el, "Bravo");
    expect(rows(el)).toHaveLength(0);
    expect(count(el)).toBeNull();
    expect(empty(el)).toBeNull();
    expect(loading(el)?.textContent).toBe("正在加载建议的修改…");
  });

  it.each([
    ["HTTP 503", { status: 503 } as Outcome],
    ["a network failure", { network: true } as Outcome],
    ["a malformed body", { malformed: true } as Outcome],
  ])("B's read failing with %s is unavailable with a retry — not 'No suggested changes yet.'", async (_label, outcome) => {
    const el = await openAWithRows();
    await select(el, "Bravo");
    await release("tB", outcome);
    expect(rows(el)).toHaveLength(0);
    expect(count(el)).toBeNull();
    expect(empty(el)).toBeNull();
    expect(loading(el)).toBeNull();
    const notice = unavailable(el);
    expect(notice?.textContent).toContain("Suggested changes could not be loaded.");
    expect(notice?.querySelector("button")?.textContent).toBe("Try again");
  });

  it("ZH: a failed read is 无法加载建议的修改 with 重试", async () => {
    const el = await openAWithRows("zh");
    await select(el, "Bravo");
    await release("tB", { status: 500 });
    expect(empty(el)).toBeNull();
    expect(unavailable(el)?.textContent).toContain("无法加载建议的修改。");
    expect(unavailable(el)?.querySelector("button")?.textContent).toBe("重试");
  });

  it("only a successful empty read earns the empty statement and a zero count", async () => {
    const el = await openAWithRows();
    await select(el, "Bravo");
    await release("tB", { rows: [] });
    expect(rows(el)).toHaveLength(0);
    expect(count(el)).toBe("0");
    expect(empty(el)?.textContent).toBe("No suggested changes yet.");
    expect(loading(el)).toBeNull();
    expect(unavailable(el)).toBeNull();
  });

  it("B's own rows render with their actions once B's read answers", async () => {
    const el = await openAWithRows();
    await select(el, "Bravo");
    await release("tB", { rows: [proposal("tB", "Bravo only change")] });
    expect(rows(el)).toHaveLength(1);
    expect(count(el)).toBe("1");
    expect(sectionText(el)).toContain("Bravo only change");
    expect(sectionText(el)).not.toContain("Alpha body change one");
    expect(Array.from(section(el)!.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Accept", "Reject"]);
  });

  it("Try again re-reads B: loading while held, then B's rows", async () => {
    const el = await openAWithRows();
    await select(el, "Bravo");
    await release("tB", { status: 503 });
    await act(async () => unavailable(el)!.querySelector("button")!.click());
    await flush();
    expect(unavailable(el)).toBeNull();
    expect(loading(el)).not.toBeNull();
    await release("tB", { rows: [proposal("tB", "Bravo after retry")] });
    expect(rows(el)).toHaveLength(1);
    expect(sectionText(el)).toContain("Bravo after retry");
  });

  it("a late answer to A's read after selecting B never changes B's section (existing fence, kept)", async () => {
    installFetch();
    const el = await mount();
    await select(el, "Alpha");                                // A's proposal read is held
    await select(el, "Bravo");
    await release("tB", { rows: [] });
    await release("tA", { rows: A_ROWS });                    // A answers late
    expect(rows(el)).toHaveLength(0);
    expect(empty(el)?.textContent).toBe("No suggested changes yet.");
    expect(count(el)).toBe("0");
  });

  it("the first thesis opened is loading, not empty, while its read is in flight", async () => {
    installFetch();
    const el = await mount();
    await select(el, "Alpha");
    expect(empty(el)).toBeNull();
    expect(count(el)).toBeNull();
    expect(loading(el)).not.toBeNull();
  });
});
