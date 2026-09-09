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
    id: `${s.id}-v${s.currentVersion}`,
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

async function mount(props: { ownerKey: string }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ThesisWorkspace ownerKey={props.ownerKey} />);
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

function tabs(el: HTMLElement): HTMLButtonElement[] {
  return Array.from(el.querySelectorAll('[data-testid="thesis-lens-rail"] [role="tab"]'));
}

describe("ThesisWorkspace lens rail (B-F11-2, M2)", () => {
  it("tablist: roving tabIndex, and Home/End jump to the first/last lens", async () => {
    const t1: ThesisSummary = { id: "t1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z" };
    installFetch([t1], new Map());
    const el = await mount({ ownerKey: "owner-tablist" });

    const initial = tabs(el);
    expect(initial.map((b) => b.dataset.view)).toEqual(["coverage", "ideas", "theses", "reviews", "catalysts", "risks", "notes"]);
    // default view is "theses": only its tab is in the roving tab order.
    expect(initial.find((b) => b.dataset.view === "theses")!.tabIndex).toBe(0);
    expect(initial.filter((b) => b.dataset.view !== "theses").every((b) => b.tabIndex === -1)).toBe(true);
    expect(initial.find((b) => b.dataset.view === "theses")!.getAttribute("aria-selected")).toBe("true");

    const list = el.querySelector('[role="tablist"]')!;
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    });
    let current = tabs(el);
    expect(current.find((b) => b.dataset.view === "coverage")!.getAttribute("aria-selected")).toBe("true");
    expect(current.find((b) => b.dataset.view === "coverage")!.tabIndex).toBe(0);

    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    });
    current = tabs(el);
    expect(current.find((b) => b.dataset.view === "notes")!.getAttribute("aria-selected")).toBe("true");
    expect(current.find((b) => b.dataset.view === "notes")!.tabIndex).toBe(0);
  });

  it("lens memory: selecting a lens persists mm.thesis.lens.v1:<ownerKey>, and a remount restores it", async () => {
    const t1: ThesisSummary = { id: "t1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z" };
    installFetch([t1], new Map());
    const ownerKey = "owner-memory";
    let el = await mount({ ownerKey });

    const coverageTab = tabs(el).find((b) => b.dataset.view === "coverage")!;
    await act(async () => {
      coverageTab.click();
    });
    expect(window.localStorage.getItem(`mm.thesis.lens.v1:${ownerKey}`)).toBe("coverage");

    // Remount fresh (new root, same owner + same storage) — the lens-restore effect
    // must read the persisted key back.
    await act(async () => root!.unmount());
    container?.remove();
    installFetch([t1], new Map());
    el = await mount({ ownerKey });
    expect(tabs(el).find((b) => b.dataset.view === "coverage")!.getAttribute("aria-selected")).toBe("true");
  });

  it("Coverage → subject filter: the Theses lens names the subject (never 'Everything you have written'), and a labeled chip clears it (M3)", async () => {
    const alphaA: ThesisSummary = { id: "a1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha thesis one", updatedAt: "2026-09-02T00:00:00.000Z" };
    const alphaB: ThesisSummary = { id: "a2", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha thesis two", updatedAt: "2026-09-01T00:00:00.000Z" };
    const beta: ThesisSummary = { id: "b1", currentVersion: 1, lifecycleState: "active", subject: subject("BBB", "Beta Co"), title: "Beta thesis", updatedAt: "2026-08-30T00:00:00.000Z" };
    installFetch([alphaA, alphaB, beta], new Map());
    const el = await mount({ ownerKey: "owner-subject-filter" });

    // Unfiltered Theses lens carries the generic "everything" sentence.
    expect(el.querySelector(".lensWhat, [class*='lensWhat']")?.textContent).toBe("Everything you have written.");

    const coverageTab = tabs(el).find((b) => b.dataset.view === "coverage")!;
    await act(async () => coverageTab.click());
    const alphaRow = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] button')).find((b) =>
      b.textContent?.includes("Alpha Co"),
    ) as HTMLButtonElement;
    expect(alphaRow).toBeTruthy();
    await act(async () => alphaRow.click());

    // Clicking a Coverage row jumps to Theses, filtered to that subject.
    expect(tabs(el).find((b) => b.dataset.view === "theses")!.getAttribute("aria-selected")).toBe("true");
    const rows = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] .thesisList button, [data-testid="rms-lens-panel"] button'));
    expect(rows.some((b) => b.textContent?.includes("Alpha thesis one"))).toBe(true);
    expect(rows.some((b) => b.textContent?.includes("Beta thesis"))).toBe(false);
    expect(el.querySelector("[class*='lensWhat']")?.textContent).toBe("Only what you have written about Alpha Co.");
    expect(el.querySelector("[class*='lensWhat']")?.textContent).not.toBe("Everything you have written.");

    const chip = el.querySelector('[data-testid="rms-subject-chip"]') as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe("Alpha Co · Show everything");

    await act(async () => chip.click());
    expect(el.querySelector('[data-testid="rms-subject-chip"]')).toBeNull();
    expect(el.querySelector("[class*='lensWhat']")?.textContent).toBe("Everything you have written.");
    const clearedRows = Array.from(el.querySelectorAll('[data-testid="rms-lens-panel"] button'));
    expect(clearedRows.some((b) => b.textContent?.includes("Beta thesis"))).toBe(true);
  });

  it("every lens renders its own empty state when there is nothing to show", async () => {
    installFetch([], new Map());
    const el = await mount({ ownerKey: "owner-empty" });

    const expectedEmpty: Record<string, string> = {
      coverage: "Nothing is covered yet. Write a thesis and its subject appears here.",
      ideas: "Nothing new is waiting. Every thesis has been revisited at least once.",
      theses: "No theses yet. Start with a view you could be wrong about.",
      reviews: "Nothing is waiting for a second look.",
      catalysts: "No catalysts written down in the theses loaded here.",
      risks: "No risks written down in the theses loaded here.",
      notes: "No revision notes yet. They appear when you save a change and say why.",
    };
    for (const [view, text] of Object.entries(expectedEmpty)) {
      const tab = tabs(el).find((b) => b.dataset.view === view)!;
      await act(async () => {
        tab.click();
      });
      // The Theses lens keeps master's pre-existing "thesis-empty" testid (a sibling
      // repair on this branch caught the rail rewrite silently dropping the e2e
      // contract in terminal/e2e/thesis-workspace.spec.ts) — every other lens is
      // "rms-empty".
      const empty = el.querySelector(view === "theses" ? '[data-testid="thesis-empty"]' : '[data-testid="rms-empty"]');
      expect(empty, `expected an empty state for lens "${view}"`).not.toBeNull();
      expect(empty!.textContent).toBe(text);
    }
  });

  it("condition line: with no monitor reader wired, it renders the typed not-connected sentence (M1) — never a transient-error word", async () => {
    const t1: ThesisSummary = { id: "t1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z" };
    installFetch([t1], new Map([["t1", detailFor(t1)]]));
    const el = await mount({ ownerKey: "owner-condition" });

    const row = el.querySelector('[data-testid="thesis-list-pane"] .thesisList button, [data-testid="thesis-list-pane"] button') as HTMLButtonElement | null;
    // Select the one thesis row in the (default) Theses lens.
    const thesesButtons = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] button')).filter(
      (b) => b.textContent?.includes("Alpha"),
    ) as HTMLButtonElement[];
    expect(thesesButtons.length).toBeGreaterThan(0);
    await act(async () => {
      thesesButtons[0].click();
    });
    await flush();

    const cond = el.querySelector('[data-testid="thesis-condition"]');
    expect(cond).not.toBeNull();
    expect(cond!.getAttribute("data-source")).toBe("unavailable");
    expect(cond!.textContent).toBe("Condition checks are not connected yet.");
    expect(cond!.textContent).not.toMatch(/unavailable|error|failed/i);
    void row;
  });

  it("bounded hydration: active-only budget (m5), one automatic batch of 10, a second only on 'Show N more', and knowable counts once complete (m1)", async () => {
    const active = Array.from({ length: 12 }, (_, i) =>
      ({
        id: `h${i}`,
        currentVersion: 2,
        lifecycleState: "active" as const,
        subject: subject("AAA", "Alpha Co"),
        title: `Thesis ${i}`,
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      }) satisfies ThesisSummary,
    );
    // m5 (round-2 review): 3 non-active theses, dated NEWER than every active one, so a
    // budget that is not filtered to "active" would spend hydration slots on them first
    // (selectHydrationIds sorts newest-first) — and catalystRows never surfaces a line
    // for a non-active thesis, so those slots would add zero rows while still advancing
    // the scope sentence. They carry no catalysts fixture content either way.
    const inactive: ThesisSummary[] = [
      { id: "arc1", currentVersion: 1, lifecycleState: "archived", subject: subject("AAA", "Alpha Co"), title: "Archived one", updatedAt: "2026-09-05T00:00:00.000Z" },
      { id: "arc2", currentVersion: 1, lifecycleState: "archived", subject: subject("AAA", "Alpha Co"), title: "Archived two", updatedAt: "2026-09-04T00:00:00.000Z" },
      { id: "inv1", currentVersion: 1, lifecycleState: "invalidated", subject: subject("AAA", "Alpha Co"), title: "Invalidated one", updatedAt: "2026-09-03T00:00:00.000Z" },
    ];
    const all = [...inactive, ...active];
    const details = new Map(all.map((s) => [s.id, detailFor(s, s.lifecycleState === "active" ? { catalysts: [`cat-${s.id}`] } : {})]));
    const { idsCalls } = installFetch(all, details);
    const el = await mount({ ownerKey: "owner-hydration" });

    const catalystsTab = tabs(el).find((b) => b.dataset.view === "catalysts")!;
    // m1: before hydration completes, the content-lens count is unknowable.
    expect(catalystsTab.querySelector("[class*='lensCount']")?.textContent).toBe("—");
    await act(async () => {
      catalystsTab.click();
    });
    await flush();

    expect(idsCalls.length).toBe(1);
    expect(idsCalls[0].length).toBe(10);
    // Every id in the first automatic batch is one of the 12 ACTIVE theses — none of
    // the 3 newer non-active ones — and the scope denominator is 12, not 15.
    expect(idsCalls[0].every((id) => active.some((s) => s.id === id))).toBe(true);
    // Round-2 review r3 MAJOR-2: names the actual counted subset ("active theses").
    expect(el.querySelector('[data-testid="rms-scope"]')?.textContent).toBe("Showing lines from 10 of your 12 active theses.");
    expect(catalystsTab.querySelector("[class*='lensCount']")?.textContent).toBe("—");

    // Switching lenses away and back must NOT re-trigger an automatic batch (M4: one
    // automatic batch, ever, per mount — not "once per lens").
    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "risks")!.click();
    });
    await flush();
    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "catalysts")!.click();
    });
    await flush();
    expect(idsCalls.length).toBe(1);

    // Meta-CEO B ruling r4 minor 2: 2 theses remain (12 - 10), so the count-aware copy
    // reads "Show 2 more" — never the withdrawn hardcoded "Show 10 more".
    const showMore = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Show 2 more") as HTMLButtonElement;
    expect(showMore).toBeTruthy();
    await act(async () => {
      showMore.click();
    });
    await flush();

    expect(idsCalls.length).toBe(2);
    expect(idsCalls[1].length).toBe(2);
    const allRequested = new Set([...idsCalls[0], ...idsCalls[1]]);
    expect(allRequested.size).toBe(12);
    expect([...allRequested].every((id) => active.some((s) => s.id === id))).toBe(true);
    expect(el.querySelector('[data-testid="rms-scope"]')?.textContent).toBe("Showing lines from all 12 active theses.");
    expect(Array.from(el.querySelectorAll("button")).some((b) => /^Show \d+ more$/.test(b.textContent ?? ""))).toBe(false);
    // m1: scope is now complete, so the catalysts count is exactly knowable (one
    // catalyst per active thesis, none from the 3 non-active ones).
    expect(tabs(el).find((b) => b.dataset.view === "catalysts")!.querySelector("[class*='lensCount']")?.textContent).toBe("12");
  });

  it("bounded hydration: an all-missing first batch never chains a second automatic fetch (M4)", async () => {
    // Reproduces the exact round-2 trigger: hydratedDetails stays at size 0 because
    // every id in the batch comes back `missing` (e.g. concurrently deleted rows) — the
    // bug was that `missingIds` growing re-fired the effect and chained further
    // automatic batches until scope completed.
    const active = Array.from({ length: 12 }, (_, i) =>
      ({
        id: `m${i}`,
        currentVersion: 1,
        lifecycleState: "active" as const,
        subject: subject("AAA", "Alpha Co"),
        title: `Thesis ${i}`,
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      }) satisfies ThesisSummary,
    );
    const { idsCalls } = installFetch(active, new Map()); // empty details map => every id comes back `missing`
    const el = await mount({ ownerKey: "owner-hydration-missing" });

    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "catalysts")!.click();
    });
    await flush();
    await flush();
    await flush();

    expect(idsCalls.length).toBe(1);
  });

  it("bounded hydration: a faulted batch shows a retry action, not a permanent dead end (round-2 review MAJOR)", async () => {
    const active = Array.from({ length: 3 }, (_, i) =>
      ({
        id: `r${i}`,
        currentVersion: 1,
        lifecycleState: "active" as const,
        subject: subject("AAA", "Alpha Co"),
        title: `Thesis ${i}`,
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      }) satisfies ThesisSummary,
    );
    const details = new Map(active.map((s) => [s.id, detailFor(s, { catalysts: [`cat-${s.id}`] })]));
    let batchCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      if (ids.length > 0) {
        batchCalls += 1;
        // First batch faults (e.g. the route's own 503 fault path); the retry must
        // use the SAME explicit-user-action mechanism as "Show N more" and succeed.
        if (batchCalls === 1) return jsonResponse({ error: "thesis_store_unavailable" }, 503);
        const batch = ids.map((id) => details.get(id)).filter((d): d is ThesisDetail => !!d);
        return jsonResponse({ batch, missing: [] });
      }
      return jsonResponse({ theses: active, truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-hydration-retry" });

    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "catalysts")!.click();
    });
    await flush();

    const unavailablePanel = el.querySelector('[data-testid="rms-hydration-unavailable"]');
    expect(unavailablePanel, "expected the hydration-unavailable panel after a faulted batch").not.toBeNull();
    // "Show N more" is deliberately hidden while this panel shows — it must not be
    // the ONLY way out, or a faulted batch is a permanent dead end.
    expect(Array.from(el.querySelectorAll("button")).some((b) => /^Show \d+ more$/.test(b.textContent ?? ""))).toBe(false);
    const retryButton = Array.from(unavailablePanel!.querySelectorAll("button")).find(
      (b) => b.textContent === "Try again",
    ) as HTMLButtonElement;
    expect(retryButton, "expected a retry action inside the hydration-unavailable panel").toBeTruthy();

    await act(async () => {
      retryButton.click();
    });
    await flush();

    expect(el.querySelector('[data-testid="rms-hydration-unavailable"]')).toBeNull();
    expect(batchCalls).toBe(2);
    expect(Array.from(el.querySelectorAll('[data-testid="rms-line-row"]')).length).toBe(3);
  });

  it("a fault on a LATER batch never unmounts rows already hydrated (round-2 review r3 MAJOR-1)", async () => {
    const active = Array.from({ length: 13 }, (_, i) =>
      ({
        id: `f${i}`,
        currentVersion: 1,
        lifecycleState: "active" as const,
        subject: subject("AAA", "Alpha Co"),
        title: `Thesis ${i}`,
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      }) satisfies ThesisSummary,
    );
    const details = new Map(active.map((s) => [s.id, detailFor(s, { catalysts: [`cat-${s.id}`] })]));
    let batchCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      if (ids.length > 0) {
        batchCalls += 1;
        // Batch 1 (the automatic 10) succeeds; batch 2 (the explicit "Show N more"
        // for the remaining 3) faults — the exact RED-first sequence from the ruling.
        if (batchCalls === 2) return jsonResponse({ error: "thesis_store_unavailable" }, 503);
        const batch = ids.map((id) => details.get(id)).filter((d): d is ThesisDetail => !!d);
        return jsonResponse({ batch, missing: [] });
      }
      return jsonResponse({ theses: active, truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-hydration-later-fault" });

    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "catalysts")!.click();
    });
    await flush();
    expect(Array.from(el.querySelectorAll('[data-testid="rms-line-row"]')).length).toBe(10);

    // Meta-CEO B ruling r4 minor 2: 3 theses remain (13 - 10) — "Show 3 more", never
    // the withdrawn hardcoded "Show 10 more".
    const showMore = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Show 3 more") as HTMLButtonElement;
    expect(showMore).toBeTruthy();
    await act(async () => {
      showMore.click();
    });
    await flush();

    // The first 10 rows are still in the DOM — a fault on this later batch must never
    // unmount them, and the terminal "nothing to show" panel must NOT render (rows
    // exist). The fault is the smaller inline notice, distinct from that panel.
    expect(Array.from(el.querySelectorAll('[data-testid="rms-line-row"]')).length).toBe(10);
    expect(el.querySelector('[data-testid="rms-hydration-unavailable"]')).toBeNull();
    const faultNotice = el.querySelector('[data-testid="rms-hydration-fault"]');
    expect(faultNotice, "expected the inline row-level fault notice").not.toBeNull();
    // Meta-CEO B ruling r4 minor 2: count-aware, never the withdrawn "The next 10
    // could not be loaded.".
    expect(faultNotice!.textContent).toContain("3 more could not be loaded. Try again.");
    // "Show N more" hides while the fault notice is up — the notice's own retry
    // button is the one explicit-action way to try the pending increment again.
    expect(Array.from(el.querySelectorAll("button")).some((b) => /^Show \d+ more$/.test(b.textContent ?? ""))).toBe(false);

    const retryButton = Array.from(faultNotice!.querySelectorAll("button")).find(
      (b) => b.textContent === "Try again",
    ) as HTMLButtonElement;
    expect(retryButton, "expected a retry action inside the inline fault notice").toBeTruthy();

    await act(async () => {
      retryButton.click();
    });
    await flush();

    expect(el.querySelector('[data-testid="rms-hydration-fault"]')).toBeNull();
    expect(batchCalls).toBe(3);
    expect(Array.from(el.querySelectorAll('[data-testid="rms-line-row"]')).length).toBe(13);
  });

  it("Coverage subject filter names the subject and offers a labeled way back even after the filtered subject's last thesis leaves a later list refresh (round-2 review MAJOR)", async () => {
    const alphaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const betaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const alpha: ThesisSummary = { id: alphaId, currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha thesis", updatedAt: "2026-09-02T00:00:00.000Z" };
    const beta: ThesisSummary = { id: betaId, currentVersion: 1, lifecycleState: "active", subject: subject("BBB", "Beta Co"), title: "Beta thesis", updatedAt: "2026-08-30T00:00:00.000Z" };
    const details = new Map([[alphaId, detailFor(alpha)], [betaId, detailFor(beta)]]);
    let listCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      if ((init?.method ?? "GET") === "POST") {
        // Archives Alpha's one thesis.
        return jsonResponse({ thesisId: alphaId, version: 2, lifecycleState: "archived", replayed: false });
      }
      const id = url.searchParams.get("id");
      if (id) {
        const d = details.get(id);
        return d ? jsonResponse({ thesis: d }) : jsonResponse({ error: "thesis_not_found" }, 404);
      }
      listCalls += 1;
      if (listCalls === 1) return jsonResponse({ theses: [alpha, beta], truncated: false });
      // The reload after the archive: Alpha's subject has moved out of this view
      // entirely (re-keyed/removed) while the filter is still active — the exact
      // round-2 review trigger.
      return jsonResponse({ theses: [beta], truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-subject-filter-refresh" });

    const coverageTab = tabs(el).find((b) => b.dataset.view === "coverage")!;
    await act(async () => coverageTab.click());
    const alphaCoverageRow = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] button')).find((b) =>
      b.textContent?.includes("Alpha Co"),
    ) as HTMLButtonElement;
    await act(async () => alphaCoverageRow.click());

    expect(el.querySelector("[class*='lensWhat']")?.textContent).toBe("Only what you have written about Alpha Co.");
    let chip = el.querySelector('[data-testid="rms-subject-chip"]') as HTMLButtonElement;
    expect(chip.textContent).toBe("Alpha Co · Show everything");

    const alphaThesisRow = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] .thesisList button, [data-testid="rms-lens-panel"] button')).find(
      (b) => b.textContent?.includes("Alpha thesis"),
    ) as HTMLButtonElement;
    expect(alphaThesisRow, "expected the filtered Alpha thesis row").toBeTruthy();
    await act(async () => alphaThesisRow.click());
    await flush();

    const archiveButton = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Archive") as HTMLButtonElement;
    expect(archiveButton, "expected an Archive action on the open Alpha thesis").toBeTruthy();
    await act(async () => archiveButton.click());
    await flush();
    await flush();

    // The filter survives the refresh: never the forbidden "Everything you have
    // written." sentence, never a bare " · Show everything" chip, and never the
    // false "No theses yet." empty state while Beta's thesis still exists.
    expect(el.querySelector("[class*='lensWhat']")?.textContent).toBe("Only what you have written about Alpha Co.");
    expect(el.querySelector("[class*='lensWhat']")?.textContent).not.toBe("Everything you have written.");
    chip = el.querySelector('[data-testid="rms-subject-chip"]') as HTMLButtonElement;
    expect(chip, "expected the subject chip to survive the refresh").toBeTruthy();
    expect(chip.textContent).toBe("Alpha Co · Show everything");
    expect(el.querySelector('[data-testid="thesis-empty"]')).toBeNull();
    const filteredEmpty = el.querySelector('[data-testid="rms-filtered-empty"]');
    expect(filteredEmpty, "expected the distinct filtered-empty state, not the false 'No theses yet.'").not.toBeNull();
    expect(filteredEmpty!.textContent).toBe("Nothing written about Alpha Co right now. Clear the filter to see every thesis.");
  });

  it("lens rail keyboard nav is disabled while the carrier is locked (round-2 review minor)", async () => {
    const t1: ThesisSummary = { id: "t1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z" };
    // A blocked carrier (corrupt localStorage entry for this owner) keeps
    // `carrierLocked` true for the life of the mount.
    window.localStorage.setItem("mm.thesis.pending.v2:owner-locked-nav:broken", "not json");
    installFetch([t1], new Map());
    const el = await mount({ ownerKey: "owner-locked-nav" });

    const list = el.querySelector('[role="tablist"]')!;
    expect(tabs(el).every((b) => b.disabled)).toBe(true);
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    });
    // Still on the default "theses" lens — the keyboard handler must not switch lenses
    // while every tab is disabled, even though the listener lives on the <ul> and the
    // individual `disabled` attribute alone does not stop it from firing.
    expect(tabs(el).find((b) => b.dataset.view === "theses")!.getAttribute("aria-selected")).toBe("true");
  });

  it("narrow-mode (<=600px) tablist: ArrowRight/ArrowLeft rove the same as ArrowDown/ArrowUp", async () => {
    const t1: ThesisSummary = { id: "t1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z" };
    installFetch([t1], new Map());
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(max-width: 600px)",
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const el = await mount({ ownerKey: "owner-narrow-nav" });
      const list = el.querySelector('[role="tablist"]')!;
      // Round-2 review r3 minor 1/2: aria-orientation follows the same 600px
      // breakpoint the CSS switches the rail to a horizontal scroller at.
      expect(list.getAttribute("aria-orientation")).toBe("horizontal");
      await act(async () => {
        list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      });
      expect(tabs(el).find((b) => b.dataset.view === "reviews")!.getAttribute("aria-selected")).toBe("true");
      await act(async () => {
        list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
      });
      expect(tabs(el).find((b) => b.dataset.view === "theses")!.getAttribute("aria-selected")).toBe("true");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("an unsaved new thesis renders no condition line (nothing to check the condition of) (round-2 review minor)", async () => {
    installFetch([], new Map());
    const el = await mount({ ownerKey: "owner-new-thesis-condition" });
    const newThesisButton = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "New thesis") as HTMLButtonElement;
    await act(async () => newThesisButton.click());
    expect(el.querySelector('[data-testid="thesis-condition"]')).toBeNull();
  });

  it("tablist ARIA: vertical by default (desktop), and every tab's <li> wrapper is role=presentation (round-2 review r3 minor 1/2)", async () => {
    const t1: ThesisSummary = { id: "t1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z" };
    installFetch([t1], new Map());
    const el = await mount({ ownerKey: "owner-aria-default" });
    const list = el.querySelector('[data-testid="thesis-lens-rail"] [role="tablist"]')!;
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    const items = Array.from(list.querySelectorAll(":scope > li"));
    expect(items.length).toBe(7);
    expect(items.every((li) => li.getAttribute("role") === "presentation")).toBe(true);
  });

  it("Theses lens rail badge marks a FILTERED count distinctly from the total (round-2 review r3 minor 7)", async () => {
    const alpha: ThesisSummary = { id: "a1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha thesis", updatedAt: "2026-09-02T00:00:00.000Z" };
    const beta: ThesisSummary = { id: "b1", currentVersion: 1, lifecycleState: "active", subject: subject("BBB", "Beta Co"), title: "Beta thesis", updatedAt: "2026-08-30T00:00:00.000Z" };
    installFetch([alpha, beta], new Map());
    const el = await mount({ ownerKey: "owner-filtered-badge" });

    const thesesTab = tabs(el).find((b) => b.dataset.view === "theses")!;
    const badge = () => thesesTab.querySelector("[class*='lensCount']") as HTMLElement;
    // Unfiltered: the badge counts both theses, and carries no filtered marker.
    expect(badge().textContent).toContain("2");
    expect(badge().hasAttribute("data-filtered")).toBe(false);

    const coverageTab = tabs(el).find((b) => b.dataset.view === "coverage")!;
    await act(async () => coverageTab.click());
    const alphaRow = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] button')).find((b) =>
      b.textContent?.includes("Alpha Co"),
    ) as HTMLButtonElement;
    await act(async () => alphaRow.click());

    // Filtered to Alpha: the badge shows the FILTERED count (1, not 2) and now carries
    // a marker so it never reads as the total.
    expect(badge().textContent).toContain("1");
    expect(badge().hasAttribute("data-filtered")).toBe(true);
  });

  it("switching lenses clears a stale hydration fault immediately, before the new lens's own read (round-2 review r3 minor 5)", async () => {
    const active = Array.from({ length: 3 }, (_, i) =>
      ({
        id: `s${i}`,
        currentVersion: 1,
        lifecycleState: "active" as const,
        subject: subject("AAA", "Alpha Co"),
        title: `Thesis ${i}`,
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      }) satisfies ThesisSummary,
    );
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      // Every batch read faults — this test only needs the fault flag to be raised
      // once, on the first (default-view) lens.
      if (ids.length > 0) return jsonResponse({ error: "thesis_store_unavailable" }, 503);
      return jsonResponse({ theses: active, truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-lens-reset" });

    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "catalysts")!.click();
    });
    await flush();
    expect(el.querySelector('[data-testid="rms-hydration-unavailable"]'), "expected the fault panel on catalysts").not.toBeNull();

    // Switch to a different content lens. Its own automatic-batch effect is a no-op
    // (M4: one automatic batch, ever, per mount — already consumed by catalysts), so
    // if the fault flag were not reset on lens change, this lens would show the exact
    // same stale fault panel despite never having made a request of its own.
    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "risks")!.click();
    });
    expect(el.querySelector('[data-testid="rms-hydration-unavailable"]'), "the previous lens's fault must not bleed into this one").toBeNull();
  });

  it("changing ownerKey clears a stale hydration fault left by the previous owner, and the new owner's OWN hydration genuinely succeeds (Meta-CEO B ruling r4 minor 5: non-vacuous)", async () => {
    // Ruling r4 minor 5: the prior version of this test asserted only that the fault
    // panel was absent after the swap — but the panel gates on `view` being a content
    // lens too, and the ownerKey-change effect resets `view` back to the default
    // "theses" lens, so the panel was ALWAYS going to be absent regardless of whether
    // the fault flag itself was actually cleared. This version explicitly returns to a
    // content lens for owner B and asserts real hydrated CONTENT renders, not just the
    // panel's absence — the fault flag must be genuinely false, not merely masked.
    const ownerAThesis: ThesisSummary = {
      id: "reset-a1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const ownerBThesis: ThesisSummary = {
      id: "reset-b1", currentVersion: 1, lifecycleState: "active",
      subject: subject("BBB", "Beta Co"), title: "Beta thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const detailB = detailFor(ownerBThesis, { catalysts: ["catalyst-RESET-B"] });
    let currentTheses: ThesisSummary[] = [ownerAThesis];
    let currentlyOwnerB = false;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      if (ids.length > 0) {
        // Owner A's batch always faults; Owner B's own batch genuinely succeeds.
        if (!currentlyOwnerB) return jsonResponse({ error: "thesis_store_unavailable" }, 503);
        const batch = ids.map((id) => (id === ownerBThesis.id ? detailB : undefined)).filter((d): d is ThesisDetail => !!d);
        return jsonResponse({ batch, missing: [] });
      }
      return jsonResponse({ theses: currentTheses, truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-reset-a" });

    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "catalysts")!.click();
    });
    await flush();
    expect(el.querySelector('[data-testid="rms-hydration-unavailable"]'), "expected the fault panel for owner A").not.toBeNull();

    // Re-render the SAME root with a different ownerKey (no unmount) — this is the
    // exact prop-change React commits, not a fresh mount, so the ownerKey-keyed
    // effect (not a mount-time initializer) is what must fire.
    currentlyOwnerB = true;
    currentTheses = [ownerBThesis];
    await act(async () => {
      root!.render(<ThesisWorkspace ownerKey="owner-reset-b" />);
    });
    await flush();
    // Explicitly return to the Catalysts lens for owner B — the view itself was reset
    // to "theses" by the owner swap, so this is required to exercise the fault flag,
    // not merely observe that the panel's OTHER gating condition (a content lens)
    // happens to be false.
    await act(async () => {
      tabs(el).find((b) => b.dataset.view === "catalysts")!.click();
    });
    await flush();

    expect(el.querySelector('[data-testid="rms-hydration-unavailable"]'), "owner A's fault must not survive into owner B").toBeNull();
    expect(
      Array.from(el.querySelectorAll('[data-testid="rms-line-row"]')).some((row) => row.textContent?.includes("catalyst-RESET-B")),
      "expected owner B's own real hydrated content, not just an absent fault panel",
    ).toBe(true);
  });

  it("the rail's aria-orientation stays live across a breakpoint change, not just the initial matchMedia read (round-2 review r3 minor 2)", async () => {
    const t1: ThesisSummary = { id: "t1", currentVersion: 1, lifecycleState: "active", subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z" };
    installFetch([t1], new Map());
    let changeListener: (() => void) | null = null;
    // A real MediaQueryList mutates its own `.matches` before dispatching "change" —
    // the component reads `mq.matches` inside the listener, not an event argument, so
    // the stub must mirror that: one shared, mutable object, not a fresh literal per
    // `matchMedia()` call.
    const mq = {
      matches: false,
      media: "(max-width: 600px)",
      addListener() {},
      removeListener() {},
      addEventListener(_type: string, listener: () => void) {
        changeListener = listener;
      },
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    };
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => {
      mq.media = query;
      return mq as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    try {
      const el = await mount({ ownerKey: "owner-live-breakpoint" });
      const list = el.querySelector('[data-testid="thesis-lens-rail"] [role="tablist"]')!;
      expect(list.getAttribute("aria-orientation")).toBe("vertical");
      expect(changeListener, "expected the component to register a matchMedia change listener").not.toBeNull();

      // Simulate the viewport crossing the 600px breakpoint after mount — the live
      // resize case minor 2 requires, distinct from the two static-breakpoint states
      // the other tests cover.
      mq.matches = true;
      await act(async () => {
        changeListener!();
      });
      expect(list.getAttribute("aria-orientation")).toBe("horizontal");

      mq.matches = false;
      await act(async () => {
        changeListener!();
      });
      expect(list.getAttribute("aria-orientation")).toBe("vertical");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("the Worth-a-look (reviews) lens re-evaluates 90-day staleness on focus, not only when the list itself changes (round-2 review r3 minor 6)", async () => {
    const start = new Date("2026-01-10T00:00:00.000Z");
    // Updated 89 days before `start` — active, and not yet stale.
    const borderline: ThesisSummary = {
      id: "stale1",
      currentVersion: 1,
      lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"),
      title: "Borderline thesis",
      updatedAt: new Date(start.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString(),
    };
    installFetch([borderline], new Map());
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(start);
      const el = await mount({ ownerKey: "owner-review-clock" });

      await act(async () => {
        tabs(el).find((b) => b.dataset.view === "reviews")!.click();
      });
      await flush();
      // Not yet stale: the reviews lens is empty and the badge count is 0.
      expect(el.querySelector('[data-testid="rms-empty"]')).not.toBeNull();
      const reviewsTab = tabs(el).find((b) => b.dataset.view === "reviews")!;
      expect(reviewsTab.querySelector("[class*='lensCount']")?.textContent).toBe("0");

      // Two days later the same thesis has crossed the 90-day threshold — nothing about
      // `theses` itself changed, only the clock. A tab regaining focus is the second
      // (non-timer) trigger the ruling names.
      vi.setSystemTime(new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000));
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await flush();

      expect(el.querySelector('[data-testid="rms-empty"]')).toBeNull();
      expect(reviewsTab.querySelector("[class*='lensCount']")?.textContent).toBe("1");
      const rows = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] .thesisList button, [data-testid="rms-lens-panel"] button'));
      expect(rows.some((b) => b.textContent?.includes("Borderline thesis"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an ownerKey change resets every per-owner state so no owner-A data survives into owner B (Meta-CEO B ruling r4 MAJOR)", async () => {
    const ownerAThesis: ThesisSummary = {
      id: "iso-a1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const ownerBThesis: ThesisSummary = {
      id: "iso-b1", currentVersion: 1, lifecycleState: "active",
      subject: subject("BBB", "Beta Co"), title: "Beta thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const detailA = detailFor(ownerAThesis, { catalysts: ["catalyst-A"], risks: ["risk-A"], revisionNote: "note-A" });
    const detailB = detailFor(ownerBThesis, { catalysts: ["catalyst-B"], risks: ["risk-B"], revisionNote: "note-B" });
    let currentTheses: ThesisSummary[] = [ownerAThesis];
    const details = new Map([[ownerAThesis.id, detailA], [ownerBThesis.id, detailB]]);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      if (ids.length > 0) {
        const batch = ids.map((id) => details.get(id)).filter((d): d is ThesisDetail => !!d);
        const missing = ids.filter((id) => !details.has(id));
        return jsonResponse({ batch, missing });
      }
      return jsonResponse({ theses: currentTheses, truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-isolation-a" });

    // Owner A: apply a Coverage subject filter AND fully hydrate every content lens.
    await act(async () => { tabs(el).find((b) => b.dataset.view === "coverage")!.click(); });
    const alphaRow = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] button')).find((b) =>
      b.textContent?.includes("Alpha Co"),
    ) as HTMLButtonElement;
    await act(async () => alphaRow.click());
    expect(el.querySelector('[data-testid="rms-subject-chip"]')?.textContent).toBe("Alpha Co · Show everything");

    await act(async () => { tabs(el).find((b) => b.dataset.view === "catalysts")!.click(); });
    await flush();
    expect(el.textContent).toContain("catalyst-A");

    await act(async () => { tabs(el).find((b) => b.dataset.view === "risks")!.click(); });
    await flush();
    expect(el.textContent).toContain("risk-A");

    await act(async () => { tabs(el).find((b) => b.dataset.view === "notes")!.click(); });
    await flush();
    expect(el.textContent).toContain("note-A");

    // Swap owner WITHOUT remounting — same React root, new ownerKey prop — and switch
    // the fixture's own list to Owner B's thesis, exactly as a real account switch
    // would look from this component's point of view.
    currentTheses = [ownerBThesis];
    await act(async () => { root!.render(<ThesisWorkspace ownerKey="owner-isolation-b" />); });
    await flush();

    // The subject filter must not survive — no chip, no stale "Alpha Co" label, and no
    // filtered-empty state resolved against Owner A's stale subject key.
    expect(el.querySelector('[data-testid="rms-subject-chip"]')).toBeNull();
    expect(el.textContent).not.toContain("Alpha Co");
    expect(el.querySelector('[data-testid="rms-filtered-empty"]')).toBeNull();

    // Owner B's own content, hydrated fresh — never Owner A's stale lines — in every
    // content lens the ruling names.
    await act(async () => { tabs(el).find((b) => b.dataset.view === "catalysts")!.click(); });
    await flush();
    expect(el.textContent).toContain("catalyst-B");
    expect(el.textContent).not.toContain("catalyst-A");

    await act(async () => { tabs(el).find((b) => b.dataset.view === "risks")!.click(); });
    await flush();
    expect(el.textContent).toContain("risk-B");
    expect(el.textContent).not.toContain("risk-A");

    await act(async () => { tabs(el).find((b) => b.dataset.view === "notes")!.click(); });
    await flush();
    expect(el.textContent).toContain("note-B");
    expect(el.textContent).not.toContain("note-A");

    // The scope sentence names only Owner B's own single active thesis — never a
    // stale/combined count carried over from Owner A.
    expect(el.querySelector('[data-testid="rms-scope"]')?.textContent).toBe("Showing lines from all 1 active thesis.");
    expect(el.textContent).not.toContain("AAA");
  });

  it("a stale in-flight batch from the PREVIOUS owner can never render after an ownerKey swap, even if it resolves late (Meta-CEO B ruling r4 MAJOR, defensive membership filter)", async () => {
    const ownerAThesis: ThesisSummary = {
      id: "race-a1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const ownerBThesis: ThesisSummary = {
      id: "race-b1", currentVersion: 1, lifecycleState: "active",
      subject: subject("BBB", "Beta Co"), title: "Beta thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const detailA = detailFor(ownerAThesis, { catalysts: ["catalyst-RACE-A"] });
    const detailB = detailFor(ownerBThesis, { catalysts: ["catalyst-RACE-B"] });
    let currentTheses: ThesisSummary[] = [ownerAThesis];
    let resolveAResponse: ((value: Response) => void) | null = null;
    let idsCallCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      if (ids.length > 0) {
        idsCallCount += 1;
        if (idsCallCount === 1) {
          // Owner A's automatic batch: deliberately held open so it resolves AFTER the
          // ownerKey swap below — the exact stale-async-response race the ruling's
          // "defensively" clause exists for.
          return new Promise<Response>((resolve) => { resolveAResponse = resolve; });
        }
        const batch = ids.map((id) => (id === ownerBThesis.id ? detailB : undefined)).filter((d): d is ThesisDetail => !!d);
        return jsonResponse({ batch, missing: [] });
      }
      return jsonResponse({ theses: currentTheses, truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-race-a" });

    await act(async () => { tabs(el).find((b) => b.dataset.view === "catalysts")!.click(); });
    await flush();
    expect(idsCallCount).toBe(1);

    // Swap owner WITHOUT remounting, and WITHOUT ever resolving Owner A's request.
    currentTheses = [ownerBThesis];
    await act(async () => { root!.render(<ThesisWorkspace ownerKey="owner-race-b" />); });
    await flush();
    await act(async () => { tabs(el).find((b) => b.dataset.view === "catalysts")!.click(); });
    await flush();
    expect(el.textContent).toContain("catalyst-RACE-B");

    // NOW the stale Owner-A response lands — after the swap, and after Owner B's own
    // hydration already succeeded.
    expect(resolveAResponse).not.toBeNull();
    await act(async () => {
      resolveAResponse!(jsonResponse({ batch: [detailA], missing: [] }));
    });
    await flush();

    expect(el.textContent).not.toContain("catalyst-RACE-A");
    expect(
      Array.from(el.querySelectorAll('[data-testid="rms-line-row"]')).every((row) => !row.textContent?.includes("Alpha")),
    ).toBe(true);
    expect(el.querySelector('[data-testid="rms-scope"]')?.textContent).toBe("Showing lines from all 1 active thesis.");
  });

  it("an ownerKey swap clears `theses` synchronously — a stale response cannot render even inside the window BEFORE the new owner's own list fetch resolves (this round's review minor 5: the MAJOR fix reset hydration state but left `theses` itself, and `listState`, holding the PREVIOUS owner's values until loadList() completed)", async () => {
    const ownerAThesis: ThesisSummary = {
      id: "race2-a1", currentVersion: 1, lifecycleState: "active",
      subject: subject("CCC", "Gamma Co"), title: "Gamma thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const ownerBThesis: ThesisSummary = {
      id: "race2-b1", currentVersion: 1, lifecycleState: "active",
      subject: subject("DDD", "Delta Co"), title: "Delta thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const detailA = detailFor(ownerAThesis, { catalysts: ["catalyst-RACE2-A"] });
    const detailB = detailFor(ownerBThesis, { catalysts: ["catalyst-RACE2-B"] });
    let resolveAResponse: ((value: Response) => void) | null = null;
    let resolveBList: ((value: Response) => void) | null = null;
    let listCallCount = 0;
    let ownerAIdsRequestCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      if (ids.length > 0) {
        if (ids.includes(ownerAThesis.id)) {
          ownerAIdsRequestCount += 1;
          if (ownerAIdsRequestCount === 1) {
            // The ORIGINAL automatic batch for Owner A, triggered while Owner A was
            // still the active owner — held open so it resolves LATE, after the swap.
            return new Promise<Response>((resolve) => { resolveAResponse = resolve; });
          }
          // A SECOND request naming Owner A's id (only reachable on the unfixed code
          // path, fired by the auto-hydration effect reading a stale `theses` under
          // Owner B's own `ownerKey`) — the real API has no notion of "the caller's
          // owner" and would serve it exactly like this.
        }
        const batch = ids
          .map((id) => (id === ownerAThesis.id ? detailA : id === ownerBThesis.id ? detailB : undefined))
          .filter((d): d is ThesisDetail => !!d);
        return jsonResponse({ batch, missing: [] });
      }
      listCallCount += 1;
      if (listCallCount === 1) return jsonResponse({ theses: [ownerAThesis], truncated: false });
      // Owner B's own `loadList()` call — held open so `theses` (absent the fix) would
      // still be sitting at Owner A's rows for everything that happens before this
      // resolves.
      return new Promise<Response>((resolve) => { resolveBList = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-race2-a" });

    await act(async () => { tabs(el).find((b) => b.dataset.view === "catalysts")!.click(); });
    await flush();
    expect(ownerAIdsRequestCount).toBe(1);
    expect(resolveAResponse).not.toBeNull();

    // Swap owner WITHOUT remounting and WITHOUT resolving either Owner A's held batch
    // or Owner B's own (also held) list fetch.
    await act(async () => { root!.render(<ThesisWorkspace ownerKey="owner-race2-b" />); });
    await flush();
    expect(listCallCount).toBe(2);
    expect(resolveBList).not.toBeNull();

    // Re-select Catalysts for the new owner while its own list request is still
    // in flight — the same lens-reselection an operator does every time they open a
    // content lens on a freshly switched owner.
    await act(async () => { tabs(el).find((b) => b.dataset.view === "catalysts")!.click(); });
    await flush();
    // Fixed code: `theses` was already cleared at swap time, so `activeTheses` is
    // empty and the automatic-hydration effect never re-fires for Owner A's id under
    // Owner B's session. Unfixed code: `theses` still held Owner A's row, so this
    // click re-triggers `hydrateBatch(['race2-a1'])` — a second same-id request — and
    // renders Owner A's line immediately, before Owner B's own list has loaded at all.
    expect(el.textContent).not.toContain("catalyst-RACE2-A");

    // The ORIGINAL held batch (queued back when Owner A was still active) now lands,
    // later still — must never render either.
    await act(async () => { resolveAResponse!(jsonResponse({ batch: [detailA], missing: [] })); });
    await flush();
    expect(el.textContent).not.toContain("catalyst-RACE2-A");

    // Only now does Owner B's own list arrive — the automatic-hydration effect
    // re-fires against Owner B's real (now non-empty) `activeTheses` and Owner B's
    // genuine content renders.
    await act(async () => { resolveBList!(jsonResponse({ theses: [ownerBThesis], truncated: false })); });
    await flush();
    expect(el.textContent).toContain("catalyst-RACE2-B");
    expect(el.textContent).not.toContain("catalyst-RACE2-A");
    expect(
      Array.from(el.querySelectorAll('[data-testid="rms-line-row"]')).every((row) => !row.textContent?.includes("Gamma")),
    ).toBe(true);
  });

  it("a fault while THIS lens has zero of its OWN rows still shows the lens's own empty state, not the terminal panel, when other theses are already hydrated (Meta-CEO B ruling r4 minor 1)", async () => {
    const active = Array.from({ length: 11 }, (_, i) =>
      ({
        id: `mn1-${i}`,
        currentVersion: 1,
        lifecycleState: "active" as const,
        subject: subject("AAA", "Alpha Co"),
        title: `Thesis ${i}`,
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      }) satisfies ThesisSummary,
    );
    // None of these theses carry any risk lines — only catalysts — so the Risks lens
    // is legitimately empty for the 10 theses that DO hydrate, even though the
    // workspace as a whole has real hydrated content.
    const details = new Map(active.map((s) => [s.id, detailFor(s, { catalysts: [`cat-${s.id}`] })]));
    let batchCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      if (ids.length > 0) {
        batchCalls += 1;
        if (batchCalls === 2) return jsonResponse({ error: "thesis_store_unavailable" }, 503);
        const batch = ids.map((id) => details.get(id)).filter((d): d is ThesisDetail => !!d);
        return jsonResponse({ batch, missing: [] });
      }
      return jsonResponse({ theses: active, truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-minor1" });

    await act(async () => { tabs(el).find((b) => b.dataset.view === "risks")!.click(); });
    await flush();
    // First automatic batch succeeds (10 theses hydrated, none with a risk line) — a
    // legitimate empty state for THIS lens, never the terminal "nothing to show" panel.
    expect(el.querySelector('[data-testid="rms-hydration-unavailable"]')).toBeNull();
    expect(el.querySelector('[data-testid="rms-empty"]')?.textContent).toBe("No risks written down in the theses loaded here.");

    const showMore = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Show 1 more") as HTMLButtonElement;
    expect(showMore).toBeTruthy();
    await act(async () => { showMore.click(); });
    await flush();

    // The second batch (the last thesis) faults. Ten theses' worth of content is still
    // hydrated workspace-wide — the terminal "nothing to show" panel must NOT
    // reappear; the lens's own empty copy stays, and the smaller inline fault notice
    // appears alongside it (never `null`).
    expect(el.querySelector('[data-testid="rms-hydration-unavailable"]')).toBeNull();
    expect(el.querySelector('[data-testid="rms-empty"]')?.textContent).toBe("No risks written down in the theses loaded here.");
    const faultNotice = el.querySelector('[data-testid="rms-hydration-fault"]');
    expect(faultNotice, "expected the inline fault notice alongside the lens's own empty state").not.toBeNull();
    expect(faultNotice!.textContent).toContain("1 more could not be loaded. Try again.");
  });

  it("mobile lens rail: `data-overflow` reflects the ResizeObserver-measured scrollWidth vs clientWidth — set when it overflows, cleared when it does not (this round's review MAJOR-1/minor-1)", async () => {
    const t1: ThesisSummary = {
      id: "overflow-t1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    installFetch([t1], new Map());

    type ROCallback = (entries: unknown[], observer: unknown) => void;
    class MockResizeObserver {
      static instances: MockResizeObserver[] = [];
      callback: ROCallback;
      constructor(cb: ROCallback) {
        this.callback = cb;
        MockResizeObserver.instances.push(this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    MockResizeObserver.instances = [];
    const originalRO = (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(max-width: 600px)",
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    try {
      const el = await mount({ ownerKey: "owner-overflow" });
      const rail = el.querySelector('[data-testid="thesis-lens-rail"]') as HTMLElement;
      const list = rail.querySelector('[role="tablist"]') as HTMLElement;
      expect(MockResizeObserver.instances.length).toBe(1);
      const observer = MockResizeObserver.instances[0];

      // Not overflowing: scrollWidth <= clientWidth -> no attribute.
      Object.defineProperty(list, "scrollWidth", { value: 300, configurable: true });
      Object.defineProperty(list, "clientWidth", { value: 300, configurable: true });
      await act(async () => { observer.callback([], observer); });
      expect(rail.hasAttribute("data-overflow")).toBe(false);

      // Overflowing: scrollWidth > clientWidth -> attribute set.
      Object.defineProperty(list, "scrollWidth", { value: 900, configurable: true });
      Object.defineProperty(list, "clientWidth", { value: 300, configurable: true });
      await act(async () => { observer.callback([], observer); });
      expect(rail.hasAttribute("data-overflow")).toBe(true);

      // Back to not overflowing — the attribute is not sticky, it clears again.
      Object.defineProperty(list, "scrollWidth", { value: 300, configurable: true });
      Object.defineProperty(list, "clientWidth", { value: 300, configurable: true });
      await act(async () => { observer.callback([], observer); });
      expect(rail.hasAttribute("data-overflow")).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
      if (originalRO === undefined) delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
      else (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
    }
  });

  it("mobile lens rail: `data-overflow-left` toggles with scrollLeft — set when scrollLeft > 0, cleared at 0 (this round's review minor-1)", async () => {
    const t1: ThesisSummary = {
      id: "overflow-left-t1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    installFetch([t1], new Map());

    type ROCallback = (entries: unknown[], observer: unknown) => void;
    class MockResizeObserver {
      static instances: MockResizeObserver[] = [];
      callback: ROCallback;
      constructor(cb: ROCallback) {
        this.callback = cb;
        MockResizeObserver.instances.push(this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    MockResizeObserver.instances = [];
    const originalRO = (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(max-width: 600px)",
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    try {
      const el = await mount({ ownerKey: "owner-overflow-left" });
      const rail = el.querySelector('[data-testid="thesis-lens-rail"]') as HTMLElement;
      const list = rail.querySelector('[role="tablist"]') as HTMLElement;
      expect(MockResizeObserver.instances.length).toBe(1);
      const observer = MockResizeObserver.instances[0];

      Object.defineProperty(list, "scrollWidth", { value: 900, configurable: true });
      Object.defineProperty(list, "clientWidth", { value: 300, configurable: true });
      Object.defineProperty(list, "scrollLeft", { value: 0, configurable: true, writable: true });
      await act(async () => { observer.callback([], observer); });
      expect(rail.hasAttribute("data-overflow")).toBe(true);
      expect(rail.hasAttribute("data-overflow-left")).toBe(false);

      Object.defineProperty(list, "scrollLeft", { value: 80, configurable: true, writable: true });
      await act(async () => { observer.callback([], observer); });
      expect(rail.hasAttribute("data-overflow-left")).toBe(true);

      Object.defineProperty(list, "scrollLeft", { value: 0, configurable: true, writable: true });
      await act(async () => { observer.callback([], observer); });
      expect(rail.hasAttribute("data-overflow-left")).toBe(false);

      Object.defineProperty(list, "scrollLeft", { value: 40, configurable: true, writable: true });
      await act(async () => { list.dispatchEvent(new Event("scroll")); });
      expect(rail.hasAttribute("data-overflow-left")).toBe(true);
    } finally {
      window.matchMedia = originalMatchMedia;
      if (originalRO === undefined) delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
      else (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
    }
  });

  it("an invalidLink transition alone (same ownerKey) never resets per-owner state — the per-owner reset is keyed on ownerKey ONLY (this round's review minor 2)", async () => {
    const ownerAThesis: ThesisSummary = {
      id: "sym2-a1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    installFetch([ownerAThesis], new Map());
    const el = await mount({ ownerKey: "sym2-owner-a" });
    await flush();

    await act(async () => { tabs(el).find((b) => b.dataset.view === "coverage")!.click(); });
    const alphaRow = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] button')).find((b) =>
      b.textContent?.includes("Alpha Co"),
    ) as HTMLButtonElement;
    await act(async () => alphaRow.click());
    expect(el.querySelector('[data-testid="rms-subject-chip"]')?.textContent).toBe("Alpha Co · Show everything");

    // SAME owner, invalidLink false -> true: an independent invalidLink transition,
    // with no ownerKey change, must never wipe the per-owner state above.
    await act(async () => { root!.render(<ThesisWorkspace ownerKey="sym2-owner-a" invalidLink />); });
    await flush();
    expect(el.querySelector('[data-testid="rms-subject-chip"]')?.textContent).toBe("Alpha Co · Show everything");
  });

  it("an ownerKey change resets `theses` and `listState` together — never `theses` alone while `listState` carries the PREVIOUS owner's stale value (this round's review minor 3)", async () => {
    const ownerAThesis: ThesisSummary = {
      id: "sym3-a1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha thesis", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    let listCallCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      const ids = url.searchParams.getAll("ids");
      if (ids.length > 0) return jsonResponse({ batch: [], missing: ids });
      listCallCount += 1;
      if (listCallCount === 1) {
        // Owner A's own list fetch genuinely fails — `listState` lands on
        // "unavailable", the exact stale value the fixed reset must not leak into
        // Owner B below.
        return jsonResponse({ error: "boom" }, 500);
      }
      return jsonResponse({ theses: [ownerAThesis], truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    const el = await mount({ ownerKey: "sym3-owner-a" });
    await flush();
    expect(el.querySelector('[data-testid="rms-unavailable"]')).not.toBeNull();

    // Swap to a DIFFERENT owner under an invalid link — nothing is ever fetched for
    // Owner B (the data-loading effect returns early while `invalidLink` is true),
    // so the only thing that can move `listState` off Owner A's stale "unavailable"
    // is the per-owner reset itself.
    await act(async () => { root!.render(<ThesisWorkspace ownerKey="sym3-owner-b" invalidLink />); });
    await flush();

    expect(el.querySelector('[data-testid="rms-unavailable"]')).toBeNull();
    expect(el.querySelector('[data-testid="thesis-empty"]')).not.toBeNull();
    // No second list fetch was ever issued for Owner B — the "ready" state above
    // comes from the reset itself, not from a fetch that happened to succeed.
    expect(listCallCount).toBe(1);
  });

  it("mobile lens rail: the SELECTED lens is scrolled into view on mount and again on every lens change (this round's review MAJOR-2 — the behaviour itself, not just data-overflow)", async () => {
    const t1: ThesisSummary = {
      id: "scroll-t1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    installFetch([t1], new Map());

    // jsdom implements no scrollIntoView at all (the component guards the call with
    // `?.` for exactly that reason) — stub it on the prototype so every call, no
    // matter which button element it is invoked on, lands in one spy.
    const originalScrollIntoView = (HTMLElement.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView;
    const scrollIntoViewSpy = vi.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoViewSpy;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(max-width: 600px)",
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    try {
      const el = await mount({ ownerKey: "owner-scrollintoview" });
      const rows = tabs(el);
      const initiallySelected = rows.find((b) => b.getAttribute("aria-selected") === "true")!;

      // Mount: the initially-selected lens (the default view, "coverage" — first in
      // the list) was scrolled into view once, with the ruling's exact args.
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
      expect(scrollIntoViewSpy.mock.instances[0]).toBe(initiallySelected);
      expect(scrollIntoViewSpy.mock.calls[0][0]).toEqual({ block: "nearest", inline: "nearest" });

      // Lens change: selecting a different tab scrolls THAT tab into view too — not
      // just the first one, and not only on mount.
      scrollIntoViewSpy.mockClear();
      const catalystsTab = rows.find((b) => b.dataset.view === "catalysts")!;
      await act(async () => catalystsTab.click());

      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
      expect(scrollIntoViewSpy.mock.instances[0]).toBe(catalystsTab);
      expect(scrollIntoViewSpy.mock.calls[0][0]).toEqual({ block: "nearest", inline: "nearest" });
    } finally {
      window.matchMedia = originalMatchMedia;
      if (originalScrollIntoView === undefined) {
        delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      } else {
        (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = originalScrollIntoView;
      }
    }
  });

  it("mobile lens rail: on a wide viewport (narrowRail false) no scrollIntoView call is made — the mechanism is scoped to the narrow breakpoint only", async () => {
    const t1: ThesisSummary = {
      id: "scroll-wide-t1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    installFetch([t1], new Map());

    const originalScrollIntoView = (HTMLElement.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView;
    const scrollIntoViewSpy = vi.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoViewSpy;
    // beforeEach already installs a matchMedia stub whose `.matches` is always
    // false (wide viewport) when one is not already present.

    try {
      const el = await mount({ ownerKey: "owner-scrollintoview-wide" });
      const rows = tabs(el);
      const catalystsTab = rows.find((b) => b.dataset.view === "catalysts")!;
      await act(async () => catalystsTab.click());

      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoView === undefined) {
        delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      } else {
        (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = originalScrollIntoView;
      }
    }
  });

  it("saved-views strip: built-ins in frozen order, user views after, Team absent in v1 (R5)", async () => {
    const t1: ThesisSummary = {
      id: "sv-t1", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, "https://x.test");
      if (url.pathname === "/api/thesis-saved-views") {
        return jsonResponse({
          views: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "NVDA only",
              filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|AAA" },
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-03T00:00:00.000Z",
            },
            {
              id: "44444444-4444-4444-8444-444444444444",
              name: "Older view",
              filter: { lifecycle: "active" },
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-09-02T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.pathname === "/api/thesis-fire-status") return jsonResponse({ states: {} });
      if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
      return jsonResponse({ theses: [t1], truncated: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount({ ownerKey: "owner-saved-views" });
    await flush();

    const strip = el.querySelector('[data-testid="rms-saved-views"]');
    expect(strip, "expected the saved-views strip").not.toBeNull();
    const builtins = Array.from(strip!.querySelectorAll("[data-builtin]")).map((b) => b.getAttribute("data-builtin"));
    expect(builtins).toEqual(["mine", "stale_30", "window_closed"]);
    expect(strip!.querySelector("[data-builtin='team']")).toBeNull();
    expect(strip!.querySelector("[data-disabled], [aria-disabled='true']")).toBeNull();
    expect(strip!.textContent).not.toMatch(/not yet available|暂未开放/);

    const userViews = Array.from(strip!.querySelectorAll("[data-saved-view]")).map((b) => b.getAttribute("data-saved-view"));
    expect(userViews).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ]);
    expect(strip!.textContent).toContain("NVDA only");
    expect(strip!.textContent).toContain("Older view");
  });

  it("saved-views strip empty state is a plain sentence, never a bare count", async () => {
    const t1: ThesisSummary = {
      id: "sv-empty", currentVersion: 1, lifecycleState: "active",
      subject: subject("AAA", "Alpha Co"), title: "Alpha", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    installFetch([t1], new Map());
    const el = await mount({ ownerKey: "owner-saved-views-empty" });
    await flush();
    const empty = el.querySelector('[data-testid="rms-saved-views-empty"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe("No saved views yet. Filter the list, then save it with a name.");
    expect(empty!.textContent).not.toMatch(/^0|—$/);
  });
});

// ---------------------------------------------------------------------------
// Round-2 review of PR #546 (B-F11-4). Every test below was RED at head
// 2e0a55bd and names the finding it closes.
// ---------------------------------------------------------------------------

type WorkspaceStub = {
  theses: ThesisSummary[];
  details?: Map<string, ThesisDetail>;
  savedViews?: unknown[];
  /** What the saved-views route reports when the owner holds more rows than the cap shows. */
  savedViewsTruncated?: boolean;
  /** HTTP status the saved-views PUT answers with (400 = the route's name validation). */
  savedViewsPutStatus?: number;
  /** Round-5 review (Meta-CEO B ruling R3b): the route answers a 400 with a
   *  DISTINGUISHING `error` field — `invalid_name`, but also `invalid_filter`,
   *  `invalid_id`, `invalid_scope`, `invalid_json` and `unsupported_action`. The
   *  client used to discard it and report every one of them as a missing name. */
  savedViewsPutError?: string;
  /** Round-4 review (ruling R3): the status the DELETE action answers with, on its own
   *  knob — 404 is `saved_view_not_found` (the row is already gone), 400 is `invalid_id`.
   *  Neither is a failed read of the list, which is on screen at that moment. */
  savedViewsDeleteStatus?: number;
  fireStates?: Record<string, unknown>;
  fireStatusHttpStatus?: number;
};

/** The `updatedAt` the fixture route stamps on a rename — newer than any seed row. */
const RENAMED_AT = "2026-09-09T00:00:00.000Z";

/** Same shape as `installFetch`, plus the two new B-F11-4 read paths. */
function installWorkspaceFetch(stub: WorkspaceStub) {
  const fireCalls: string[][] = [];
  const details = stub.details ?? new Map<string, ThesisDetail>();
  const savedViewPuts: unknown[] = [];
  // Round-4 review (ruling R2): the saved-view list is STATE here, not a constant, so a
  // GET after a delete answers the way the route does — the deleted row is gone and the
  // owner is no longer over the cap. A client that never re-reads the list cannot pass.
  let views = [...((stub.savedViews ?? []) as Array<Record<string, unknown>>)];
  let truncated = stub.savedViewsTruncated === true;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://x.test");
    if (url.pathname === "/api/thesis-saved-views") {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        savedViewPuts.push(body);
        if (body.action === "delete") {
          const deleteStatus = stub.savedViewsDeleteStatus ?? 200;
          // A 404 means the row was ALREADY gone server-side — so it is gone from the
          // next read too, which is the whole point of re-reading after one.
          if (deleteStatus === 404) {
            views = views.filter((v) => v.id !== body.id);
            return jsonResponse({ error: "saved_view_not_found" }, 404);
          }
          if (deleteStatus >= 400) return jsonResponse({ error: deleteStatus === 400 ? "invalid_id" : "saved_views_unavailable" }, deleteStatus);
          views = views.filter((v) => v.id !== body.id);
          truncated = false;
          return jsonResponse({ ok: true });
        }
        // Round-5 review (Meta-CEO B ruling R3b): a rename is PERSISTED here, with the
        // fresh `updatedAt` the route stamps (savedViews.ts) — and because the read sorts
        // `updatedAt` descending, the renamed view comes back FIRST. A client that keeps
        // its own in-place copy and never re-reads cannot pass a test on the strip order.
        if (body.action === "rename") {
          const renameStatus = stub.savedViewsPutStatus ?? 200;
          if (renameStatus >= 400) return jsonResponse({ error: renameStatus === 400 ? (stub.savedViewsPutError ?? "invalid_name") : "saved_views_unavailable" }, renameStatus);
          const current = views.find((v) => v.id === body.id);
          if (!current) return jsonResponse({ error: "saved_view_not_found" }, 404);
          const renamed = { ...current, name: body.name, updatedAt: RENAMED_AT };
          views = [renamed, ...views.filter((v) => v.id !== body.id)];
          return jsonResponse({ view: renamed });
        }
        const status = stub.savedViewsPutStatus ?? 200;
        if (status >= 400) return jsonResponse({ error: status === 400 ? (stub.savedViewsPutError ?? "invalid_name") : "saved_views_unavailable" }, status);
        return jsonResponse({ view: { ...(body.view ?? {}), id: body.id ?? "new", name: body.name, filter: body.filter ?? { lifecycle: "active" }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" } });
      }
      return jsonResponse({ views, truncated });
    }
    if (url.pathname === "/api/thesis-fire-status") {
      const ids = url.searchParams.getAll("id");
      fireCalls.push(ids);
      if (stub.fireStatusHttpStatus && stub.fireStatusHttpStatus >= 400) {
        return jsonResponse({ error: "fire_status_unavailable" }, stub.fireStatusHttpStatus);
      }
      const states: Record<string, unknown> = {};
      for (const id of ids) states[id] = (stub.fireStates ?? {})[id] ?? { source: "unavailable" };
      return jsonResponse({ states });
    }
    if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
    const ids = url.searchParams.getAll("ids");
    if (ids.length > 0) {
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
    return jsonResponse({ theses: stub.theses, truncated: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, fireCalls, savedViewPuts };
}

const FRESH = new Date(Date.now() - 60_000).toISOString();

function activeThesis(id: string, key: string, title: string, updatedAt = FRESH, version = 1): ThesisSummary {
  return {
    id,
    currentVersion: version,
    lifecycleState: "active",
    subject: subject(key, `${key} Co`),
    title,
    updatedAt,
  };
}

function chip(el: HTMLElement, builtin: string): HTMLButtonElement {
  const found = el.querySelector<HTMLButtonElement>(`[data-builtin="${builtin}"]`);
  expect(found, `expected the ${builtin} chip`).not.toBeNull();
  return found!;
}

function emptyText(el: HTMLElement): string {
  const node = el.querySelector('[data-testid="rms-empty"], [data-testid="thesis-empty"], [data-testid="rms-filtered-empty"]');
  expect(node, "expected an empty-state node").not.toBeNull();
  return node!.textContent ?? "";
}

describe("ThesisWorkspace saved views — round-2 repairs (B-F11-4, PR #546)", () => {
  // BLOCKER 2: the Stale preset's zero-row state printed `builtin.staleWhat`
  // ("No changes in 30 days."), the exact inverse of the truth.
  it("Stale preset with nothing stale says everything moved, never 'No changes in 30 days.'", async () => {
    installWorkspaceFetch({ theses: [activeThesis("t-fresh", "AAA", "Alpha")] });
    const el = await mount({ ownerKey: "owner-stale-empty" });
    await flush();
    await act(async () => chip(el, "stale_30").click());
    await flush();
    const text = emptyText(el);
    expect(text).not.toContain("No changes in 30 days.");
    expect(text).not.toContain("No theses yet");
    expect(text).toMatch(/last 30 days/i);
    expect(el.querySelector('[data-testid="thesis-empty"]')).toBeNull();
  });

  // BLOCKER 3: a saved view matching zero rows fell through to
  // `RMS_COPY.empty.theses` ("No theses yet…") — false while theses exist.
  it("a saved view matching zero rows says no theses match this view, never 'No theses yet'", async () => {
    installWorkspaceFetch({
      theses: [activeThesis("t-fresh", "AAA", "Alpha")],
      savedViews: [{
        id: "55555555-5555-4555-8555-555555555555",
        name: "Stale ones",
        filter: { lifecycle: "active", staleDays: 30 },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    const el = await mount({ ownerKey: "owner-saved-empty" });
    await flush();
    const savedChip = el.querySelector<HTMLButtonElement>('[data-saved-view="55555555-5555-4555-8555-555555555555"] button')!;
    expect(savedChip).not.toBeNull();
    await act(async () => savedChip.click());
    await flush();
    const text = emptyText(el);
    expect(text).not.toContain("No theses yet");
    expect(text).toMatch(/match this view/i);
    expect(el.querySelector('[data-testid="thesis-empty"]')).toBeNull();
  });

  // BLOCKER 3 (second half): the same fall-through on the Ideas and Reviews lenses.
  it("Ideas and Reviews under a built-in preset use the preset's empty copy, not the lens's", async () => {
    installWorkspaceFetch({ theses: [activeThesis("t-fresh", "AAA", "Alpha")] });
    const el = await mount({ ownerKey: "owner-lens-empty" });
    await flush();
    await act(async () => chip(el, "stale_30").click());
    await flush();

    await act(async () => tabs(el).find((b) => b.dataset.view === "ideas")!.click());
    await flush();
    const ideas = emptyText(el);
    expect(ideas).not.toContain("Nothing new is waiting");
    expect(ideas).toMatch(/last 30 days/i);

    await act(async () => tabs(el).find((b) => b.dataset.view === "reviews")!.click());
    await flush();
    const reviews = emptyText(el);
    expect(reviews).not.toContain("Nothing is waiting for a second look");
    expect(reviews).toMatch(/last 30 days/i);
  });

  // MAJOR 2 / Grok 1: the fire-status read truncated at the first 50 ids while the
  // list carries up to 200 — theses 51+ could never enter the Window closed preset.
  it("asks for fire status for every thesis, in batches, never only the first 50", async () => {
    const many = Array.from({ length: 63 }, (_, i) =>
      activeThesis(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`, "AAA", `Alpha ${i}`));
    const { fireCalls } = installWorkspaceFetch({ theses: many });
    await mount({ ownerKey: "owner-fire-batch" });
    await flush();
    await flush();
    const requested = new Set(fireCalls.flat());
    for (const row of many) expect(requested.has(row.id), `${row.id} was never asked about`).toBe(true);
    expect(requested.size).toBe(63);
    for (const call of fireCalls) expect(call.length).toBeLessThanOrEqual(50);
  });

  // MAJOR 1: a failed fire-status read was swallowed into an empty map, so
  // "unavailable" rendered as the positive claim "nothing has a closed window".
  it("a failed fire-status read reads as not connected, never as 'nothing has a closed window'", async () => {
    installWorkspaceFetch({
      theses: [activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "AAA", "Alpha")],
      fireStatusHttpStatus: 503,
    });
    const el = await mount({ ownerKey: "owner-fire-unavailable" });
    await flush();
    await act(async () => chip(el, "window_closed").click());
    await flush();
    const text = emptyText(el);
    expect(text).not.toContain("Nothing has a closed window right now.");
    expect(text).toContain("Condition checks are not connected yet.");
  });

  // MAJOR 5: the three built-in chips were `<button role="listitem">`, so the
  // packet's primary new controls announced as list items, not as buttons.
  it("built-in chips are real buttons and never carry role=listitem", async () => {
    installWorkspaceFetch({ theses: [activeThesis("t1", "AAA", "Alpha")] });
    const el = await mount({ ownerKey: "owner-chip-roles" });
    await flush();
    const strip = el.querySelector('[data-testid="rms-saved-views"]')!;
    const builtins = Array.from(strip.querySelectorAll("[data-builtin]"));
    expect(builtins).toHaveLength(3);
    for (const node of builtins) {
      expect(node.tagName).toBe("BUTTON");
      expect(node.getAttribute("role")).toBeNull();
    }
    expect(strip.querySelector('[role="listitem"]')).toBeNull();
  });

  // Grok minor 2: the Coverage rail counted every thesis while a saved view was
  // active, so the rail disagreed with the list it sits above.
  it("Coverage rows and the rail badge follow the active saved view", async () => {
    installWorkspaceFetch({
      theses: [
        activeThesis("t-a", "AAA", "Alpha"),
        activeThesis("t-b", "BBB", "Beta"),
      ],
      savedViews: [{
        id: "66666666-6666-4666-8666-666666666666",
        name: "Only Alpha",
        filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|AAA" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    const el = await mount({ ownerKey: "owner-coverage-view" });
    await flush();
    const savedChip = el.querySelector<HTMLButtonElement>('[data-saved-view="66666666-6666-4666-8666-666666666666"] button')!;
    await act(async () => savedChip.click());
    await flush();
    const coverageTab = tabs(el).find((b) => b.dataset.view === "coverage")!;
    expect(coverageTab.textContent).toContain("1");
    await act(async () => coverageTab.click());
    await flush();
    const rows = Array.from(el.querySelectorAll('[data-testid="rms-lens-panel"] button'));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("AAA");
  });
});

// ---------------------------------------------------------------------------
// Round-3 review of PR #546 (B-F11-4), Meta-CEO B seat rulings R1-R4. Every test
// below was RED at head 39e49fd8 and names the ruling it closes.
// ---------------------------------------------------------------------------

const STALE = "2026-01-01T00:00:00.000Z";

function lensWhat(el: HTMLElement): string {
  return el.querySelector("[class*='lensWhat']")?.textContent ?? "";
}

function thesesBadge(el: HTMLElement): string {
  return tabs(el).find((b) => b.dataset.view === "theses")?.textContent ?? "";
}

function scopeText(el: HTMLElement): string {
  return el.querySelector('[data-testid="rms-scope"]')?.textContent ?? "";
}

/** React-controlled inputs ignore a plain `.value =` assignment in jsdom. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function filterToSubject(el: HTMLElement, display: string) {
  await act(async () => tabs(el).find((b) => b.dataset.view === "coverage")!.click());
  await flush();
  const row = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="rms-lens-panel"] button'))
    .find((b) => b.textContent?.includes(display));
  expect(row, `expected a Coverage row for ${display}`).toBeTruthy();
  await act(async () => row!.click());
  await flush();
}

describe("ThesisWorkspace research views — round-3 repairs (B-F11-4, PR #546)", () => {
  // R1: the lens head, the rail's filtered marker and the scope sentence all follow
  // the ACTIVE VIEW. Under a preset the head used to print "Everything you have
  // written." over a filtered slice, the badges showed filtered numbers unmarked,
  // and the scope sentence claimed "all {total} active theses" of the workspace.
  it("R1 preset-only: the head names the view, the badges are marked filtered, and the scope sentence counts the view", async () => {
    installWorkspaceFetch({
      theses: [
        activeThesis("r3-stale-1", "AAA", "Alpha old", STALE),
        activeThesis("r3-stale-2", "BBB", "Beta old", STALE),
        activeThesis("r3-fresh-1", "CCC", "Gamma new"),
      ],
    });
    const el = await mount({ ownerKey: "owner-r3-preset-only" });
    await flush();
    expect(lensWhat(el)).toBe("Everything you have written.");

    await act(async () => chip(el, "stale_30").click());
    await flush();

    expect(lensWhat(el)).toBe("Only what matches the “Stale” view.");
    expect(lensWhat(el)).not.toBe("Everything you have written.");
    expect(thesesBadge(el)).toContain("(filtered)");
    expect(tabs(el).find((b) => b.dataset.view === "coverage")!.textContent).toContain("(filtered)");

    await act(async () => tabs(el).find((b) => b.dataset.view === "catalysts")!.click());
    await flush();
    expect(scopeText(el)).toBe("Showing lines from all 2 active theses in this view.");
    expect(scopeText(el)).not.toContain("all 3");
    expect(lensWhat(el)).toBe("Only what matches the “Stale” view.");
  });

  // R1: the already-correct subject-only path must keep behaving, and the marker
  // must stay on the Theses badge alone (a subject filter narrows no other lens).
  it("R1 subject-only: the head names the subject and only the Theses badge is marked filtered", async () => {
    installWorkspaceFetch({
      theses: [
        activeThesis("r3-sub-a", "AAA", "Alpha one"),
        activeThesis("r3-sub-b", "BBB", "Beta one"),
      ],
    });
    const el = await mount({ ownerKey: "owner-r3-subject-only" });
    await flush();
    await filterToSubject(el, "AAA Co");

    expect(lensWhat(el)).toBe("Only what you have written about AAA Co.");
    expect(thesesBadge(el)).toContain("(filtered)");
    expect(tabs(el).find((b) => b.dataset.view === "coverage")!.textContent).not.toContain("(filtered)");
  });

  // R1: both filters at once — the head names both, and neither is dropped.
  it("R1 preset + subject: the head names the view and the subject together", async () => {
    installWorkspaceFetch({
      theses: [
        activeThesis("r3-both-a", "AAA", "Alpha one"),
        activeThesis("r3-both-b", "BBB", "Beta one"),
      ],
    });
    const el = await mount({ ownerKey: "owner-r3-both" });
    await flush();
    await filterToSubject(el, "AAA Co");
    await act(async () => chip(el, "mine").click());
    await flush();

    // Round-4 review (ruling R7): the chip is labelled for the lifecycle it filters.
    expect(lensWhat(el)).toBe("Only what matches the “Your active theses” view, and only about AAA Co.");
    expect(lensWhat(el)).not.toBe("Everything you have written.");
    expect(el.querySelector('[data-testid="rms-subject-chip"]')).not.toBeNull();
    expect(thesesBadge(el)).toContain("(filtered)");
  });

  // R2: one precedence. A preset that empties the list names ITSELF, even when a
  // subject filter is also on — and the frozen condition.unavailable fallback that
  // spec 2.8 requires for a failed fire-status read is no longer swallowed.
  it("R2 preset + subject + failed fire-status read: the preset's unavailable sentence wins over the subject sentence", async () => {
    installWorkspaceFetch({
      theses: [
        activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000101", "AAA", "Alpha one"),
        activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000102", "BBB", "Beta one"),
      ],
      fireStatusHttpStatus: 503,
    });
    const el = await mount({ ownerKey: "owner-r3-r2-unavailable" });
    await flush();
    await filterToSubject(el, "AAA Co");
    await act(async () => chip(el, "window_closed").click());
    await flush();

    const text = emptyText(el);
    expect(text).toContain("Condition checks are not connected yet.");
    expect(text).not.toContain("Clear the filter to see every thesis.");
    expect(text).not.toContain("Nothing has a closed window right now.");
    // Round-5 review (ruling R2): the combined view-and-subject sentence promises a
    // remainder of the view. A failed fire-status read knows of no such remainder, so
    // spec 2.8's fallback still wins here — see `viewAndSubjectEmptyCopy`.
    expect(text).not.toContain("Clear the subject filter to see the rest of the view.");
  });

  it("R2 preset + subject + a fresh subject: the Stale preset's own empty sentence wins over the subject sentence", async () => {
    installWorkspaceFetch({
      theses: [
        activeThesis("r3-r2-fresh-a", "AAA", "Alpha one"),
        activeThesis("r3-r2-fresh-b", "BBB", "Beta one"),
      ],
    });
    const el = await mount({ ownerKey: "owner-r3-r2-fresh" });
    await flush();
    await filterToSubject(el, "AAA Co");
    await act(async () => chip(el, "stale_30").click());
    await flush();

    const text = emptyText(el);
    expect(text).toMatch(/last 30 days/i);
    expect(text).not.toContain("Clear the filter to see every thesis.");
    expect(text).not.toContain("No theses yet");
    // Round-5 review (ruling R2): nothing here is stale for ANY subject, so the view —
    // not the subject filter — is what emptied the lens, and there is no "rest of the
    // view" to promise. The preset's own sentence is the true one.
    expect(text).not.toContain("Clear the subject filter to see the rest of the view.");
  });

  // R3: "Nothing has a closed window right now." may render only when the read
  // succeeded AND covered every requested id. A 200 whose every state is
  // `unavailable` is the production reality until macro #6918's job runs, and it
  // is treated exactly like transport failure.
  it("R3 a 200 fire-status answer that knows nothing reads as not connected, never as 'nothing has a closed window'", async () => {
    installWorkspaceFetch({
      theses: [activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000201", "AAA", "Alpha one")],
    });
    const el = await mount({ ownerKey: "owner-r3-unknown-200" });
    await flush();
    await act(async () => chip(el, "window_closed").click());
    await flush();

    const text = emptyText(el);
    expect(text).toContain("Condition checks are not connected yet.");
    expect(text).not.toContain("Nothing has a closed window right now.");
  });

  // Round-4 review (ruling R5): the {source:"monitor", state:"open"} fixture below is a
  // FUTURE-ROUTE shape. The shipped GET /api/thesis-fire-status + mapOutboxToConditionStates()
  // can only answer {source:"monitor", state:"window_closed"} or {source:"unavailable"},
  // so today this coverage-gate branch is exercised only by this fixture. The test is kept
  // as the green guard on the gate itself (it must not treat a covered read as a fault).
  it("R3 a 200 fire-status answer that covers every thesis with a real monitor read may say nothing has a closed window (fixture uses a future-route monitor/open shape)", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-000000000202";
    installWorkspaceFetch({
      theses: [activeThesis(id, "AAA", "Alpha one")],
      fireStates: { [id]: { source: "monitor", state: "open", at: "2026-09-05T00:00:00.000Z" } },
    });
    const el = await mount({ ownerKey: "owner-r3-known-200" });
    await flush();
    await act(async () => chip(el, "window_closed").click());
    await flush();

    expect(emptyText(el)).toContain("Nothing has a closed window right now.");
  });

  it("R3 partial coverage — one thesis answered, one not — is treated as not connected", async () => {
    const known = "aaaaaaaa-aaaa-4aaa-8aaa-000000000203";
    const unknown = "aaaaaaaa-aaaa-4aaa-8aaa-000000000204";
    installWorkspaceFetch({
      theses: [activeThesis(known, "AAA", "Alpha one"), activeThesis(unknown, "BBB", "Beta one")],
      fireStates: { [known]: { source: "monitor", state: "open", at: "2026-09-05T00:00:00.000Z" } },
    });
    const el = await mount({ ownerKey: "owner-r3-partial-200" });
    await flush();
    await act(async () => chip(el, "window_closed").click());
    await flush();

    const text = emptyText(el);
    expect(text).toContain("Condition checks are not connected yet.");
    expect(text).not.toContain("Nothing has a closed window right now.");
  });

  // R4: the rename form carried no trim guard, so a blank name reached the route and
  // came back as "Your saved views did not load." — which they had.
  it("R4 rename: a blank name cannot be submitted, and a rejected name says what is wrong", async () => {
    const viewId = "99999999-9999-4999-8999-999999999999";
    installWorkspaceFetch({
      theses: [activeThesis("r3-rename-a", "AAA", "Alpha one")],
      savedViews: [{
        id: viewId,
        name: "Only Alpha",
        filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|AAA" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
      savedViewsPutStatus: 400,
    });
    const el = await mount({ ownerKey: "owner-r3-rename" });
    await flush();
    const item = el.querySelector(`[data-saved-view="${viewId}"]`)!;
    const renameButton = Array.from(item.querySelectorAll("button")).find((b) => b.textContent === "Rename")!;
    await act(async () => renameButton.click());
    await flush();

    const input = el.querySelector<HTMLInputElement>(`[data-saved-view="${viewId}"] input`)!;
    await act(async () => typeInto(input, "   "));
    await flush();
    const submit = el.querySelector<HTMLButtonElement>(`[data-saved-view="${viewId}"] button[type="submit"]`)!;
    expect(submit.disabled).toBe(true);

    // A name the client cannot pre-check (the route's own rule) still must not be
    // reported as a broken saved-views read.
    await act(async () => typeInto(input, "A new name"));
    await flush();
    expect(submit.disabled).toBe(false);
    await act(async () => { submit.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();

    const strip = el.querySelector('[data-testid="rms-saved-views"]')!;
    expect(strip.textContent).toContain("Give this view a name before you save it.");
    expect(strip.textContent).not.toContain("Your saved views did not load.");
  });

  // R4: more than 50 saved views is not the same statement as "you have reached 50".
  it("R4 a truncated saved-view set says the extra views are hidden, never the limit sentence", async () => {
    installWorkspaceFetch({
      theses: [activeThesis("r3-trunc-a", "AAA", "Alpha one")],
      savedViews: Array.from({ length: 50 }, (_, i) => ({
        id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
        name: `View ${i}`,
        filter: { lifecycle: "active", staleDays: 30 },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: `2026-09-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      })),
      savedViewsTruncated: true,
    });
    const el = await mount({ ownerKey: "owner-r3-truncated" });
    await flush();
    const strip = el.querySelector('[data-testid="rms-saved-views"]')!;
    expect(strip.textContent).toContain("You have more than 50 saved views.");
    expect(strip.textContent).not.toContain("You have reached the limit of 50 saved views.");
  });

  // R4: builtin.staleWhat rendered only as a `title` attribute — unreachable on
  // touch, which is exactly the 390 crop viewport.
  it("R4 the Stale preset explains itself in visible text, not only in a tooltip", async () => {
    installWorkspaceFetch({ theses: [activeThesis("r3-stale-what", "AAA", "Alpha one", STALE)] });
    const el = await mount({ ownerKey: "owner-r3-stale-what" });
    await flush();
    expect(el.querySelector('[data-testid="rms-builtin-what"]')).toBeNull();
    await act(async () => chip(el, "stale_30").click());
    await flush();
    const note = el.querySelector('[data-testid="rms-builtin-what"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe("No changes in 30 days.");
  });

  // R4 (hygiene): the owner-change reset clears every other per-owner flag; a stale
  // fire-status fault must not survive the swap either.
  it("R4 an owner change clears the preset and its fire-status fault together", async () => {
    installWorkspaceFetch({
      theses: [activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000301", "AAA", "Alpha one")],
      fireStatusHttpStatus: 503,
    });
    const el = await mount({ ownerKey: "owner-r3-reset-a" });
    await flush();
    await act(async () => chip(el, "window_closed").click());
    await flush();
    expect(emptyText(el)).toContain("Condition checks are not connected yet.");

    installWorkspaceFetch({
      theses: [activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000302", "BBB", "Beta one")],
    });
    await act(async () => { root!.render(<ThesisWorkspace ownerKey="owner-r3-reset-b" />); });
    await flush();

    expect(el.querySelector('[data-builtin="window_closed"]')!.getAttribute("data-selected")).toBeNull();
    expect(el.textContent).not.toContain("Condition checks are not connected yet.");
  });
});

// ---------------------------------------------------------------------------
// Round-4 review of PR #546 (B-F11-4), Meta-CEO B seat rulings R1-R3. Every test
// below was RED at head 5ecf748f and names the ruling it closes.
// ---------------------------------------------------------------------------

function savedViewsStrip(el: HTMLElement): string {
  return el.querySelector('[data-testid="rms-saved-views"]')?.textContent ?? "";
}

function deleteButton(el: HTMLElement, viewId: string): HTMLButtonElement {
  const item = el.querySelector(`[data-saved-view="${viewId}"]`);
  expect(item, `expected the saved-view row ${viewId}`).not.toBeNull();
  const found = Array.from(item!.querySelectorAll("button")).find((b) => b.textContent === "Delete this view");
  expect(found, `expected a Delete control on ${viewId}`).toBeTruthy();
  return found as HTMLButtonElement;
}

describe("ThesisWorkspace research views — round-4 repairs (B-F11-4, PR #546)", () => {
  // R1 (MAJOR): the Coverage lens's zero-row branch never consulted `presetEmptyCopy`,
  // so a preset or a saved view that emptied the view printed the workspace-wide
  // "Nothing is covered yet. Write a thesis and its subject appears here." at a user
  // who owns theses — and instructed them to write one. The Window-closed preset over
  // an all-unavailable fire-status read is the production path today.
  it("R1 Coverage under the Window-closed preset names the preset, never 'write a thesis'", async () => {
    installWorkspaceFetch({
      theses: [
        activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000401", "AAA", "Alpha one"),
        activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000402", "BBB", "Beta one"),
      ],
    });
    const el = await mount({ ownerKey: "owner-r4-coverage-window-closed" });
    await flush();
    await act(async () => chip(el, "window_closed").click());
    await flush();
    await act(async () => tabs(el).find((b) => b.dataset.view === "coverage")!.click());
    await flush();

    const text = emptyText(el);
    expect(text).toContain("Condition checks are not connected yet.");
    expect(text).not.toContain("Nothing is covered yet.");
    expect(text).not.toContain("Write a thesis");
  });

  // R1: the same fall-through under a SAVED view that matches nothing.
  it("R1 Coverage under a saved view that matches nothing says the view is empty", async () => {
    const viewId = "77777777-7777-4777-8777-777777777777";
    installWorkspaceFetch({
      theses: [activeThesis("r4-cov-a", "AAA", "Alpha one")],
      savedViews: [{
        id: viewId,
        name: "Nothing matches",
        filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|ZZZ" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    const el = await mount({ ownerKey: "owner-r4-coverage-saved-view" });
    await flush();
    const savedChip = el.querySelector<HTMLButtonElement>(`[data-saved-view="${viewId}"] button`)!;
    await act(async () => savedChip.click());
    await flush();
    await act(async () => tabs(el).find((b) => b.dataset.view === "coverage")!.click());
    await flush();

    const text = emptyText(el);
    expect(text).toBe("No theses match this view.");
    expect(text).not.toContain("Nothing is covered yet.");
  });

  // R1 (green guard): with no view narrowing anything, the workspace-wide Coverage
  // sentence is the true one and must stay.
  it("R1 Coverage with no preset and no theses still says nothing is covered yet", async () => {
    installWorkspaceFetch({ theses: [] });
    const el = await mount({ ownerKey: "owner-r4-coverage-unfiltered" });
    await flush();
    await act(async () => tabs(el).find((b) => b.dataset.view === "coverage")!.click());
    await flush();
    expect(emptyText(el)).toContain("Nothing is covered yet.");
  });

  // R2: `deleteView` cleared `savedViewsLimit` but never `savedViewsTruncated`, and
  // re-read nothing — so a user holding more than the cap who deleted rows kept the
  // truncation sentence and a disabled Save control until a page reload.
  it("R2 deleting a saved view clears the truncation sentence and re-enables Save, with no reload", async () => {
    const views = Array.from({ length: 50 }, (_, i) => ({
      id: `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`,
      name: `View ${i}`,
      filter: { lifecycle: "active", staleDays: 30 },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: `2026-09-01T00:00:${String(i).padStart(2, "0")}.000Z`,
    }));
    installWorkspaceFetch({
      theses: [activeThesis("r4-del-a", "AAA", "Alpha one", STALE)],
      savedViews: views,
      savedViewsTruncated: true,
    });
    vi.stubGlobal("confirm", () => true);
    const el = await mount({ ownerKey: "owner-r4-delete-truncated" });
    await flush();
    await act(async () => chip(el, "stale_30").click());
    await flush();

    expect(savedViewsStrip(el)).toContain("You have more than 50 saved views.");
    expect(el.querySelector<HTMLButtonElement>('[data-testid="rms-save-view"]')!.disabled).toBe(true);

    await act(async () => deleteButton(el, views[0].id).click());
    await flush();

    expect(savedViewsStrip(el)).not.toContain("You have more than 50 saved views.");
    expect(el.querySelector(`[data-saved-view="${views[0].id}"]`)).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="rms-save-view"]')!.disabled).toBe(false);
  });

  // R3: every non-ok delete response collapsed into "Your saved views did not load."
  // — reported over views that were on screen at that moment, and the phantom row
  // stayed under that sentence.
  it("R3 deleting a view that is already gone says so and re-reads the list, never 'did not load'", async () => {
    const viewId = "88888888-8888-4888-8888-888888888888";
    installWorkspaceFetch({
      theses: [activeThesis("r4-gone-a", "AAA", "Alpha one")],
      savedViews: [{
        id: viewId,
        name: "Deleted elsewhere",
        filter: { lifecycle: "active", staleDays: 30 },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
      savedViewsDeleteStatus: 404,
    });
    vi.stubGlobal("confirm", () => true);
    const el = await mount({ ownerKey: "owner-r4-delete-404" });
    await flush();

    await act(async () => deleteButton(el, viewId).click());
    await flush();

    const strip = savedViewsStrip(el);
    expect(strip).toContain("That view was already removed.");
    expect(strip).not.toContain("Your saved views did not load.");
    // The stale row does not survive under the sentence that explains it.
    expect(el.querySelector(`[data-saved-view="${viewId}"]`)).toBeNull();
  });

  // R3: a 400 on delete is `invalid_id` — a reference problem, not a failed read of a
  // list that is on screen (and not a NAME problem: delete carries no name).
  it("R3 a 400 from delete is not reported as a failed saved-views read", async () => {
    const viewId = "88888888-8888-4888-8888-888888888889";
    installWorkspaceFetch({
      theses: [activeThesis("r4-bad-a", "AAA", "Alpha one")],
      savedViews: [{
        id: viewId,
        name: "Bad reference",
        filter: { lifecycle: "active", staleDays: 30 },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
      savedViewsDeleteStatus: 400,
    });
    vi.stubGlobal("confirm", () => true);
    const el = await mount({ ownerKey: "owner-r4-delete-400" });
    await flush();

    await act(async () => deleteButton(el, viewId).click());
    await flush();

    const strip = savedViewsStrip(el);
    expect(strip).not.toContain("Your saved views did not load.");
    expect(strip).toContain("That view was already removed.");
  });

  // R3 (green guard): a real transport failure on delete still reports a failed read.
  it("R3 a 503 from delete still reports the saved views as unavailable", async () => {
    const viewId = "88888888-8888-4888-8888-888888888890";
    installWorkspaceFetch({
      theses: [activeThesis("r4-503-a", "AAA", "Alpha one")],
      savedViews: [{
        id: viewId,
        name: "Store is down",
        filter: { lifecycle: "active", staleDays: 30 },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
      savedViewsDeleteStatus: 503,
    });
    vi.stubGlobal("confirm", () => true);
    const el = await mount({ ownerKey: "owner-r4-delete-503" });
    await flush();

    await act(async () => deleteButton(el, viewId).click());
    await flush();

    const strip = savedViewsStrip(el);
    expect(strip).toContain("Your saved views did not load.");
    expect(strip).not.toContain("That view was already removed.");
  });

  // R7: the chip's rendered label is the one the head sentence quotes.
  it("R7 the first built-in chip is labelled for the lifecycle it filters", async () => {
    installWorkspaceFetch({ theses: [activeThesis("r4-mine-a", "AAA", "Alpha one")] });
    const el = await mount({ ownerKey: "owner-r4-mine-label" });
    await flush();
    expect(chip(el, "mine").textContent).toBe("Your active theses");
    await act(async () => chip(el, "mine").click());
    await flush();
    expect(lensWhat(el)).toBe("Only what matches the “Your active theses” view.");
  });
});

// ---------------------------------------------------------------------------
// Round-5 review of PR #546 (B-F11-4), Meta-CEO B seat rulings R1, R2 and R3b/R3c.
// Every test below was RED at head 0d648864 and names the ruling it closes.
// ---------------------------------------------------------------------------

function savedViewOrder(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("[data-saved-view]")).map((n) => n.getAttribute("data-saved-view") ?? "");
}

describe("ThesisWorkspace research views — round-5 repairs (B-F11-4, PR #546)", () => {
  // R1 (MAJOR 1): the catalysts/risks/notes branch never consulted `presetEmptyCopy`,
  // so a preset or a saved view that emptied the slice printed the lens's own
  // workspace-wide sentence. For Revision notes that sentence carries no "in the
  // theses loaded here" scoping clause (Catalysts and Risks do), so it told a user who
  // HAS revision notes that they have none, and instructed them to write one.
  it("R1 Revision notes under the Window-closed preset names the view, never 'No revision notes yet'", async () => {
    const alpha = activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000501", "AAA", "Alpha one");
    const beta = activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000502", "BBB", "Beta one");
    installWorkspaceFetch({
      theses: [alpha, beta],
      details: new Map([
        [alpha.id, detailFor(alpha, { revisionNote: "Widened the horizon after the print." })],
        [beta.id, detailFor(beta, { revisionNote: "Cut the size after the guidance." })],
      ]),
    });
    const el = await mount({ ownerKey: "owner-r5-notes-window-closed" });
    await flush();
    await act(async () => tabs(el).find((b) => b.dataset.view === "notes")!.click());
    await flush();
    // The premise: this owner demonstrably has revision notes on screen.
    expect(el.querySelectorAll('[data-testid="rms-line-row"]').length).toBe(2);

    // Every fire-status read answers `unavailable`, so the Window-closed view matches
    // nothing — the production path the body discloses.
    await act(async () => chip(el, "window_closed").click());
    await flush();

    const text = emptyText(el);
    expect(text).toContain("Condition checks are not connected yet.");
    expect(text).not.toContain("No revision notes yet.");
    expect(text).not.toContain("They appear when you save a change and say why.");
  });

  // R1: the same branch under a SAVED view, on the Catalysts lens.
  it("R1 Catalysts under a saved view that matches nothing says the view is empty", async () => {
    const viewId = "aaaaaaaa-1111-4111-8111-111111111111";
    const alpha = activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000503", "AAA", "Alpha one");
    installWorkspaceFetch({
      theses: [alpha],
      details: new Map([[alpha.id, detailFor(alpha, { catalysts: ["The print lands in March."] })]]),
      savedViews: [{
        id: viewId,
        name: "Nothing matches",
        filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|ZZZ" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    const el = await mount({ ownerKey: "owner-r5-catalysts-saved-view" });
    await flush();
    await act(async () => tabs(el).find((b) => b.dataset.view === "catalysts")!.click());
    await flush();
    expect(el.querySelectorAll('[data-testid="rms-line-row"]').length).toBe(1);

    await act(async () => el.querySelector<HTMLButtonElement>(`[data-saved-view="${viewId}"] button`)!.click());
    await flush();

    const text = emptyText(el);
    expect(text).toBe("No theses match this view.");
    expect(text).not.toContain("No catalysts yet.");
  });

  // R1 (green guard): with nothing narrowing the lens, its own sentence is the true
  // one and still renders.
  it("R1 with no view active the Revision notes lens keeps its own sentence", async () => {
    const alpha = activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000504", "AAA", "Alpha one");
    installWorkspaceFetch({ theses: [alpha], details: new Map([[alpha.id, detailFor(alpha)]]) });
    const el = await mount({ ownerKey: "owner-r5-notes-unfiltered" });
    await flush();
    await act(async () => tabs(el).find((b) => b.dataset.view === "notes")!.click());
    await flush();
    expect(emptyText(el)).toContain("No revision notes yet.");
  });

  // R2 (MAJOR 2): a subject filter and a view narrow the Theses lens at the same time,
  // and the preset-first branch printed the CATEGORICAL "No theses match this view."
  // over a slice the SUBJECT emptied — false while another subject in that same view
  // demonstrably has theses. Two clicks, no macro dependency.
  it("R2 a saved view plus a subject filter names both, never the categorical view sentence", async () => {
    const viewId = "aaaaaaaa-2222-4222-8222-222222222222";
    installWorkspaceFetch({
      theses: [
        activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000511", "AAPL", "Apple one", STALE),
        activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000512", "NVDA", "Nvidia one"),
      ],
      savedViews: [{
        id: viewId,
        name: "Only Apple",
        filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|AAPL" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    const el = await mount({ ownerKey: "owner-r5-view-and-subject" });
    await flush();
    // Click 1: the NVDA Coverage row sets the subject filter and switches to Theses.
    await filterToSubject(el, "NVDA Co");
    // Click 2: a saved view that excludes NVDA.
    await act(async () => el.querySelector<HTMLButtonElement>(`[data-saved-view="${viewId}"] button`)!.click());
    await flush();

    // The head sentence names both narrowings; the empty sentence uses the SAME
    // subject display it does.
    expect(lensWhat(el)).toBe("Only what matches the \u201cOnly Apple\u201d view, and only about NVDA Co.");
    const text = emptyText(el);
    expect(text).toBe("Nothing matches this view for NVDA Co. Clear the subject filter to see the rest of the view.");
    // The categorical negative is flatly false here: Apple matches this view.
    expect(text).not.toContain("No theses match this view.");
  });

  // R2: the same combined state under a BUILT-IN preset never borrows the preset's own
  // categorical sentence either.
  it("R2 a built-in preset plus a subject filter names both, never the preset's own empty sentence", async () => {
    installWorkspaceFetch({
      theses: [
        activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000513", "AAPL", "Apple one", STALE),
        activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000514", "NVDA", "Nvidia one"),
      ],
    });
    const el = await mount({ ownerKey: "owner-r5-preset-and-subject" });
    await flush();
    await filterToSubject(el, "NVDA Co");
    await act(async () => chip(el, "stale_30").click());
    await flush();

    const text = emptyText(el);
    expect(text).toBe("Nothing matches this view for NVDA Co. Clear the subject filter to see the rest of the view.");
    expect(text).not.toContain("Everything here changed in the last 30 days.");
    expect(text).not.toContain("No changes in 30 days.");
  });

  // R2 (green guard): with NO subject filter the view's own sentence is the true one
  // and is unchanged.
  it("R2 a saved view that matches nothing, with no subject filter, keeps the view sentence", async () => {
    const viewId = "aaaaaaaa-3333-4333-8333-333333333333";
    installWorkspaceFetch({
      theses: [activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000515", "AAPL", "Apple one")],
      savedViews: [{
        id: viewId,
        name: "Nothing matches",
        filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|ZZZ" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    const el = await mount({ ownerKey: "owner-r5-view-no-subject" });
    await flush();
    await act(async () => el.querySelector<HTMLButtonElement>(`[data-saved-view="${viewId}"] button`)!.click());
    await flush();

    const text = emptyText(el);
    expect(text).toBe("No theses match this view.");
    expect(text).not.toContain("Clear the subject filter");
  });

  // R3b: `renameView` updated the list in place while the route stamps a fresh
  // `updatedAt` and the read sorts `updatedAt` descending, so the renamed chip stayed
  // in its old slot — outside the order spec 2.6 froze — until a page reload.
  it("R3b a rename re-reads the list, so the strip keeps the newest-first order", async () => {
    const mk = (n: number, name: string, updatedAt: string) => ({
      id: `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`,
      name,
      filter: { lifecycle: "active", staleDays: 30 },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt,
    });
    const newest = mk(1, "Newest", "2026-09-03T00:00:00.000Z");
    const middle = mk(2, "Middle", "2026-09-02T00:00:00.000Z");
    const oldest = mk(3, "Oldest", "2026-09-01T00:00:00.000Z");
    installWorkspaceFetch({
      theses: [activeThesis("r5-rename-a", "AAA", "Alpha one")],
      savedViews: [newest, middle, oldest],
    });
    const el = await mount({ ownerKey: "owner-r5-rename-order" });
    await flush();
    expect(savedViewOrder(el)).toEqual([newest.id, middle.id, oldest.id]);

    const item = el.querySelector(`[data-saved-view="${oldest.id}"]`)!;
    await act(async () => Array.from(item.querySelectorAll("button")).find((b) => b.textContent === "Rename")!.click());
    await flush();
    const input = el.querySelector<HTMLInputElement>(`[data-saved-view="${oldest.id}"] input`)!;
    await act(async () => typeInto(input, "Renamed just now"));
    await flush();
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-saved-view="${oldest.id}"] button[type="submit"]`)!
        .closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(savedViewsStrip(el)).toContain("Renamed just now");
    expect(savedViewOrder(el)).toEqual([oldest.id, newest.id, middle.id]);
  });

  // R3c: "That view was already removed." had no clearer other than another delete or
  // an owner swap, so it kept rendering beside unrelated later work.
  it("R3c a rename after an already-removed delete clears the already-removed notice", async () => {
    const goneId = "77777777-1111-4111-8111-111111111111";
    const keptId = "77777777-2222-4222-8222-222222222222";
    installWorkspaceFetch({
      theses: [activeThesis("r5-gone-a", "AAA", "Alpha one")],
      savedViews: [
        { id: goneId, name: "Deleted elsewhere", filter: { lifecycle: "active", staleDays: 30 }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" },
        { id: keptId, name: "Still here", filter: { lifecycle: "active", staleDays: 30 }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
      savedViewsDeleteStatus: 404,
    });
    vi.stubGlobal("confirm", () => true);
    const el = await mount({ ownerKey: "owner-r5-gone-then-rename" });
    await flush();

    await act(async () => deleteButton(el, goneId).click());
    await flush();
    expect(savedViewsStrip(el)).toContain("That view was already removed.");

    const item = el.querySelector(`[data-saved-view="${keptId}"]`)!;
    await act(async () => Array.from(item.querySelectorAll("button")).find((b) => b.textContent === "Rename")!.click());
    await flush();
    const input = el.querySelector<HTMLInputElement>(`[data-saved-view="${keptId}"] input`)!;
    await act(async () => typeInto(input, "Renamed after the delete"));
    await flush();
    await act(async () => {
      el.querySelector<HTMLButtonElement>(`[data-saved-view="${keptId}"] button[type="submit"]`)!
        .closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    const strip = savedViewsStrip(el);
    expect(strip).toContain("Renamed after the delete");
    expect(strip).not.toContain("That view was already removed.");
  });
});

/** Stale enough for the 30-day built-in view, fresh enough that `reviewRows`' own
 *  90-day threshold does NOT claim it — the gap the round-6 R1 tests live in. */
const STALE_40 = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

describe("ThesisWorkspace research views — round-6 repairs (B-F11-4, PR #546)", () => {
  // R1 (BLOCKER): the round-5 repair wired the preset/view empty sentence to "a preset
  // is active", never to "the view emptied this lens". Five of the seven lenses apply a
  // SECOND predicate of their own on top of the view, so a view that MATCHED theses
  // which simply carry no rows of that kind printed the view's categorical negative.
  // These three tests are the discriminating case the round-5 tests never exercised:
  // in every one of them the view demonstrably matches theses.
  it("R1 Ideas under a Stale view that MATCHED theses keeps the lens's own sentence", async () => {
    const rows = [
      activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000601", "AAA", "Alpha two", STALE_40, 2),
      activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000602", "BBB", "Beta two", STALE_40, 2),
      activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000603", "CCC", "Gamma two", STALE_40, 2),
    ];
    installWorkspaceFetch({ theses: rows });
    const el = await mount({ ownerKey: "owner-r6-ideas-stale" });
    await flush();

    await act(async () => chip(el, "stale_30").click());
    await flush();
    // The premise: the Stale view is displaying all three theses one click away.
    expect(el.querySelectorAll('[data-testid="rms-lens-panel"] [class*="thesisList"] button').length).toBe(3);

    await act(async () => tabs(el).find((b) => b.dataset.view === "ideas")!.click());
    await flush();
    const text = emptyText(el);
    // `ideaRows` keeps only version-1 actives, so the LENS emptied this slice, not the
    // view — the view's own sentence would be the exact inverse of what is on screen.
    expect(text).toContain("Nothing new is waiting.");
    expect(text).not.toContain("Nothing is stale.");
    expect(text).not.toContain("last 30 days");
  });

  it("R1 Reviews under a Stale view that MATCHED theses keeps the lens's own sentence", async () => {
    const rows = [
      activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000604", "AAA", "Alpha two", STALE_40, 2),
      activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000605", "BBB", "Beta two", STALE_40, 2),
    ];
    installWorkspaceFetch({ theses: rows });
    const el = await mount({ ownerKey: "owner-r6-reviews-stale" });
    await flush();

    await act(async () => chip(el, "stale_30").click());
    await flush();
    expect(el.querySelectorAll('[data-testid="rms-lens-panel"] [class*="thesisList"] button').length).toBe(2);

    await act(async () => tabs(el).find((b) => b.dataset.view === "reviews")!.click());
    await flush();
    const text = emptyText(el);
    // 40 days is past the view's 30-day rule and short of `RMS_REVIEW_STALE_DAYS` (90),
    // so the Reviews lens is empty while the view holds two theses.
    expect(text).toContain("Nothing is waiting for a second look.");
    expect(text).not.toContain("Nothing is stale.");
    expect(text).not.toContain("last 30 days");
  });

  it("R1 Catalysts under a saved view that MATCHED theses keeps the lens's own scoped sentence", async () => {
    const viewId = "aaaaaaaa-6666-4666-8666-666666666601";
    const aapl = activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000606", "AAPL", "Apple thesis");
    const nvda = activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000607", "NVDA", "Nvidia thesis");
    installWorkspaceFetch({
      theses: [aapl, nvda],
      details: new Map([
        [aapl.id, detailFor(aapl, { catalysts: ["The print lands in March."] })],
        [nvda.id, detailFor(nvda)],
      ]),
      savedViews: [{
        id: viewId,
        name: "NVDA only",
        filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|NVDA" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    const el = await mount({ ownerKey: "owner-r6-catalysts-saved-view" });
    await flush();
    await act(async () => tabs(el).find((b) => b.dataset.view === "catalysts")!.click());
    await flush();
    expect(el.querySelectorAll('[data-testid="rms-line-row"]').length).toBe(1);

    await act(async () => el.querySelector<HTMLButtonElement>(`[data-saved-view="${viewId}"] button`)!.click());
    await flush();

    const text = emptyText(el);
    // "NVDA only" matches the NVDA thesis — it just carries no catalysts. The scoped
    // sentence is true of the loaded set, which under a view IS the view's set.
    expect(text).toBe("No catalysts written down in the theses loaded here.");
    expect(text).not.toContain("No theses match this view.");

    // And the view demonstrably matched: the Theses lens under it lists the NVDA row.
    await act(async () => tabs(el).find((b) => b.dataset.view === "theses")!.click());
    await flush();
    expect(el.querySelector('[data-testid="rms-lens-panel"]')!.textContent).toContain("Nvidia thesis");
  });

  // R1 (the disclosed residue, pinned rather than left to drift): `empty.notes` carries
  // no "in the theses loaded here" scoping clause the way Catalysts and Risks do, so
  // under a view it still reads workspace-wide. The seat's ruling makes the fallback the
  // default and reserves a new per-lens key for its own exact strings; GAPS names it.
  it("R1 Revision notes under a saved view that MATCHED theses falls back to the lens's own sentence", async () => {
    const viewId = "aaaaaaaa-6666-4666-8666-666666666602";
    const aapl = activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000608", "AAPL", "Apple thesis");
    const nvda = activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000609", "NVDA", "Nvidia thesis");
    installWorkspaceFetch({
      theses: [aapl, nvda],
      details: new Map([
        [aapl.id, detailFor(aapl, { revisionNote: "Widened the horizon after the print." })],
        [nvda.id, detailFor(nvda)],
      ]),
      savedViews: [{
        id: viewId,
        name: "NVDA only",
        filter: { lifecycle: "active", subjectGroupKey: "data_os.security_master|issuer|NVDA" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    const el = await mount({ ownerKey: "owner-r6-notes-saved-view" });
    await flush();
    await act(async () => tabs(el).find((b) => b.dataset.view === "notes")!.click());
    await flush();
    expect(el.querySelectorAll('[data-testid="rms-line-row"]').length).toBe(1);

    await act(async () => el.querySelector<HTMLButtonElement>(`[data-saved-view="${viewId}"] button`)!.click());
    await flush();

    const text = emptyText(el);
    expect(text).not.toContain("No theses match this view.");
    expect(text).toContain("No revision notes yet.");
  });

  // R3b: the client answered every 400 the route can return with "Give this view a
  // name before you save it." — an instruction the reader cannot act on for five of
  // the six causes. The route's JSON already carries the distinguishing `error`.
  it("R3b a 400 that is not a name problem says the save failed, never 'give this view a name'", async () => {
    installWorkspaceFetch({
      theses: [activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000610", "AAA", "Alpha one")],
      savedViewsPutStatus: 400,
      savedViewsPutError: "invalid_filter",
    });
    const el = await mount({ ownerKey: "owner-r6-save-invalid-filter" });
    await flush();
    // "Save this view" only offers itself once something is actually narrowing the list.
    await act(async () => chip(el, "stale_30").click());
    await flush();
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="rms-save-view"]')!.click());
    await flush();
    const input = el.querySelector<HTMLInputElement>('input[placeholder="Name this view"]')!;
    await act(async () => typeInto(input, "A perfectly good name"));
    await flush();
    await act(async () => {
      el.querySelector<HTMLInputElement>('input[placeholder="Name this view"]')!
        .closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    const strip = savedViewsStrip(el);
    expect(strip).toContain("We could not save this view. Try again.");
    expect(strip).not.toContain("Give this view a name before you save it.");
    expect(strip).not.toContain("Your saved views did not load.");
  });

  // R3b (green guard): the route's own name rule still reads as a name problem.
  it("R3b a 400 that IS a name problem still asks for a name", async () => {
    installWorkspaceFetch({
      theses: [activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000611", "AAA", "Alpha one")],
      savedViewsPutStatus: 400,
      savedViewsPutError: "invalid_name",
    });
    const el = await mount({ ownerKey: "owner-r6-save-invalid-name" });
    await flush();
    await act(async () => chip(el, "stale_30").click());
    await flush();
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="rms-save-view"]')!.click());
    await flush();
    const input = el.querySelector<HTMLInputElement>('input[placeholder="Name this view"]')!;
    await act(async () => typeInto(input, "   . "));
    await flush();
    await act(async () => {
      el.querySelector<HTMLInputElement>('input[placeholder="Name this view"]')!
        .closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    const strip = savedViewsStrip(el);
    expect(strip).toContain("Give this view a name before you save it.");
    expect(strip).not.toContain("We could not save this view.");
  });

  // R3c: with N saved views a screen reader announced N buttons called "Rename" and N
  // called "Delete this view", with nothing to tell them apart.
  it("R3c two saved views give their Rename and Delete controls distinct accessible names", async () => {
    const first = "aaaaaaaa-7777-4777-8777-777777777701";
    const second = "aaaaaaaa-7777-4777-8777-777777777702";
    installWorkspaceFetch({
      theses: [activeThesis("aaaaaaaa-aaaa-4aaa-8aaa-000000000612", "AAA", "Alpha one")],
      savedViews: [
        { id: first, name: "NVDA only", filter: { lifecycle: "active" }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" },
        { id: second, name: "Stale ones", filter: { lifecycle: "active", staleDays: 30 }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
    });
    const el = await mount({ ownerKey: "owner-r6-row-labels" });
    await flush();

    const labels = (viewId: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>(`[data-saved-view="${viewId}"] button`))
        .map((b) => b.getAttribute("aria-label"))
        .filter((v): v is string => typeof v === "string");

    expect(labels(first)).toEqual(["Rename NVDA only", "Delete NVDA only"]);
    expect(labels(second)).toEqual(["Rename Stale ones", "Delete Stale ones"]);
    // The visible words are unchanged (spec 2.12's copy freeze).
    const strip = savedViewsStrip(el);
    expect(strip).toContain("Rename");
    expect(strip).toContain("Delete this view");
  });
});
