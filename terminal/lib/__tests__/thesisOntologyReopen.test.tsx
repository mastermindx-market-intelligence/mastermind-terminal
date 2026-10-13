// @vitest-environment jsdom
//
// Mounted coverage for the MarketOntology transient context across thesis REOPEN
// (B-owned J1 consumer continuity). The arriving `mo_*` context is transient,
// validated, and anchored to the company symbol this workspace was opened with
// (`initialSymbolKey`); it is never identity, never authorization, and never
// persisted anywhere. What this file pins:
//
//  1. Reopening an EXISTING thesis of the SAME company keeps the context and the
//     "Back to Transmission" link — the defect: `ThesisWorkspace.openDetail` used
//     to strip every `mo_*` key unconditionally, losing both.
//  2. The strip may appear on a thesis detail only after the canonical detail
//     response names the anchored company. Never while loading, and never on the
//     word of a list row, so a wrong-company thesis can never flash it.
//  3. Another company, an unusable subject, and failed reads clear or withhold it.
//  4. A late, superseded detail response can never resurrect it (candidate is
//     bound to the request token).
//  5. A cleared context does not resurrect on A→B→A selection — there is no
//     context persistence store to bring it back from.
//  6. Deep links (reload) and browser back/forward follow the same rule.
//  7. No API request URL or body ever carries `mo_*`.
//
// Same mounting approach as ThesisWorkspaceLensRail.test.tsx: the real component
// in jsdom (no @testing-library — this repo has none installed), a stubbed
// `fetch` over the real `/api/theses` contract, and direct act() flushing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import ThesisWorkspace from "@/components/workspaces/ThesisWorkspace";
import type { ThesisDetail, ThesisSubjectRef, ThesisSummary, ThesisVersion } from "@/lib/theses";
import { THESIS_CONTENT_SCHEMA, THESIS_SUBJECT_SCHEMA } from "@/lib/theses";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER = "owner-mo-reopen";
// ThesisWorkspace's own private history-position key: entries it pushed carry it in
// history.state, and its popstate handler reads it to tell real navigation from
// foreign entries. The history tests below have to speak the same dialect.
const HISTORY_POSITION_KEY = "__mmThesisHistoryPosition";
const MO_QUERY = "mo_from=transmission&mo_chain=chain-1&mo_focus=leg-3&mo_asof=2026-10-01&mo_kc=2026-08-01";
const RETURN_HREF = "https://www.mastermind-x.com/transmission.html#tx-chain-chain-1";
const NVDA_ID = "11111111-1111-4111-8111-111111111111";
const MSFT_ID = "22222222-2222-4222-8222-222222222222";
const NVDA_B_ID = "33333333-3333-4333-8333-333333333333";
const NVDA_C_ID = "44444444-4444-4444-8444-444444444444";

function listingSubject(key: string): ThesisSubjectRef {
  return {
    schema: THESIS_SUBJECT_SCHEMA,
    kind: "issuer",
    owner: "terminal.analysis_symbol",
    key,
    identityState: "listing_scoped",
    listing: { symbol: key, mic: null, securityId: null },
    companyId: null,
    display: `${key} · listing scoped`,
  };
}

/** A resolved Data OS subject whose key is an opaque security id, not an analysis symbol. */
function opaqueSubject(key: string): ThesisSubjectRef {
  return {
    schema: THESIS_SUBJECT_SCHEMA,
    kind: "issuer",
    owner: "data_os.security_master",
    key,
    identityState: "resolved",
    display: "Opaque security master row",
  };
}

function summary(
  id: string,
  subject: ThesisSubjectRef,
  title: string,
  extras: Partial<Pick<ThesisSummary, "currentVersion" | "lifecycleState">> = {},
): ThesisSummary {
  return {
    id,
    currentVersion: extras.currentVersion ?? 1,
    lifecycleState: extras.lifecycleState ?? "active",
    subject,
    title,
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function detailFor(row: ThesisSummary): ThesisDetail {
  const current: ThesisVersion = {
    id: `${row.id}-v1`,
    thesisId: row.id,
    version: row.currentVersion,
    previousVersion: row.currentVersion > 1 ? row.currentVersion - 1 : null,
    transition: "create",
    lifecycleState: row.lifecycleState,
    subject: row.subject,
    content: {
      schema: THESIS_CONTENT_SCHEMA,
      title: row.title,
      statement: "A thesis body long enough to render.",
      catalysts: [],
      falsifiers: [],
      risks: [],
      horizon: "unspecified",
      effectiveAt: null,
      revisionNote: null,
    },
    clientRequestId: `cr-${row.id}`,
    systemRecordedAt: row.updatedAt,
    effectiveAt: null,
  };
  return { ...row, createdAt: "2026-01-01T00:00:00.000Z", current, history: [], historyTruncated: false };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

type DetailAnswer = Response | Promise<Response>;

/** Fetch stub over the real `/api/theses` contract that records EVERY request it sees. */
function installFetch(config: {
  theses?: ThesisSummary[];
  detailFor?: (id: string) => DetailAnswer | undefined;
} = {}) {
  const requests: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(`${raw} ${typeof init?.body === "string" ? init.body : ""}`);
    const url = new URL(raw, "https://x.test");
    if (url.pathname === "/api/thesis-saved-views") return jsonResponse({ views: [] });
    if (url.pathname === "/api/thesis-fire-status") return jsonResponse({ states: {} });
    if (/^\/api\/thesis\/[^/]+\/proposals/.test(url.pathname)) return jsonResponse({ proposals: [] });
    if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
    const id = url.searchParams.get("id");
    if (id) {
      const answer = config.detailFor?.(id);
      if (answer) return answer;
      return jsonResponse({ error: "thesis_not_found" }, 404);
    }
    return jsonResponse({ theses: config.theses ?? [], truncated: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mountAt(
  url: string,
  props: { ownerKey?: string; initialSymbol?: string; initialThesisId?: string; strict?: boolean } = {},
) {
  window.history.replaceState(null, "", url);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    const workspace = (
      <ThesisWorkspace
        ownerKey={props.ownerKey ?? OWNER}
        initialSymbol={props.initialSymbol}
        initialThesisId={props.initialThesisId}
      />
    );
    root!.render(props.strict ? <StrictMode>{workspace}</StrictMode> : workspace);
  });
  await flush();
  return container!;
}

/** Move the browser to a URL the way the component's own entries look, then fire popstate. */
async function popTo(url: string, position: number) {
  window.history.replaceState({ [HISTORY_POSITION_KEY]: position }, "", url);
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: { [HISTORY_POSITION_KEY]: position } }));
  });
  await flush();
}

function strip(el: HTMLElement): Element | null {
  return el.querySelector('[data-testid="mo-context-strip"]');
}

function thesisRow(el: HTMLElement, title: string): HTMLButtonElement {
  const row = Array.from(el.querySelectorAll('[data-testid="thesis-list-pane"] button'))
    .find((candidate) => candidate.textContent?.includes(title));
  expect(row, `expected a list row named "${title}"`).toBeTruthy();
  return row as HTMLButtonElement;
}

function moKeys(): string[] {
  return [...new URL(window.location.href).searchParams.keys()].filter((key) => key.toLowerCase().startsWith("mo_"));
}

beforeEach(() => {
  // See ThesisWorkspaceLensRail.test.tsx: Node's own global localStorage getters must
  // give way to jsdom's real Storage before the component touches pending carriers.
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  if (dom) {
    Object.defineProperty(window, "localStorage", { value: dom.window.localStorage, configurable: true, writable: true });
    Object.defineProperty(window, "sessionStorage", { value: dom.window.sessionStorage, configurable: true, writable: true });
  }
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (!window.matchMedia) {
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

describe("ThesisWorkspace reopen with MarketOntology context", () => {
  it("a late same-id read cannot restore the candidate from a different history entry", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    let answer: ((response: Response) => void) | undefined;
    installFetch({ theses: [nvda], detailFor: () => new Promise<Response>((resolve) => { answer = resolve; }) });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY}`, { initialSymbol: "NVDA" });
    const destination = `/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY.replace("chain-1", "chain-2")}`;
    window.history.replaceState(null, "", destination);
    const destinationUrl = window.location.href;
    await act(async () => answer!(jsonResponse({ thesis: detailFor(nvda) })));
    await flush();
    expect(window.location.href).toBe(destinationUrl);
    expect(strip(el), "the old candidate must remain withheld").toBeNull();
  });

  it.each(["unmount-success", "unmount-failure", "another-route"])("a late detail cannot rewrite the destination URL after %s", async (departure) => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    let answer: ((response: Response) => void) | undefined;
    installFetch({ theses: [nvda], detailFor: () => new Promise<Response>((resolve) => { answer = resolve; }) });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();
    if (departure.startsWith("unmount")) {
      await act(async () => root!.unmount());
      root = null;
    }
    const destination = departure === "another-route"
      ? `/analysis?view=theses&thesis=${MSFT_ID}&symbol=MSFT&mo_from=transmission&mo_chain=destination`
      : "/analysis?symbol=MSFT&mo_from=transmission&mo_chain=destination";
    window.history.replaceState(null, "", destination);
    const destinationUrl = window.location.href;
    await act(async () => answer!(departure === "unmount-failure"
      ? jsonResponse({ error: "unavailable" }, 503) : jsonResponse({ thesis: detailFor(nvda) })));
    await flush();
    expect(window.location.href).toBe(destinationUrl);
  });

  it.each([401, 404, 503, "missing", "throw"] as const)("a failed deep-link read (%s) clears its unconfirmed context", async (failure) => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    installFetch({ theses: [nvda], detailFor: () => {
      if (failure === "throw") return Promise.reject(new Error("read unavailable"));
      return failure === "missing" ? jsonResponse({ thesis: null }) : jsonResponse({ error: "unavailable" }, failure);
    } });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY}`, {
      initialSymbol: "NVDA", initialThesisId: NVDA_ID,
    });
    expect(strip(el)).toBeNull();
    expect(moKeys()).toEqual([]);
    expect(new URL(window.location.href).searchParams.get("symbol")).toBeNull();
  });

  it("a cross-company selection clears the whole candidate before its URL is reloaded", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const msft = summary(MSFT_ID, listingSubject("MSFT"), "MSFT thesis");
    installFetch({ theses: [nvda, msft], detailFor: (id) => id === MSFT_ID
      ? jsonResponse({ thesis: detailFor(msft) }) : undefined });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(el, "MSFT thesis").click());
    await flush();
    const actualUrl = new URL(window.location.href);
    expect(actualUrl.searchParams.get("thesis")).toBe(MSFT_ID);
    expect(actualUrl.searchParams.get("symbol"), "a disproved company must not survive in a shared or reloaded URL").toBeNull();
    expect(moKeys()).toEqual([]);
    expect(strip(el)).toBeNull();

    await act(async () => root!.unmount());
    container!.remove();
    root = null;
    container = null;
    let answer: ((response: Response) => void) | undefined;
    installFetch({ theses: [nvda, msft], detailFor: () => new Promise<Response>((resolve) => { answer = resolve; }) });
    const reloaded = await mountAt(actualUrl.href, {
      initialSymbol: actualUrl.searchParams.get("symbol") ?? undefined,
      initialThesisId: actualUrl.searchParams.get("thesis") ?? undefined,
    });
    const header = reloaded.querySelector('[data-testid="thesis-workspace"] > header')!;
    const claim = reloaded.querySelector('[data-testid="claim-entry-button"]') as HTMLButtonElement;
    expect(header.textContent).not.toContain("NVDA");
    expect(claim.disabled, "a pending canonical read must not seed a claim with the previous company").toBe(true);
    expect(strip(reloaded)).toBeNull();
    await act(async () => answer!(jsonResponse({ thesis: detailFor(msft) })));
    await flush();
    expect(header.textContent).toContain("MSFT");
    expect(claim.disabled).toBe(false);
    expect(strip(reloaded)).toBeNull();
  });

  it("a lazy composer mount does not keep a thesis selected from stale server props", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const { requests } = installFetch({ theses: [nvda], detailFor: () => jsonResponse({ thesis: detailFor(nvda) }) });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, {
      initialSymbol: "NVDA", initialThesisId: NVDA_ID,
    });
    expect(el.querySelector('input[placeholder="NVDA"]')).not.toBeNull();
    expect(el.textContent).not.toContain("Loading thesis");
    expect(requests.some((request) => request.includes(`/api/theses?id=${NVDA_ID}`))).toBe(false);
    expect(strip(el)).not.toBeNull();
  });

  it("a lazy mount reconciles a Forward detail URL even when its server props describe the prior composer", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    let answer: ((response: Response) => void) | undefined;
    installFetch({ theses: [nvda], detailFor: () => new Promise<Response>((resolve) => { answer = resolve; }) });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY}`, { initialSymbol: "NVDA" });
    expect(strip(el), "a missed popstate must not expose unconfirmed detail context").toBeNull();
    expect(answer, "the current browser route must trigger the detail read").toBeTypeOf("function");
    await act(async () => answer!(jsonResponse({ thesis: detailFor(nvda) })));
    await flush();
    expect(el.textContent).toContain("Version 1 · Current");
    expect(strip(el)).not.toBeNull();
  });

  it("saved-thesis navigation keeps the company context without using the generic clear action", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    installFetch({ theses: [nvda], detailFor: () => jsonResponse({ thesis: detailFor(nvda) }) });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    const openSaved = Array.from(el.querySelectorAll("button"))
      .find((button) => button.textContent === "Open saved theses");
    expect(openSaved, "the mobile researcher needs a context-preserving route to existing theses").toBeTruthy();
    await act(async () => openSaved!.click());
    await flush();
    expect(el.querySelector('[data-testid="thesis-workspace"]')!.getAttribute("data-mobile-pane")).toBe("list");
    expect(strip(el)).not.toBeNull();
    expect(new URL(window.location.href).searchParams.get("symbol")).toBe("NVDA");
    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();
    expect(strip(el)).not.toBeNull();
  });

  it("a real remount of the URL produced by selection retains the company context", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    installFetch({ theses: [nvda], detailFor: () => jsonResponse({ thesis: detailFor(nvda) }) });
    const first = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(first, "NVDA thesis").click());
    await flush();
    const actualUrl = new URL(window.location.href);
    await act(async () => root!.unmount());
    container!.remove();
    root = null;
    container = null;
    const reloaded = await mountAt(actualUrl.href, {
      initialSymbol: actualUrl.searchParams.get("symbol") ?? undefined,
      initialThesisId: actualUrl.searchParams.get("thesis") ?? undefined,
    });
    expect(strip(reloaded), "reload must derive its company anchor from the actual clicked URL").not.toBeNull();
    expect(strip(reloaded)!.querySelector("a")!.getAttribute("href")).toBe(RETURN_HREF);
  });

  it("StrictMode mount replay cannot consume a newer detail request's context", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    installFetch({ theses: [nvda], detailFor: () => jsonResponse({ thesis: detailFor(nvda) }) });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY}`, {
      initialSymbol: "NVDA", initialThesisId: NVDA_ID, strict: true,
    });
    expect(strip(el)).not.toBeNull();
  });

  it("reopening an existing thesis of the SAME company keeps the context and the Back to Transmission link", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const { requests } = installFetch({
      theses: [nvda],
      detailFor: (id) => (id === NVDA_ID ? jsonResponse({ thesis: detailFor(nvda) }) : undefined),
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });

    // Arrived from Transmission: the strip and its return link are on the composer.
    expect(strip(el)).not.toBeNull();
    expect(strip(el)!.querySelector("a")!.getAttribute("href")).toBe(RETURN_HREF);

    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();

    // The thesis itself is open…
    expect(el.textContent).toContain("Listing-scoped identity");
    expect(el.textContent).toContain("NVDA thesis");
    // …and the transient context survived the reopen, with its return link.
    expect(strip(el), "the same-company reopen must keep the MarketOntology context strip").not.toBeNull();
    expect(strip(el)!.querySelector("a")!.getAttribute("href")).toBe(RETURN_HREF);
    const params = new URL(window.location.href).searchParams;
    expect(params.get("mo_from")).toBe("transmission");
    expect(params.get("mo_chain")).toBe("chain-1");
    expect(params.get("mo_focus")).toBe("leg-3");
    expect(params.get("mo_asof")).toBe("2026-10-01");
    expect(params.get("mo_kc")).toBe("2026-08-01");
    expect(params.get("thesis")).toBe(NVDA_ID);
    expect(moKeys()).toEqual(["mo_from", "mo_chain", "mo_focus", "mo_asof", "mo_kc"]);
    // …and no API call ever carried the context.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.join("\n")).not.toContain("mo_");
    expect(requests.join("\n")).toContain(`/api/theses?id=${NVDA_ID}`);
  });

  it("never shows the strip on a detail before the canonical subject confirms the company", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    let release: ((value: Response) => void) | null = null;
    installFetch({
      theses: [nvda],
      detailFor: (id) => (id === NVDA_ID
        ? new Promise<Response>((resolve) => { release = resolve; })
        : undefined),
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    expect(strip(el)).not.toBeNull();

    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();

    // The response has not landed: nothing may claim this detail belongs to the
    // anchored company yet — not even the truth that is about to arrive.
    expect(strip(el), "an unconfirmed detail must withhold the strip").toBeNull();
    // Keep only the candidate in the URL so a reload can confirm it independently.
    // This is never sent to the thesis API or displayed before canonical matching.
    expect(moKeys()).toEqual(["mo_from", "mo_chain", "mo_focus", "mo_asof", "mo_kc"]);

    await act(async () => {
      release!(jsonResponse({ thesis: detailFor(nvda) }));
    });
    await flush();
    expect(el.textContent).toContain("NVDA thesis");
    expect(strip(el)).not.toBeNull();
  });

  it("opening a thesis on ANOTHER company clears the context and never flashes it", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const msft = summary(MSFT_ID, listingSubject("MSFT"), "MSFT thesis");
    const { requests } = installFetch({
      theses: [nvda, msft],
      detailFor: (id) => {
        if (id === NVDA_ID) return jsonResponse({ thesis: detailFor(nvda) });
        if (id === MSFT_ID) return jsonResponse({ thesis: detailFor(msft) });
        return undefined;
      },
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    expect(strip(el)).not.toBeNull();

    await act(async () => thesisRow(el, "MSFT thesis").click());
    await flush();

    expect(el.textContent).toContain("MSFT");
    expect(strip(el), "another company's thesis must never carry the strip").toBeNull();
    expect(moKeys()).toEqual([]);
    expect(requests.join("\n")).not.toContain("mo_");
  });

  it("a thesis whose canonical subject is not the anchored company withholds the context", async () => {
    const opaque = summary(NVDA_ID, opaqueSubject("SEC:US:88639"), "Opaque thesis");
    installFetch({
      theses: [opaque],
      detailFor: (id) => (id === NVDA_ID ? jsonResponse({ thesis: detailFor(opaque) }) : undefined),
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    expect(strip(el)).not.toBeNull();

    await act(async () => thesisRow(el, "Opaque thesis").click());
    await flush();

    expect(el.textContent).toContain("Opaque thesis");
    expect(strip(el), "an unusable subject must never carry the strip").toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("a detail response that answers without a thesis body clears the context", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    installFetch({
      theses: [nvda],
      detailFor: (id) => (id === NVDA_ID ? jsonResponse({ thesis: null }) : undefined),
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    expect(strip(el)).not.toBeNull();

    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();

    expect(el.textContent).toContain("did not answer");
    expect(strip(el), "an answered-but-empty read must never carry the strip").toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("a failed thesis read (404) clears the context", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    installFetch({
      theses: [nvda],
      detailFor: () => jsonResponse({ error: "thesis_not_found" }, 404),
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    expect(strip(el)).not.toBeNull();

    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();

    expect(el.textContent).toContain("Thesis not found");
    expect(strip(el), "a failed read must never carry the strip").toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("a failed thesis read (store unavailable) clears the context", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    installFetch({
      theses: [nvda],
      detailFor: () => jsonResponse({ error: "thesis_store_unavailable" }, 503),
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    expect(strip(el)).not.toBeNull();

    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();

    expect(el.textContent).toContain("did not answer");
    expect(strip(el)).toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("a superseded late detail response can never resurrect the context", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const msft = summary(MSFT_ID, listingSubject("MSFT"), "MSFT thesis");
    let releaseNvda: ((value: Response) => void) | null = null;
    installFetch({
      theses: [nvda, msft],
      detailFor: (id) => {
        if (id === NVDA_ID) return new Promise<Response>((resolve) => { releaseNvda = resolve; });
        if (id === MSFT_ID) return jsonResponse({ thesis: detailFor(msft) });
        return undefined;
      },
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });

    // Select the SAME-company thesis but hold its response, then select the other
    // company's thesis, which answers immediately and clears the context.
    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();
    expect(strip(el)).toBeNull();
    await act(async () => thesisRow(el, "MSFT thesis").click());
    await flush();
    expect(el.textContent).toContain("MSFT thesis");
    expect(strip(el)).toBeNull();
    expect(moKeys()).toEqual([]);

    // Only NOW does the first (same-company!) response land. It is stale: another
    // selection superseded it, so it must not repaint the strip over MSFT's detail.
    await act(async () => {
      releaseNvda!(jsonResponse({ thesis: detailFor(nvda) }));
    });
    await flush();

    expect(el.textContent).toContain("MSFT thesis");
    expect(strip(el), "a stale response must not resurrect the strip on another company's detail").toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("a cleared context does not resurrect on A→B→A selection (nothing is persisted)", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const msft = summary(MSFT_ID, listingSubject("MSFT"), "MSFT thesis");
    installFetch({
      theses: [nvda, msft],
      detailFor: (id) => {
        if (id === NVDA_ID) return jsonResponse({ thesis: detailFor(nvda) });
        if (id === MSFT_ID) return jsonResponse({ thesis: detailFor(msft) });
        return undefined;
      },
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });

    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();
    expect(strip(el)).not.toBeNull();

    // B clears it…
    await act(async () => thesisRow(el, "MSFT thesis").click());
    await flush();
    expect(strip(el)).toBeNull();
    expect(moKeys()).toEqual([]);

    // …and returning to A must not bring it back from anywhere.
    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();
    expect(el.textContent).toContain("NVDA thesis");
    expect(strip(el), "a cleared transient context has no store to come back from").toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("a deep link to a same-company thesis reconstructs the strip after the load confirms it", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const { requests } = installFetch({
      theses: [nvda],
      detailFor: (id) => (id === NVDA_ID ? jsonResponse({ thesis: detailFor(nvda) }) : undefined),
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY}`, {
      initialSymbol: "NVDA",
      initialThesisId: NVDA_ID,
    });

    expect(el.textContent).toContain("NVDA thesis");
    expect(strip(el)).not.toBeNull();
    expect(strip(el)!.querySelector("a")!.getAttribute("href")).toBe(RETURN_HREF);
    expect(new URL(window.location.href).searchParams.get("mo_chain")).toBe("chain-1");
    expect(requests.join("\n")).not.toContain("mo_");
  });

  it("a deep link to a WRONG-company thesis never shows the strip and drops the keys", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const msft = summary(MSFT_ID, listingSubject("MSFT"), "MSFT thesis");
    installFetch({
      theses: [nvda, msft],
      detailFor: (id) => {
        if (id === NVDA_ID) return jsonResponse({ thesis: detailFor(nvda) });
        if (id === MSFT_ID) return jsonResponse({ thesis: detailFor(msft) });
        return undefined;
      },
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&thesis=${MSFT_ID}&${MO_QUERY}`, {
      initialSymbol: "NVDA",
      initialThesisId: MSFT_ID,
    });

    expect(el.textContent).toContain("MSFT");
    expect(strip(el), "a wrong-company deep link must never carry the strip").toBeNull();
    expect(moKeys()).toEqual([]);
    expect(new URL(window.location.href).searchParams.get("symbol")).toBeNull();
  });

  it("browser back to the composer entry and forward to the confirmed thesis entry keep the context honest", async () => {
    const nvda = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    installFetch({
      theses: [nvda],
      detailFor: (id) => (id === NVDA_ID ? jsonResponse({ thesis: detailFor(nvda) }) : undefined),
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });

    await act(async () => thesisRow(el, "NVDA thesis").click());
    await flush();
    expect(strip(el)).not.toBeNull();
    const composerUrl = `/analysis?view=theses&symbol=NVDA&${MO_QUERY}`;
    const detailUrl = window.location.href;

    // Back to the entry the arrival pushed: the composer with its own context.
    await popTo(composerUrl, 0);
    expect(el.querySelector('[data-testid="thesis-workspace"]') ?? el).toBeTruthy();
    expect(strip(el), "the composer entry keeps its own context").not.toBeNull();
    expect(new URL(window.location.href).searchParams.get("mo_chain")).toBe("chain-1");

    // Forward to the confirmed detail entry: the same-company context is still there.
    await popTo(detailUrl, 1);
    expect(el.textContent).toContain("NVDA thesis");
    expect(strip(el), "the confirmed detail entry keeps its context across history travel").not.toBeNull();
    expect(strip(el)!.querySelector("a")!.getAttribute("href")).toBe(RETURN_HREF);
    expect(new URL(window.location.href).searchParams.get("thesis")).toBe(NVDA_ID);
    expect(moKeys()).toEqual(["mo_from", "mo_chain", "mo_focus", "mo_asof", "mo_kc"]);
  });

  it("Forward before A settles then a same-company B click keeps B and the candidate context", async () => {
    const thesisA = summary(NVDA_ID, listingSubject("NVDA"), "MU A archived", { currentVersion: 3, lifecycleState: "archived" });
    const thesisB = summary(NVDA_B_ID, listingSubject("NVDA"), "MU B current", { currentVersion: 2 });
    let releaseA: ((value: Response) => void) | null = null;
    let aLoads = 0;
    installFetch({
      theses: [thesisA, thesisB],
      detailFor: (id) => {
        if (id === NVDA_ID) {
          aLoads += 1;
          if (aLoads === 1) return jsonResponse({ thesis: detailFor(thesisA) });
          return new Promise<Response>((resolve) => { releaseA = resolve; });
        }
        if (id === NVDA_B_ID) return jsonResponse({ thesis: detailFor(thesisB) });
        return undefined;
      },
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(el, "MU A archived").click());
    await flush();
    expect(strip(el)).not.toBeNull();
    const detailUrl = window.location.href;
    const composerUrl = `/analysis?view=theses&symbol=NVDA&${MO_QUERY}`;

    await popTo(composerUrl, 0);
    expect(strip(el), "composer history keeps its own context").not.toBeNull();

    // Forward restores A, but do not wait for canonical A detail before the B click.
    await act(async () => {
      window.history.replaceState({ [HISTORY_POSITION_KEY]: 1 }, "", detailUrl);
      window.dispatchEvent(new PopStateEvent("popstate", { state: { [HISTORY_POSITION_KEY]: 1 } }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(releaseA, "Forward must start A's detail read").toBeTypeOf("function");
    expect(strip(el), "unconfirmed Forward detail must withhold the strip").toBeNull();

    await act(async () => thesisRow(el, "MU B current").click());
    await flush();
    await act(async () => releaseA!(jsonResponse({ thesis: detailFor(thesisA) })));
    await flush();

    expect(new URL(window.location.href).searchParams.get("thesis")).toBe(NVDA_B_ID);
    expect(el.textContent).toContain("MU B current");
    expect(el.textContent).toContain("Version 2");
    expect(strip(el), "newest same-company selection must keep the candidate context").not.toBeNull();
    expect(strip(el)!.querySelector("a")!.getAttribute("href")).toBe(RETURN_HREF);
    expect(moKeys()).toEqual(["mo_from", "mo_chain", "mo_focus", "mo_asof", "mo_kc"]);
  });

  it("a remounted Forward URL still lets a later same-company click win with context", async () => {
    const thesisA = summary(NVDA_ID, listingSubject("NVDA"), "MU A archived", { currentVersion: 3, lifecycleState: "archived" });
    const thesisB = summary(NVDA_B_ID, listingSubject("NVDA"), "MU B current", { currentVersion: 2 });
    let releaseA: ((value: Response) => void) | null = null;
    installFetch({
      theses: [thesisA, thesisB],
      detailFor: (id) => {
        if (id === NVDA_ID) return new Promise<Response>((resolve) => { releaseA = resolve; });
        if (id === NVDA_B_ID) return jsonResponse({ thesis: detailFor(thesisB) });
        return undefined;
      },
    });
    const detailUrl = `/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY}`;
    const el = await mountAt(detailUrl, { initialSymbol: "NVDA" });
    expect(strip(el), "lazy remount must withhold unconfirmed detail context").toBeNull();
    expect(releaseA).toBeTypeOf("function");

    await act(async () => thesisRow(el, "MU B current").click());
    await flush();
    await act(async () => releaseA!(jsonResponse({ thesis: detailFor(thesisA) })));
    await flush();

    expect(new URL(window.location.href).searchParams.get("thesis")).toBe(NVDA_B_ID);
    expect(el.textContent).toContain("MU B current");
    expect(strip(el), "candidate context must survive remount-then-B").not.toBeNull();
    expect(moKeys()).toEqual(["mo_from", "mo_chain", "mo_focus", "mo_asof", "mo_kc"]);
  });

  it("a cross-company click during pending Forward restore clears context and never flashes it", async () => {
    const thesisA = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const msft = summary(MSFT_ID, listingSubject("MSFT"), "MSFT thesis");
    let releaseA: ((value: Response) => void) | null = null;
    installFetch({
      theses: [thesisA, msft],
      detailFor: (id) => {
        if (id === NVDA_ID) return new Promise<Response>((resolve) => { releaseA = resolve; });
        if (id === MSFT_ID) return jsonResponse({ thesis: detailFor(msft) });
        return undefined;
      },
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY}`, { initialSymbol: "NVDA" });
    expect(strip(el)).toBeNull();
    await act(async () => thesisRow(el, "MSFT thesis").click());
    await flush();
    expect(strip(el), "another company must not flash the strip while A is pending").toBeNull();
    await act(async () => releaseA!(jsonResponse({ thesis: detailFor(thesisA) })));
    await flush();
    expect(el.textContent).toContain("MSFT thesis");
    expect(new URL(window.location.href).searchParams.get("thesis")).toBe(MSFT_ID);
    expect(strip(el)).toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("a failed later detail during pending Forward restore clears context", async () => {
    const thesisA = summary(NVDA_ID, listingSubject("NVDA"), "NVDA thesis");
    const thesisB = summary(NVDA_B_ID, listingSubject("NVDA"), "NVDA B thesis");
    let releaseA: ((value: Response) => void) | null = null;
    installFetch({
      theses: [thesisA, thesisB],
      detailFor: (id) => {
        if (id === NVDA_ID) return new Promise<Response>((resolve) => { releaseA = resolve; });
        if (id === NVDA_B_ID) return jsonResponse({ error: "thesis_not_found" }, 404);
        return undefined;
      },
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&thesis=${NVDA_ID}&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(el, "NVDA B thesis").click());
    await flush();
    await act(async () => releaseA!(jsonResponse({ thesis: detailFor(thesisA) })));
    await flush();
    expect(el.textContent).toContain("Thesis not found");
    expect(new URL(window.location.href).searchParams.get("thesis")).toBe(NVDA_B_ID);
    expect(strip(el), "a failed later read must clear the candidate").toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("context-free history does not inherit the previous detail candidate", async () => {
    const a = summary(NVDA_ID, listingSubject("NVDA"), "Anchored A");
    const b = summary(NVDA_B_ID, listingSubject("NVDA"), "Unanchored B");
    installFetch({ theses: [a, b], detailFor: (id) => jsonResponse({ thesis: detailFor(id === NVDA_ID ? a : b) }) });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(el, "Anchored A").click());
    await flush();
    expect(strip(el)).not.toBeNull();
    await popTo(`/analysis?view=theses&thesis=${NVDA_B_ID}`, 8);
    expect(new URL(window.location.href).searchParams.get("thesis")).toBe(NVDA_B_ID);
    expect(strip(el), "a context-free history entry must stay context-free").toBeNull();
    expect(moKeys()).toEqual([]);
  });

  it("a pending selection retains its candidate through a real component remount", async () => {
    const a = summary(NVDA_ID, listingSubject("NVDA"), "Anchored A");
    const b = summary(NVDA_B_ID, listingSubject("NVDA"), "Remounted B");
    let bLoads = 0;
    installFetch({ theses: [a, b], detailFor: (id) => {
      if (id === NVDA_ID) return jsonResponse({ thesis: detailFor(a) });
      if (id === NVDA_B_ID && ++bLoads === 1) return new Promise<Response>(() => {});
      return jsonResponse({ thesis: detailFor(b) });
    } });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(el, "Anchored A").click());
    await flush();
    await act(async () => thesisRow(el, "Remounted B").click());
    await flush();
    expect(bLoads).toBe(1);
    expect(strip(el), "pending B cannot display unconfirmed context").toBeNull();
    const pendingUrl = window.location.href;
    await act(async () => root!.unmount());
    container!.remove();
    root = null;
    const remounted = await mountAt(pendingUrl, { initialThesisId: NVDA_B_ID });
    expect(new URL(window.location.href).searchParams.get("thesis")).toBe(NVDA_B_ID);
    expect(strip(remounted), "the current URL must carry the candidate across disposal").not.toBeNull();
    expect(moKeys()).toEqual(["mo_from", "mo_chain", "mo_focus", "mo_asof", "mo_kc"]);
  });

  it("a new history candidate keeps its own company during a later pending selection", async () => {
    const a = summary(NVDA_ID, listingSubject("NVDA"), "Original NVDA");
    const history = summary(MSFT_ID, listingSubject("MSFT"), "Pending MSFT");
    const later = summary(NVDA_B_ID, listingSubject("MSFT"), "Later MSFT");
    installFetch({ theses: [a, history, later], detailFor: (id) => {
      if (id === NVDA_ID) return jsonResponse({ thesis: detailFor(a) });
      if (id === MSFT_ID) return new Promise<Response>(() => {});
      return jsonResponse({ thesis: detailFor(later) });
    } });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(el, "Original NVDA").click());
    await flush();
    await popTo(`/analysis?view=theses&symbol=MSFT&thesis=${MSFT_ID}&${MO_QUERY.replace("chain-1", "chain-2")}`, 8);
    expect(strip(el)).toBeNull();
    await act(async () => thesisRow(el, "Later MSFT").click());
    await flush();
    expect(strip(el), "new MSFT context must not be paired with the old NVDA anchor").not.toBeNull();
    expect(new URL(window.location.href).searchParams.get("symbol")).toBe("MSFT");
    expect(new URL(window.location.href).searchParams.get("mo_chain")).toBe("chain-2");
  });

  it("the latest ordinary selection wins when earlier detail reads complete out of order", async () => {
    const thesisA = summary(NVDA_ID, listingSubject("NVDA"), "NVDA A thesis");
    const thesisB = summary(NVDA_B_ID, listingSubject("NVDA"), "NVDA B thesis");
    const thesisC = summary(NVDA_C_ID, listingSubject("NVDA"), "NVDA C thesis");
    let releaseA: ((value: Response) => void) | null = null;
    let releaseB: ((value: Response) => void) | null = null;
    installFetch({
      theses: [thesisA, thesisB, thesisC],
      detailFor: (id) => {
        if (id === NVDA_ID) return new Promise<Response>((resolve) => { releaseA = resolve; });
        if (id === NVDA_B_ID) return new Promise<Response>((resolve) => { releaseB = resolve; });
        if (id === NVDA_C_ID) return jsonResponse({ thesis: detailFor(thesisC) });
        return undefined;
      },
    });
    const el = await mountAt(`/analysis?view=theses&symbol=NVDA&${MO_QUERY}`, { initialSymbol: "NVDA" });
    await act(async () => thesisRow(el, "NVDA A thesis").click());
    await flush();
    await act(async () => thesisRow(el, "NVDA B thesis").click());
    await flush();
    await act(async () => thesisRow(el, "NVDA C thesis").click());
    await flush();
    await act(async () => releaseB!(jsonResponse({ thesis: detailFor(thesisB) })));
    await flush();
    await act(async () => releaseA!(jsonResponse({ thesis: detailFor(thesisA) })));
    await flush();
    expect(new URL(window.location.href).searchParams.get("thesis")).toBe(NVDA_C_ID);
    expect(el.textContent).toContain("NVDA C thesis");
    expect(strip(el), "latest same-company selection keeps the arrival context").not.toBeNull();
    expect(moKeys()).toEqual(["mo_from", "mo_chain", "mo_focus", "mo_asof", "mo_kc"]);
  });
});
