// @vitest-environment jsdom
//
// Minor 4 (round-6 review of PR #517): the ZH page rendered raw English condition text
// ("Crossed your price line") through the `condition_plain` passthrough — the evaluator's own
// fired-event payload is EN-only, and the pre-fix code used it unconditionally for both
// languages. `verdictText` (lib/alertsView.ts) fixes the pure decision and has its own unit
// tests (alertsView.test.ts). THIS test proves the fix holds through the real render path.
//
// Major (round-6 review, follow-up): the prior version of this test scoped every assertion to
// the cockpit's own `[data-alerts-module]`/`[data-cockpit-state]` subtrees and never mounted
// `children` at all — so the existing-alerts management panel (`AlertsView.tsx`, `listOnly`,
// mounted as `children` — see app/(shell)/alerts/page.tsx) was absent from the test DOM
// entirely, and its `.arow-note` span (round-6 review Major 1: raw English "crossed · 100"
// leaking onto the ZH page) was never exercised.
//
// META-CEO B ruling r8 (response to the r7 review of fa003118: "stale evidence + ZH
// duplicate-fact row"): every fixture below — calm, watching-only, no-coverage, fired+drillback
// — now mounts the FULL composed `/alerts` page (`AlertsCockpit` wrapping a real `AlertsView`
// `listOnly` instance as `children`, exactly as `app/(shell)/alerts/page.tsx` composes it, never
// scoped or excluded) and asserts two things over the whole rendered page: (1) no ASCII-letter
// run longer than a ticker symbol appears anywhere, and (2) the condition's own definition
// (title/threshold — `.cond` in the existing-alerts row, "条件" in the drillback dialog) is never
// repeated verbatim as the fired-event note/fact next to it (`.arow-note`, "发生了什么") — the
// r7-review regression where the "what happened" field still restated the condition instead of
// describing the event.
//
// No @testing-library/react in this repo (vitest.config.ts's `include` is
// lib/__tests__/**/*.test.ts only) — react-dom/client's createRoot + react's act, per the
// BrainWidget/AlertTimeline/alertsCockpitNoCoverageActivity precedent.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import AlertsCockpit from "@/components/alerts/AlertsCockpit";
import AlertsView from "@/components/AlertsView";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Every ticker used in this fixture set ("NVDA") is 4 letters — a run of 5+ consecutive ASCII
// letters can only be leaked English prose, never a ticker or a number. Checked per DOM TEXT
// NODE, never on a whole subtree's concatenated `.textContent` — two adjacent sibling spans
// (e.g. the timeline row's own `.subject` "NVDA" immediately followed by its `.verdict` "NVDA
// price below 150") concatenate with no separator in `.textContent`, which would falsely read as
// one long run ("NVDANVDA...") even though nothing is actually wrong. A single real English
// sentence, in contrast, always lives inside ONE element as one text node, so checking node-by-
// node still catches it.
function longestAsciiLetterRun(text: string): string {
  const matches = text.match(/[A-Za-z]+/g) ?? [];
  return matches.reduce((longest, m) => (m.length > longest.length ? m : longest), "");
}
const MAX_TICKER_LETTERS = 4;
function assertNoLeakedEnglish(root: Element, where: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    const worst = longestAsciiLetterRun(text);
    expect(
      worst.length,
      `${where}: text node "${text}" contains ASCII-letter run "${worst}" (${worst.length} chars) — looks like leaked English, not a ticker/number`,
    ).toBeLessThanOrEqual(MAX_TICKER_LETTERS);
  }
}

// META-CEO B ruling r8: the condition's own definition (title/threshold) and the fired EVENT
// fact (note) must never be the same string twice under two different labels. Checked wherever
// this composed page renders both side by side: the existing-alerts list's per-row `.cond`
// condition span next to its `.arow-note` fired-event span (before the dialog is even opened),
// and the drillback dialog's "条件"/"发生了什么" facts (after it is). No-ops safely when a given
// fixture renders neither pair (e.g. nothing has fired, or the dialog is not open).
function assertNoDuplicatedConditionTitleAndNote(root: Element, where: string) {
  // "Duplicated" means the note REPEATS the condition text — checked as a SUBSTRING, not exact
  // equality. The r7-review regression (`${data.conditionText} · ${data.triggeredValue}`) still
  // PREPENDED the full condition sentence to the event fact, so the two strings were never
  // byte-identical (the note was always longer) — an exact-equality check would have missed it.
  root.querySelectorAll(".arow").forEach((row, i) => {
    const condEl = row.querySelector(".cond");
    const noteEl = row.querySelector(".arow-note");
    // `.cond`'s own textContent is "· <condition text>" — the leading bullet is decoration, not
    // part of the fact, and would make an otherwise-real substring match fail structurally.
    const condTextValue = (condEl?.textContent ?? "").replace(/^\s*·\s*/, "");
    if (condTextValue && noteEl) {
      expect(
        noteEl.textContent ?? "",
        `${where}: row ${i} — the fired-event note "${noteEl.textContent}" must not repeat the condition text "${condTextValue}"`,
      ).not.toContain(condTextValue);
    }
  });
  const leafWithText = (text: string) =>
    Array.from(root.querySelectorAll("*")).find((el) => el.textContent === text && el.children.length === 0);
  const conditionLabel = leafWithText("条件");
  const whatHappenedLabel = leafWithText("发生了什么");
  if (conditionLabel && whatHappenedLabel) {
    const conditionValue = conditionLabel.nextElementSibling?.textContent ?? "";
    const whatHappenedValue = whatHappenedLabel.nextElementSibling?.textContent ?? "";
    expect(conditionValue.length).toBeGreaterThan(0);
    expect(
      whatHappenedValue,
      `${where}: "发生了什么"="${whatHappenedValue}" must not repeat "条件"="${conditionValue}"`,
    ).not.toContain(conditionValue);
  }
}

// Matches e2e/f08-alerts.spec.ts's FIRED_ALERT/SENT_OUTBOX exactly (the fixture behind the
// zh-calm and zh-drillback crops this round regenerates).
const FIRED_ALERT = {
  id: "a1", symbol: "NVDA", active: false, created_at: "2026-08-01T00:00:00Z",
  condition: { type: "price", op: "below", value: 150, triggered: { at: "2026-09-05T09:41:00Z", value: 100, note: "crossed" } },
};
const SENT_OUTBOX = [{
  alert_id: "a1", fire_event_id: "f1", status: "sent", attempts: 1, last_error: null,
  deliver_after: null, delivered_at: "2026-09-05T09:41:00Z", created_at: "2026-08-01T00:00:00Z",
  payload: {
    subject: "NVDA crossed your price line", summary_plain: "NVDA crossed your price line.",
    ticker: "NVDA", condition_plain: "Crossed your price line",
    evidence_url: "https://example.com/evidence/f1", fired_at: "2026-09-05T09:41:00Z",
  },
}];
// Round-9 review of f352b961 (major): a non-price condition kind whose stamped `triggered.value`
// must NEVER be rendered as if it were a price ("触发时价格 72" for an RSI reading is a
// fabricated data claim). condition_plain is deliberately EN-only prose the ZH branch never
// uses, matching FIRED_ALERT above.
const FIRED_RSI_ALERT = {
  id: "a2", symbol: "NVDA", active: false, created_at: "2026-08-01T00:00:00Z",
  condition: { type: "rsi", value: 30, triggered: { at: "2026-09-05T09:41:00Z", value: 72, note: "rsi crossed" } },
};
const SENT_RSI_OUTBOX = [{
  alert_id: "a2", fire_event_id: "f2", status: "sent", attempts: 1, last_error: null,
  deliver_after: null, delivered_at: "2026-09-05T09:41:00Z", created_at: "2026-08-01T00:00:00Z",
  payload: {
    subject: "NVDA RSI crossed", summary_plain: "NVDA RSI crossed.",
    ticker: "NVDA", condition_plain: "RSI crossed 30",
    evidence_url: "https://example.com/evidence/f2", fired_at: "2026-09-05T09:41:00Z",
  },
}];
const WATCHING_ALERT = {
  id: "a0", symbol: "NVDA", active: true, created_at: "2026-08-01T00:00:00Z",
  condition: { type: "price", op: "above", value: 200 },
};
// Minor-1 (r9 review): the drillback's own `triggeredValue` extraction (AlertsCockpit.tsx)
// used to discard a numeric-STRING stamp to `null` via `typeof triggered.value === "number"`,
// so this exercises the whole path, not just firedEventTextZh's own unit tests.
const FIRED_ALERT_STRING_VALUE = {
  id: "a3", symbol: "NVDA", active: false, created_at: "2026-08-01T00:00:00Z",
  condition: { type: "price", op: "below", value: 150, triggered: { at: "2026-09-05T09:41:00Z", value: "100", note: "crossed" } },
};
const SENT_OUTBOX_STRING_VALUE = [{
  alert_id: "a3", fire_event_id: "f3", status: "sent", attempts: 1, last_error: null,
  deliver_after: null, delivered_at: "2026-09-05T09:41:00Z", created_at: "2026-08-01T00:00:00Z",
  payload: {
    subject: "NVDA crossed your price line", summary_plain: "NVDA crossed your price line.",
    ticker: "NVDA", condition_plain: "Crossed your price line",
    evidence_url: "https://example.com/evidence/f3", fired_at: "2026-09-05T09:41:00Z",
  },
}];
const NOW_ISO = new Date().toISOString();
const FRESH_RUN = {
  lane: "alerts_engine", run_id: "r1", started_at: NOW_ISO, concluded_at: NOW_ISO,
  outcome: "success", lane_cadence_budget_s: 300,
};

describe("AlertsCockpit — full composed ZH page never leaks English and never duplicates the condition as the fired note (round-6/r7/r8 review)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    document.documentElement.setAttribute("data-lang", "zh");
    realFetch = globalThis.fetch;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    document.documentElement.removeAttribute("data-lang");
    globalThis.fetch = realFetch;
  });

  function mockFetch(alerts: unknown[], receipts: Record<string, unknown>) {
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/alerts/receipts")) return { ok: true, status: 200, json: async () => receipts } as Response;
      if (url.startsWith("/api/alerts")) return { ok: true, status: 200, json: async () => ({ alerts }) } as Response;
      // Every other endpoint (NewAlertPanel's own entitlement/manifest reads, /api/me, ...) is
      // honestly "unavailable" — matching alertsCockpitNoCoverageActivity.test.ts's own fetch
      // stub; this test asserts nothing about that out-of-scope surface either way.
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;
  }

  // Ruling r8: every fixture mounts the FULL composed page — `AlertsCockpit` wrapping a real
  // `AlertsView` `listOnly` instance as `children`, exactly as `app/(shell)/alerts/page.tsx`
  // composes it. No fixture scopes this child away.
  async function mount() {
    const child = React.createElement(AlertsView, { email: "test@example.com", listOnly: true });
    await act(async () => {
      root = createRoot(container);
      root!.render(React.createElement(LangProvider, null, React.createElement(AlertsCockpit, { email: "test@example.com" }, child)));
    });
    // Flush the two sequential awaited fetches inside AlertsCockpit's own `load()` (and
    // AlertsView's own independent `loadAlerts()` + manifest read), plus the LangProvider effect
    // that reads the `data-lang` attribute set in beforeEach.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  }

  it("calm fixture (a fired alert on record, drillback not opened yet): the full composed page is English-free and the row note never repeats the condition", async () => {
    mockFetch([FIRED_ALERT], {
      run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
      last_success_state: "READ_OK", outbox: SENT_OUTBOX, outbox_state: "READ_OK",
    });
    await mount();

    // The existing-alerts management panel's fired-note span (round-6 review Major 1: raw
    // English "crossed · 100" leaking onto the ZH page here) is real, always-rendered content on
    // the composed page — assert on it directly, never scoped away.
    const note = container.querySelector(".arow-note");
    expect(note, "expected the existing-alerts list's fired-note span (.arow-note) to render for the FIRED_ALERT fixture").not.toBeNull();
    expect(note!.textContent ?? "").not.toContain("crossed");

    assertNoLeakedEnglish(container, "calm (full composed page)");
    assertNoDuplicatedConditionTitleAndNote(container, "calm (full composed page)");
    expect((container.textContent ?? "").toLowerCase()).not.toContain("crossed your price line");
  });

  it("fired + drillback fixture (same alert, dialog opened): the timeline row and the drillback dialog are both English-free, and \"条件\"/\"发生了什么\" describe two distinct facts", async () => {
    mockFetch([FIRED_ALERT], {
      run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
      last_success_state: "READ_OK", outbox: SENT_OUTBOX, outbox_state: "READ_OK",
    });
    await mount();

    const timeline = container.querySelector('[data-alerts-module="recent-activity"]');
    expect(timeline).not.toBeNull();
    assertNoLeakedEnglish(timeline!, "timeline row");
    expect(timeline!.textContent).not.toContain("Crossed");

    const deliveryRow = container.querySelector('[data-delivery="sent"]') as HTMLElement | null;
    expect(deliveryRow).not.toBeNull();
    await act(async () => { deliveryRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const dialog = container.querySelector('[data-cockpit-state="drillback"]');
    expect(dialog).not.toBeNull();
    assertNoLeakedEnglish(dialog!, "drillback dialog");
    expect((dialog!.textContent ?? "").toLowerCase()).not.toContain("crossed your price line");

    // Whole-page check (not just the dialog) — the underlying list row is still mounted behind
    // the dialog, so both duplicate-fact sites are exercised at once.
    assertNoLeakedEnglish(container, "fired + drillback (full composed page)");
    assertNoDuplicatedConditionTitleAndNote(container, "fired + drillback (full composed page)");
  });

  it("RED-first: a non-price fired alert (RSI) must never render \"价格\" (price) for its stamped value, on either the row note or the drillback dialog (round-9 review of f352b961, major)", async () => {
    mockFetch([FIRED_RSI_ALERT], {
      run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
      last_success_state: "READ_OK", outbox: SENT_RSI_OUTBOX, outbox_state: "READ_OK",
    });
    await mount();

    const note = container.querySelector(".arow-note");
    expect(note, "expected the existing-alerts list's fired-note span (.arow-note) to render for the FIRED_RSI_ALERT fixture").not.toBeNull();
    expect(note!.textContent ?? "").not.toContain("价格"); // an RSI reading is never a price
    expect(note!.textContent ?? "").toContain("触发时数值 72"); // unit-neutral "value" sentence

    const deliveryRow = container.querySelector('[data-delivery="sent"]') as HTMLElement | null;
    expect(deliveryRow).not.toBeNull();
    await act(async () => { deliveryRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const dialog = container.querySelector('[data-cockpit-state="drillback"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent ?? "").not.toContain("价格");
    expect(dialog!.textContent ?? "").toContain("触发时数值 72");

    assertNoLeakedEnglish(container, "non-price fired alert (full composed page)");
    assertNoDuplicatedConditionTitleAndNote(container, "non-price fired alert (full composed page)");
  });

  it("watching-only fixture (no fired rows): the full composed page is English-free", async () => {
    mockFetch([WATCHING_ALERT], {
      run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
      last_success_state: "READ_OK", outbox: [], outbox_state: "READ_OK_ZERO",
    });
    await mount();
    const watchingList = container.querySelector('[data-alerts-module="watching-list"]');
    expect(watchingList).not.toBeNull();
    assertNoLeakedEnglish(watchingList!, "watching-list module");
    assertNoLeakedEnglish(container, "watching-only (full composed page)");
    assertNoDuplicatedConditionTitleAndNote(container, "watching-only (full composed page)");
  });

  it("RED-first: WatchingList never doubles the ticker onto its own verdict cell for a price condition (minor-4, r9 review)", async () => {
    // Before this round's fix, AlertsCockpit.tsx passed `a.symbol` into `conditionText`, which
    // ALSO prefixes the symbol for a price condition — doubling "NVDA" onto the row: the
    // `.subject` cell already renders "NVDA", and the `.verdict` cell rendered "NVDA 价格高于
    // 200" right next to it ("NVDA  NVDA 价格高于 200").
    mockFetch([WATCHING_ALERT], {
      run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
      last_success_state: "READ_OK", outbox: [], outbox_state: "READ_OK_ZERO",
    });
    await mount();
    const watchingList = container.querySelector('[data-alerts-module="watching-list"]');
    expect(watchingList).not.toBeNull();
    // Class names come from a CSS module (hashed at build time) — select structurally by the
    // module's own known DOM shape (WatchingList.tsx: subject cell, then verdict cell) rather
    // than by a class name this test cannot predict.
    const subject = watchingList!.querySelector('[class*="subject"]');
    const verdict = watchingList!.querySelector('[class*="verdict"]');
    expect(subject, "expected the watching-list row's own ticker cell").not.toBeNull();
    expect(verdict, "expected the watching-list row's own verdict cell").not.toBeNull();
    expect(subject!.textContent).toBe("NVDA");
    // The verdict cell must describe ONLY the condition — never re-prefix the ticker the
    // adjacent subject cell already shows.
    expect(verdict!.textContent).not.toContain("NVDA");
    expect(verdict!.textContent).toBe("价格高于 200");
  });

  it("RED-first: the existing-alerts row (.cond) and the drillback dialog (\"条件\") use the SAME ZH phrasing for one price threshold — never 上穿/下穿 in one place and 高于/低于 in the other (minor-4, r9 review)", async () => {
    mockFetch([FIRED_ALERT], {
      run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
      last_success_state: "READ_OK", outbox: SENT_OUTBOX, outbox_state: "READ_OK",
    });
    await mount();

    const condEl = container.querySelector(".arow .cond");
    expect(condEl, "expected the existing-alerts row's condition span").not.toBeNull();
    const condRowText = condEl!.textContent ?? "";
    expect(condRowText).toContain("价格低于");
    expect(condRowText).not.toContain("下穿");
    expect(condRowText).not.toContain("上穿");

    const deliveryRow = container.querySelector('[data-delivery="sent"]') as HTMLElement | null;
    expect(deliveryRow).not.toBeNull();
    await act(async () => { deliveryRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const dialog = container.querySelector('[data-cockpit-state="drillback"]');
    expect(dialog).not.toBeNull();
    const leafWithText = (text: string) =>
      Array.from(dialog!.querySelectorAll("*")).find((el) => el.textContent === text && el.children.length === 0);
    const conditionLabel = leafWithText("条件");
    expect(conditionLabel, 'expected a "条件" label in the drillback dialog').not.toBeUndefined();
    const conditionValue = conditionLabel!.nextElementSibling?.textContent ?? "";
    expect(conditionValue).toContain("价格低于");
    expect(conditionValue).not.toContain("下穿");
    expect(conditionValue).not.toContain("上穿");
  });

  it("RED-first: a numeric-STRING triggered value must still render the ZH price sentence, on both the row note and the drillback dialog — never the false 'no value recorded' disclosure (minor-1, r9 review)", async () => {
    mockFetch([FIRED_ALERT_STRING_VALUE], {
      run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
      last_success_state: "READ_OK", outbox: SENT_OUTBOX_STRING_VALUE, outbox_state: "READ_OK",
    });
    await mount();

    const note = container.querySelector(".arow-note");
    expect(note).not.toBeNull();
    expect(note!.textContent ?? "").toBe("触发时价格 100");
    expect(note!.textContent ?? "").not.toContain("未记录触发价");

    const deliveryRow = container.querySelector('[data-delivery="sent"]') as HTMLElement | null;
    expect(deliveryRow).not.toBeNull();
    await act(async () => { deliveryRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const dialog = container.querySelector('[data-cockpit-state="drillback"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent ?? "").toContain("触发时价格 100");
    expect(dialog!.textContent ?? "").not.toContain("未记录触发价");
  });

  it("no-coverage + zero-rows fixture: CouldNotWatch and the new recent-activity module are English-free on the full composed page, and the new module carries the same moduleHead label treatment as its siblings (minor 3)", async () => {
    mockFetch([WATCHING_ALERT], {
      run: { ...FRESH_RUN, unevaluable_n: 1 }, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
      last_success_state: "READ_OK", outbox: [], outbox_state: "READ_OK_ZERO",
    });
    await mount();
    const noCoverage = container.querySelector('[data-alerts-module="no-coverage"]');
    const activity = container.querySelector('[data-alerts-module="recent-activity"]');
    expect(noCoverage).not.toBeNull();
    expect(activity).not.toBeNull();
    assertNoLeakedEnglish(noCoverage!, "no-coverage module");
    assertNoLeakedEnglish(activity!, "recent-activity (no-coverage, zero rows) module");
    expect(activity!.textContent).toContain("近期活动");
    assertNoLeakedEnglish(container, "no-coverage (full composed page)");
    assertNoDuplicatedConditionTitleAndNote(container, "no-coverage (full composed page)");
  });
});
