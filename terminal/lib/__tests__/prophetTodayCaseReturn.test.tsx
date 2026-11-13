// @vitest-environment jsdom
/**
 * prophetTodayCaseReturn.test.tsx — the Today → case setup → Back journey with
 * the DERIVED (default) focus group, on both mounts (canonical `/prophet` and
 * legacy `/options?tab=prophet`, whose Today lane is `prophetLane=today`).
 *
 * Regression (PR #1480 C2 acceptance): opening a case from the default Today
 * board dropped the derived group, so the setup's Back asked for a population
 * with no group and sat at Loading forever with zero group requests. The case
 * open now carries the focused group; Back must request that group's
 * population and render it.
 *
 * Real owners execute unchanged: useProphetUrlState (the address), TodayView,
 * ProphetSectorView and MemberSetup. The harness picks Today vs sector the way
 * ProphetLanesView does. HTTP is the committed fixture seam; CLX has no
 * committed symbol capture, so its symbol envelope is assembled from the
 * committed Defensives group record (same refs, same member bytes).
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TodayView } from "@/components/prophet/today/TodayView";
import { ProphetSectorView } from "@/components/prophet/sector/ProphetSectorView";
import { useProphetUrlState } from "@/components/prophet/useProphetUrlState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE_DIR = join(process.cwd(), "public", "data", "prophet_sector_members_fixture");
const readFixture = (name: string) => readFileSync(join(FIXTURE_DIR, name), "utf8");

/** CLX symbol envelope from the committed Defensives group capture. */
function clxSymbolEnvelope(): string {
  const group = JSON.parse(readFixture("group_defensives.json"));
  const member = group.members.find((m: { symbol: string }) => m.symbol === "CLX");
  return JSON.stringify({
    schema: group.schema,
    mode: "symbol",
    captured_at: group.captured_at,
    sector_ref: group.sector_ref,
    prophet_ref: group.prophet_ref,
    compatibility: group.compatibility,
    disclosure: group.disclosure,
    symbol: "CLX",
    member_of: [{ group: group.group, member }],
    prophet: member.prophet,
  });
}

const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "application/json" } });

const fixtureFetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(String(input), "https://terminal.test");
  if (url.pathname !== "/api/prophet/sector-members") return json(JSON.stringify({ error: "not_fixture" }), 404);
  const symbol = url.searchParams.get("symbol");
  if (symbol !== null) {
    return symbol === "CLX"
      ? json(clxSymbolEnvelope())
      : json(JSON.stringify({ error: "unknown_symbol", code: "unknown_symbol" }), 404);
  }
  const group = url.searchParams.get("group");
  if (group === null) return json(readFixture("index.json"));
  try {
    return json(readFixture(`group_${group}.json`));
  } catch {
    return json(JSON.stringify({ error: "unknown_group", code: "unknown_group" }), 404);
  }
});

/** The lane choice ProphetLanesView makes, around the real URL-state hook. */
function Harness() {
  const { state, update } = useProphetUrlState();
  return state.lane === "today"
    ? <TodayView state={state} update={update} />
    : <ProphetSectorView state={state} update={update} />;
}

let host: HTMLDivElement;
let root: Root | undefined;

async function settle(turns = 40) {
  for (let i = 0; i < turns; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
}
const q = (selector: string) => host.querySelector<HTMLElement>(selector);
const groupReads = () => fixtureFetch.mock.calls
  .map(call => new URL(String(call[0]), "https://terminal.test").searchParams.get("group"))
  .filter((group): group is string => group !== null);

beforeEach(() => {
  vi.stubGlobal("fetch", fixtureFetch);
  fixtureFetch.mockClear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe.each([
  { mount: "canonical", start: "/prophet", setupSearch: /[?&]sector=defensives(&|$)/ },
  { mount: "legacy", start: "/options?tab=prophet&prophetLane=today", setupSearch: /[?&]prophetGroup=defensives(&|$)/ },
])("Today → case setup → Back with the derived group ($mount mount)", ({ start, setupSearch }) => {
  it("keeps the focused group, requests its population and renders it", async () => {
    window.history.replaceState({}, "", start);
    root = createRoot(host);
    await act(async () => { root!.render(<Harness />); });
    await settle();

    // The default board derives Defensives (no explicit sector in the URL).
    expect(window.location.search).not.toMatch(/defensives/);
    const setup = q('[data-testid="prophet-today-case"][data-symbol="CLX"] [data-testid="prophet-today-case-setup"]');
    expect(setup).not.toBeNull();
    await act(async () => { setup!.click(); });
    await settle();

    // The setup carries the focused group in the address.
    expect(q('[data-testid="prophet-sector-setup"]')).not.toBeNull();
    expect(window.location.search).toMatch(/CLX/);
    expect(window.location.search).toMatch(setupSearch);

    fixtureFetch.mockClear();
    await act(async () => { q('[data-testid="prophet-sector-setup-back"]')!.click(); });
    await settle();

    // Back asks for that group's population and renders it — never Loading.
    expect(groupReads()).toContain("defensives");
    const population = q('[data-testid="prophet-sector-population"]');
    expect(population).not.toBeNull();
    expect(population!.textContent).toContain("CLX");
    expect(q('[data-testid="prophet-sector-group"]')).toBeNull();
  });
});
