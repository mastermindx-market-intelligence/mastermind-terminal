import type { Page, TestInfo } from "@playwright/test";

// Per-test isolation + fault injection for the saved-layout fixture store
// (lib/layoutsFixtureDb.ts), built the same way as e2e/watchlistStore.ts and for the same reasons:
// the store is process-global in the dev server while the suite runs fully parallel across three
// viewport projects, and `reuseExistingServer` means a local re-run usually attaches to the
// previous run's process.

const RUN_NONCE = `${process.env.TEST_WORKER_INDEX ?? "0"}${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_BASE = "http://127.0.0.1:3108";

const keyFor = (testInfo: TestInfo) =>
  `${testInfo.project.name}-${testInfo.title}-${testInfo.repeatEachIndex}-${testInfo.retry}-${RUN_NONCE}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 110);

export async function isolateLayoutStore(page: Page, testInfo: TestInfo, baseURL?: string) {
  const key = keyFor(testInfo);
  await page.context().addCookies([{ name: "mm_e2e_layouts", value: key, url: baseURL ?? DEFAULT_BASE }]);
  return key;
}

/**
 * Make one class of layout statement fail, the way a Supabase outage would.
 *
 * Production is never deliberately broken to prove an error state (delivery packet, "Production
 * proof"); the deterministic fixture transport fails on request instead.
 */
export async function injectLayoutFault(page: Page, fault: "list" | "save" | "delete" | "all" | "", baseURL?: string) {
  await page.context().addCookies([{ name: "mm_e2e_layout_fault", value: fault, url: baseURL ?? DEFAULT_BASE }]);
}

/** Render the workspace as a signed-out visitor — page prop AND `/api/layouts` both honour this. */
export async function renderAsGuest(page: Page, baseURL?: string) {
  await page.context().addCookies([{ name: "mm_e2e_guest", value: "1", url: baseURL ?? DEFAULT_BASE }]);
}

/**
 * Force a locale before the app boots, the same way e2e/terminal-chrome-responsive.spec.ts does.
 * `lib/i18n.tsx` reads `mm.lang` and the `data-lang` attribute, so both are set.
 */
export async function useLang(page: Page, locale: "en" | "zh") {
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, locale);
}

// ── W2-A fault-vocabulary extension: stale / conflict / unreadable ──────────────────────────────
//
// `injectLayoutFault`'s four values (list/save/delete/all) simulate a TRANSPORT failure — the
// fixture answers with a raw error, exactly as `lib/layoutsFixtureDb.ts`'s header describes. The
// three W2-A states below are NOT transport failures — they are genuine STORE-LEVEL outcomes
// (a real CAS mismatch, a real unique-name collision, a row this build cannot parse) — so rather
// than teach the fixture transport a second, fake meaning for the same fault cookie, these helpers
// reproduce the real condition through the same API surface the product itself uses. This is
// provably real behavior (the actual `saveWorkspace`/`renameWorkspace` CAS logic in `lib/layouts.ts`
// is what answers `stale_revision`/`name_conflict`), not a simulated stand-in.

/** Read the workspace library through the page, exactly as `inventory()` does in the specs — used
 *  by the two helpers below to find a row's current `config` (its stored revision). */
async function currentRows(page: Page): Promise<{ id: string; name: string; config: Record<string, unknown> }[]> {
  return page.evaluate(async () => {
    const r = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    return (await r.json()).layouts;
  });
}

/**
 * Make the NEXT save of `name` from `page` land on a stale revision — as if another device had
 * already saved over it. Reads the row's current envelope, mutates its chart widget content (a
 * flipped `sync`), then performs one more `save_workspace` write "from elsewhere" (same store, same
 * cookies, a fetch the page itself issues) so the revision the UI is still holding is now one
 * behind. Requires `name` to already be a saved `workspace_layout.v1` row (own a numeric
 * `config.revision`).
 *
 * The content mutation is LOAD-BEARING, not decorative: Amendment A3 ruling 4 (M9 retry
 * idempotency) recognizes a 0-rows-updated write as an already-applied SUCCESS, not a conflict,
 * when the row's current content is byte-identical to what THIS caller attempted to write. If the
 * "elsewhere" write here echoed the SAME content back (as it did before this fix), the real page's
 * own subsequent save — capturing the SAME unchanged live workspace — would independently compute
 * IDENTICAL bytes, and the two would be indistinguishable from "my own retried write": the CAS path
 * would (correctly, per the frozen law) report success instead of the `stale_revision` this helper
 * exists to reproduce. A genuinely divergent "elsewhere" write is what makes the two writes
 * distinguishable, which is what a real second device would produce anyway.
 */
export async function forceStaleRevision(page: Page, name: string): Promise<void> {
  const rows = await currentRows(page);
  const row = rows.find((r) => r.name === name);
  if (!row || typeof (row.config as { revision?: unknown }).revision !== "number") {
    throw new Error(`forceStaleRevision: "${name}" is not a saved workspace_layout.v1 row`);
  }
  const revision = (row.config as { revision: number }).revision;
  const outcome = await page.evaluate(async ({ name, config, revision }) => {
    type Widget = { type: string; config: Record<string, unknown> };
    const envelope = JSON.parse(JSON.stringify(config)) as { widgets: Widget[] };
    const chart = envelope.widgets.find((w) => w.type === "chart");
    if (chart) chart.config.sync = chart.config.sync !== true; // genuinely different content
    const r = await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "save_workspace", name, envelope, expectedRevision: revision }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { name, config: row.config, revision });
  if (outcome.status !== 200) {
    throw new Error(`forceStaleRevision: the "from elsewhere" write itself failed (${outcome.status}: ${JSON.stringify(outcome.body)})`);
  }
}

/**
 * Make the NEXT rename of `sourceName` to `targetName` collide, by creating a real second
 * workspace under `targetName` first — a genuine `(user_id, name)` unique-index conflict, not a
 * simulated one.
 */
export async function seedNameConflict(page: Page, targetName: string): Promise<void> {
  const outcome = await page.evaluate(async (name) => {
    const r = await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, config: { schemaVersion: 2, panes: ["MSFT"], paneTfs: ["1D"] }, mode: "create" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, targetName);
  if (outcome.status !== 200) {
    throw new Error(`seedNameConflict: seeding "${targetName}" failed (${outcome.status}: ${JSON.stringify(outcome.body)})`);
  }
}

/**
 * Seed a row this Terminal cannot parse as any recognized shape (freeze §6 row 4: fail-closed
 * `unsupported_schema`) — via the LEGACY save endpoint, which stores `config` verbatim with no
 * shape validation, exactly as a foreign/future export or corrupted row would arrive in production.
 */
export async function seedUnreadableWorkspace(page: Page, name: string): Promise<void> {
  const outcome = await page.evaluate(async (name) => {
    const r = await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, config: { totally: "not a recognized shape", nonce: Math.random() }, mode: "create" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, name);
  if (outcome.status !== 200) {
    throw new Error(`seedUnreadableWorkspace: seeding "${name}" failed (${outcome.status}: ${JSON.stringify(outcome.body)})`);
  }
}

/**
 * Seed a real legacy (`chart_layout_v2`) row carrying ONE genuinely invalid field (`split`) among
 * otherwise-valid ones — reviewer ruling B1/B2's "tolerant-defect" row: `migrateLegacy(config,
 * false)` (the READ direction) no-claims just that field and opens the row `ok` with a non-empty
 * `unclaimed` list, rather than blocking the whole row as `unsupported_schema` (the pre-B1 behavior,
 * reserved for a genuinely unrecognized shape like `seedUnreadableWorkspace`'s). Saving over this
 * row (the WRITE direction) still refuses strictly — this helper only proves the READ side opens.
 */
export async function seedTolerantDefectWorkspace(page: Page, name: string): Promise<void> {
  const outcome = await page.evaluate(async (name) => {
    const r = await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        config: {
          schemaVersion: 2,
          panes: ["AAPL"], paneTfs: ["1D"],
          split: "not-a-valid-split", // genuinely invalid — vSplit only accepts {1,2,3,4}
          activePane: 0, sync: true, chartType: "candles",
          inds: [], indParams: {}, hidden: [], compare: [], compareCfg: {}, lockedVLine: null,
        },
        mode: "create",
      }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, name);
  if (outcome.status !== 200) {
    throw new Error(`seedTolerantDefectWorkspace: seeding "${name}" failed (${outcome.status}: ${JSON.stringify(outcome.body)})`);
  }
}

/**
 * Seed a real `workspace_layout.v1` row whose widget graph carries a genuinely UNKNOWN widget
 * `type` (e.g. `"screener"`, not in `WIDGET_TYPES`) alongside an ordinary working chart — reviewer
 * ruling M5: the row must still open (`workspaceRowState` "ok", never `unsupported_schema`), the
 * chart renders normally, and the unknown-type widget falls to the generic `WorkspaceTile` fallback
 * showing its own type name. `save_workspace` (the fenced, validated op) refuses an unknown widget
 * type outright by design — write/import rejection is UNCHANGED by M5 — so there is no real API
 * path that can construct this row; it is seeded verbatim via the same legacy-endpoint backdoor
 * `seedFutureFloorWorkspace` uses, for the same reason (a shape this build can only ever ENCOUNTER,
 * never create itself).
 */
export async function seedUnknownWidgetTypeWorkspace(page: Page, name: string): Promise<void> {
  const envelope = {
    schema: "workspace_layout.v1",
    requires: { floor: 1 },
    revision: 1,
    name: null,
    link_groups: { primary_security: { entity_type: "security" } },
    widgets: [
      {
        id: "chart-main", type: "chart", semantic_lane: "primary",
        context_in: ["primary_security"], context_out: ["primary_security"],
        config: { panes: ["AAPL"], paneTfs: ["1D"], split: 1, activePane: 0, sync: true, chartType: "candles", inds: [], indParams: {}, hidden: [], compare: [], compareCfg: {}, lockedVLine: null },
      },
      {
        id: "widget-screener", type: "screener", semantic_lane: "rail",
        context_in: [], context_out: [], config: {},
      },
    ],
    migration: { source: "none", source_revision: null },
  };
  const outcome = await page.evaluate(async ({ name, envelope }) => {
    const r = await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, config: envelope, mode: "create" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { name, envelope });
  if (outcome.status !== 200) {
    throw new Error(`seedUnknownWidgetTypeWorkspace: seeding "${name}" failed (${outcome.status}: ${JSON.stringify(outcome.body)})`);
  }
}

/**
 * Seed a real `workspace_layout.v1` row whose `requires.floor` exceeds this build's supported
 * floor (freeze §1 — a reader whose supported floor is lower refuses with `unsupported_floor`).
 * Also via the legacy endpoint (which stores `config` verbatim): the row is otherwise a
 * structurally valid envelope, so the ONE thing that fails is the floor check.
 */
export async function seedFutureFloorWorkspace(page: Page, name: string): Promise<void> {
  const envelope = {
    schema: "workspace_layout.v1",
    requires: { floor: 99 },
    revision: 1,
    name: null,
    link_groups: { primary_security: { entity_type: "security" } },
    widgets: [{
      id: "chart-main", type: "chart", semantic_lane: "primary",
      context_in: ["primary_security"], context_out: ["primary_security"],
      config: { panes: ["AAPL"], paneTfs: ["1D"], split: 1, activePane: 0, sync: true, chartType: "candles", inds: [], indParams: {}, hidden: [], compare: [], compareCfg: {}, lockedVLine: null },
    }],
    migration: { source: "none", source_revision: null },
  };
  const outcome = await page.evaluate(async ({ name, envelope }) => {
    const r = await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, config: envelope, mode: "create" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { name, envelope });
  if (outcome.status !== 200) {
    throw new Error(`seedFutureFloorWorkspace: seeding "${name}" failed (${outcome.status}: ${JSON.stringify(outcome.body)})`);
  }
}
