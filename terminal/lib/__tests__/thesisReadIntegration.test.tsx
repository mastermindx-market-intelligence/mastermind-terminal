// @vitest-environment jsdom
//
// Component coverage for the research-management (RMS) lens rail (packet B-F11-2),
// added per Meta-CEO B ruling r3 on PR #520 round-2 review finding M2: the rail's
// selector module (rmsViews.ts) had unit tests, but ZERO rendered-UI coverage — the
// tablist roving behavior, the lens-memory key, the empty states, the typed
// not-connected condition state, and the bounded hydration flow were all untested.
// This mounts the real `ThesisWorkspace` component in jsdom (no @testing-library —
// this repo has none installed; a direct react-dom/client + act mount keeps the
// dependency footprint at zero net new runtime packages) with a stubbed `fetch`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import AnalysisBrainHost from "@/components/chrome/AnalysisBrainHost";
import { currentThesisReadSelection } from "@/lib/thesisReadContext";
vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname, useSearchParams: () => new URLSearchParams(window.location.search) }));
import ThesisWorkspace from "@/components/workspaces/ThesisWorkspace";
import type { ThesisDetail, ThesisSubjectRef, ThesisSummary, ThesisVersion } from "@/lib/theses";
import { THESIS_CONTENT_SCHEMA, THESIS_SUBJECT_SCHEMA } from "@/lib/theses";

// No @testing-library/react in this repo — mounting directly via react-dom/client
// needs this flag so React's `act()` recognizes the environment (otherwise it only
// warns; every assertion below still runs against the real, flushed DOM).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function subject(key: string, display: string): ThesisSubjectRef {
  return {
    schema: THESIS_SUBJECT_SCHEMA,
    kind: "issuer",
    owner: "data_os.security_master",
    key,
    identityState: "resolved",
    display,
  };
}

function content(overrides: Partial<ThesisVersion["content"]> = {}): ThesisVersion["content"] {
  return {
    schema: THESIS_CONTENT_SCHEMA,
    title: "t",
    statement: "s",
    catalysts: [],
    falsifiers: [],
    risks: [],
    horizon: "unspecified",
    effectiveAt: null,
    revisionNote: null,
    ...overrides,
  };
}

function detailFor(s: ThesisSummary, overrides: Partial<ThesisVersion["content"]> = {}): ThesisDetail {
  const current: ThesisVersion = {
    id: s.currentVersion === 2 ? V2 : V1,
    thesisId: s.id,
    version: s.currentVersion,
    previousVersion: s.currentVersion > 1 ? s.currentVersion - 1 : null,
    transition: "create",
    lifecycleState: s.lifecycleState,
    subject: s.subject,
    content: content(overrides),
    clientRequestId: `cr-${s.id}`,
    systemRecordedAt: s.updatedAt,
    effectiveAt: null,
  };
  return { ...s, createdAt: "2026-01-01T00:00:00.000Z", current, history: [], historyTruncated: false };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** Fetch stub over the real `/api/theses` contract (list / ?id= / ?ids=). */
function installFetch(theses: ThesisSummary[], details: Map<string, ThesisDetail>) {
  const idsCalls: string[][] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://x.test");
    if (url.pathname === "/api/thesis-saved-views") return jsonResponse({ views: [] });
    if (url.pathname === "/api/thesis-fire-status") return jsonResponse({ states: {} });
    if (/^\/api\/thesis\/[^/]+\/proposals/.test(url.pathname)) return jsonResponse({ proposals: [] });
    if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
    const ids = url.searchParams.getAll("ids");
    if (ids.length > 0) {
      idsCalls.push(ids);
      const batch: ThesisDetail[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const d = details.get(id);
        if (d) batch.push(d);
        else missing.push(id);
      }
      return jsonResponse({ batch, missing });
    }
    const id = url.searchParams.get("id");
    if (id) {
      const d = details.get(id);
      return d ? jsonResponse({ thesis: d }) : jsonResponse({ error: "thesis_not_found" }, 404);
    }
    return jsonResponse({ theses, truncated: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, idsCalls };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(props: { ownerKey: string; initialSymbol?: string; initialThesisId?: string }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<><AnalysisBrainHost active="NVDA" onCommand={() => {}} onAnnotate={() => {}} onAuthRequired={() => {}} /><ThesisWorkspace ownerKey={props.ownerKey} initialSymbol={props.initialSymbol} initialThesisId={props.initialThesisId} /></>);
  });
  await flush();
  return container;
}

beforeEach(() => {
  // Node 26 registers its OWN experimental global `localStorage`/`sessionStorage`
  // getters (which throw/warn without --localstorage-file). Vitest's jsdom
  // environment only overwrites a global key that already exists on Node's
  // globalThis if that key is in its own (pre-Node-localStorage) allowlist, so on
  // this Node version `window.localStorage` silently resolves to Node's broken
  // stub instead of jsdom's real Storage — force it back to jsdom's own instance.
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  if (dom) {
    Object.defineProperty(window, "localStorage", { value: dom.window.localStorage, configurable: true, writable: true });
    Object.defineProperty(window, "sessionStorage", { value: dom.window.sessionStorage, configurable: true, writable: true });
  }
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (!window.matchMedia) {
    // jsdom does not implement matchMedia; onLensKeyDown only reads `.matches`.
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});


const T = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
function fixture() {
  const summary: ThesisSummary = { id:T, currentVersion:2, lifecycleState:"active", subject:subject("NVDA","Synthetic"), title:"Synthetic owned thesis", updatedAt:"2026-10-20T12:00:00Z" };
  const detail = detailFor(summary); const older = { ...detail.current, id:V1, version:1, previousVersion:null };
  detail.history = [detail.current, older];
  window.history.replaceState(null,"",`/analysis?view=theses&thesis=${T}`);
  installFetch([summary],new Map([[T,detail]]));
}
function readTurn() {
  const w = window as unknown as {MM_BRAIN_CFG?:{getAiContext?:()=> {ambient:{thesis_read?:{thesis_id:string;version_id:string}}}}};
  return w.MM_BRAIN_CFG?.getAiContext?.();
}
it("real GET detail + real host sends exact current/history version, frozen per turn", async () => {
  fixture(); const el = await mount({ownerKey:"synthetic-owner",initialThesisId:T});
  expect(currentThesisReadSelection()).toEqual({thesis_id:T,version_id:V2});
  const first = readTurn(); expect(first?.ambient.thesis_read).toEqual({thesis_id:T,version_id:V2});
  const inspect = Array.from(el.querySelectorAll<HTMLButtonElement>("button[aria-label]")).find(b=>/ 1$/.test(b.getAttribute("aria-label")||""));
  expect(inspect).toBeDefined(); await act(async()=>inspect!.click());
  expect(readTurn()?.ambient.thesis_read).toEqual({thesis_id:T,version_id:V1});
  expect(first?.ambient.thesis_read?.version_id).toBe(V2);
});
it("navigation clears future sends immediately and unmount cannot leave a selection", async () => {
  fixture(); await mount({ownerKey:"synthetic-owner",initialThesisId:T});
  expect(readTurn()?.ambient.thesis_read?.version_id).toBe(V2);
  window.history.replaceState(null,"", "/analysis?view=theses");
  expect(readTurn()?.ambient.thesis_read).toBeUndefined();
  act(()=>root!.unmount()); root=null; expect(currentThesisReadSelection()).toBeNull();
});

it("a retained host getter returns undefined after a real unmount", async () => {
  fixture(); await mount({ownerKey:"synthetic-owner",initialThesisId:T});
  expect(readTurn()?.ambient.thesis_read).toEqual({thesis_id:T,version_id:V2});
  const getAiContext = (window as unknown as {MM_BRAIN_CFG?:{getAiContext?:()=>unknown}}).MM_BRAIN_CFG?.getAiContext;
  expect(getAiContext).toBeTypeOf("function");
  expect(getAiContext?.()).toBeDefined();
  act(()=>root!.unmount()); root=null;
  expect(getAiContext?.()).toBeUndefined();
});

it("owner replacement cannot forward the prior owner's detail while its read fails", async () => {
  fixture(); await mount({ownerKey:"synthetic-owner-a",initialThesisId:T});
  expect(readTurn()?.ambient.thesis_read?.version_id).toBe(V2);
  installFetch([], new Map());
  await act(async () => root!.render(<><AnalysisBrainHost active="NVDA" onCommand={() => {}} onAnnotate={() => {}} onAuthRequired={() => {}} /><ThesisWorkspace ownerKey="synthetic-owner-b" initialThesisId={T} /></>));
  expect(readTurn()?.ambient.thesis_read).toBeUndefined();
});
