// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReportedOwnershipPanel from "@/components/fin/ReportedOwnershipPanel";
import OwnershipPage from "@/components/fin/OwnershipPage";
import { LangProvider } from "@/lib/i18n";
import type { Fund } from "@/lib/fund";
import { contentDigestInput, sha256Hex, type ReportedOwnershipBlock } from "@/lib/reportedOwnership";
import blockFixture from "./fixtures/reported_ownership/ca_block.json";
import * as ownershipReader from "@/lib/reportedOwnership";
const realVerify = ownershipReader.verifyReportedOwnership;
let verificationWork: Promise<unknown>[] = [];


(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Only the CI network call is controlled. The reported block itself is validated by the real reader,
// so these tests exercise the actual fail-closed path rather than a stubbed one.
const ciState = { ok: true as boolean, latest_event: null as unknown };
vi.mock("@/lib/companyIntelligence", () => ({
  getCompanyIntelligence: async () =>
    ciState.ok
      ? { ok: true, state: "ok", context: { generation_id: "gen-1", latest_event_id: "ev-1", latest_event: null } }
      : { ok: false, state: "error", error: { code: "not_found", message: "x", retryable: false } },
}));

function block(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(blockFixture)) as Record<string, unknown>;
}

// The panel validates against the real clock, so these tests use a timeline that is unambiguously
// in the past. The golden fixture keeps the collector's own timestamps — shifting them here keeps
// the cross-language golden intact while making the UI suite independent of when it runs.
const PAST_ACQUIRED = "2026-10-02T04:52:16Z";
const PAST_ATTEMPT = "2026-10-05T09:00:00Z";

// The panel stamps Date.now() at verification and discloses staleness after 30 days, so the
// fixtures are dated relative to this pinned day rather than the day the suite happens to run.
const PINNED_NOW = "2026-10-15T12:00:00Z";

/** Typed accessors so the draft can be mutated one field at a time without `any`. */
function rowsOf(draft: Record<string, unknown>): Record<string, unknown>[] {
  return draft.rows as Record<string, unknown>[];
}
function rowZero(draft: Record<string, unknown>): Record<string, unknown> {
  return rowsOf(draft)[0];
}

async function sealed(mutate?: (draft: Record<string, unknown>) => void): Promise<ReportedOwnershipBlock> {
  const draft = block();
  draft.acquired_at = PAST_ACQUIRED;
  draft.latest_attempt_at = PAST_ACQUIRED;
  mutate?.(draft);
  draft.content_sha256 = await sha256Hex(contentDigestInput(draft));
  return draft as unknown as ReportedOwnershipBlock;
}

/** A fund carrying only what the panel is allowed to read, plus a populated legacy `top_inst`. */
async function fundWith(reported: unknown, legacy: { name: string }[] = [{ name: "Legacy Top Inst Name" }]): Promise<Fund> {
  return {
    schema: "mastermind.fund/v1",
    ticker: "RY.TO",
    ownership: {
      free_float_pct: null,
      closely_held_pct: null,
      top_inst: legacy.map((holder) => ({ name: holder.name, pct: 5.07, value: null })),
      reported: reported as ReportedOwnershipBlock | null,
    },
  } as unknown as Fund;
}

let node: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Fake only Date: the file awaits real WebCrypto digests and spies on crypto.subtle, so timers
  // and microtasks must stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(PINNED_NOW));
  verificationWork = [];
  vi.spyOn(ownershipReader, "verifyReportedOwnership").mockImplementation((...args) => {
    const work = realVerify(...args);
    verificationWork.push(work);
    return work;
  });
  node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
  ciState.ok = true;
  // LangProvider reads the document attribute on mount, so the language is set, not passed.
  document.documentElement.setAttribute("data-lang", "en");
});

afterEach(() => {
  act(() => root.unmount());
  node.remove();
  document.documentElement.setAttribute("data-lang", "en");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(element: React.ReactNode, lang: "en" | "zh" = "en") {
  document.documentElement.setAttribute("data-lang", lang);
  await act(async () => {
    root.render(<LangProvider>{element}</LangProvider>);
  });
  // Await the real WebCrypto/reader promises inside act; an event-loop tick is not completion.
  await act(async () => { await Promise.all(verificationWork); });
  return node;
}

function text(): string {
  return node.textContent ?? "";
}

// ── available rows ───────────────────────────────────────────────────────────
describe("reported ownership panel", () => {
  it("renders the provider's rows with dates, shares and derived percentages", async () => {
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(node.querySelector("[data-reported-ownership]")).toBeTruthy();
    expect(text()).toContain("Reported institutional holders");
    expect(text()).toContain("Royal Bank of Canada");
    expect(text()).toContain("2026-06-30");
    expect(text()).toContain("70,220,631");
    expect(text()).toContain("5.07%");
    expect(node.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("keeps each row's own reporting date rather than one date for the table", async () => {
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("2026-03-31");
    expect(text()).toContain("2026-06-30");
  });

  it("shows the fixed source label and the retrieval date", async () => {
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("Source");
    expect(text()).toContain("Retrieved");
    expect(text()).toContain(PAST_ACQUIRED.slice(0, 10));
    const link = node.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://finance.yahoo.com/quote/RY.TO/holders/");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("states that the denominator is unspecified and that these are not the 13F roster", async () => {
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("does not specify the percentage denominator");
    expect(text()).toContain("separate from the tracked 13F roster");
  });

  it("renders an em dash for a missing share count or percentage, never a zero", async () => {
    const fund = await fundWith(
      await sealed((d) => {
        rowZero(d).shares = null;
        rowZero(d).reported_fraction = null;
      }),
    );
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    const rendered = node.querySelector("tbody tr");
    expect(rendered?.textContent).toContain("—");
    expect(rendered?.textContent).not.toContain("0%");
  });

  it("bounds the table so it scrolls instead of widening the document", async () => {
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    const table = node.querySelector("table");
    expect(table).toBeTruthy();
    expect(table?.parentElement).toBeTruthy();
    // The scroll container is the table's parent; nothing forces a fixed min-width.
    expect(node.querySelector("[style*='min-width']")).toBeNull();
  });
});

// ── absence, degraded and rejected states ────────────────────────────────────
describe("absence and degraded states", () => {
  it("renders an explicit unavailable reason when no block was published", async () => {
    const fund = await fundWith(null);
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("Reported holdings unavailable");
    expect(text()).toContain("No reported-holder record has been published");
    expect(node.querySelector("[data-reported-ownership-state]")?.getAttribute("data-reported-ownership-state")).toBe(
      "absent",
    );
  });

  it("never falls back to the legacy undated top_inst field", async () => {
    const fund = await fundWith(null, [{ name: "Legacy Top Inst Name" }, { name: "Another Legacy Holder" }]);
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).not.toContain("Legacy Top Inst Name");
    expect(text()).not.toContain("Another Legacy Holder");
    expect(node.querySelector("tbody")).toBeNull();
  });

  it("shows retained rows plus an honest status when a later refresh failed", async () => {
    const retained = await sealed((d) => {
      d.availability = "partial";
      d.unavailable_reason = "fetch_field_error";
      d.latest_attempt_at = PAST_ATTEMPT;
    });
    const fund = await fundWith(retained);
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    // Rows are kept...
    expect(text()).toContain("Royal Bank of Canada");
    expect(node.querySelectorAll("tbody tr")).toHaveLength(3);
    // ...with the ORIGINAL acquisition date, not the later attempt that failed.
    expect(text()).toContain(PAST_ACQUIRED.slice(0, 10));
    expect(text()).not.toContain(PAST_ATTEMPT.slice(0, 10));
    expect(node.querySelector("[data-reported-ownership-state]")?.getAttribute("data-reported-ownership-state")).toBe(
      "partial",
    );
    expect(text()).toContain("could not be read on the latest attempt");
  });

  it("says so when some provider records were dropped", async () => {
    const fund = await fundWith(
      await sealed((d) => {
        d.availability = "partial";
        d.unavailable_reason = "rows_dropped_unqualified";
      }),
    );
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("valid identity, date, or consistent observation");
  });

  it("shows the block's own reason when it carries no rows", async () => {
    const fund = await fundWith(
      await sealed((d) => {
        d.availability = "unavailable";
        d.unavailable_reason = "no_dated_rows";
        d.rows = [];
        d.acquired_at = null;
        d.latest_attempt_at = null;
        d.raw_input_sha256 = null;
      }),
    );
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("Reported holdings unavailable");
    expect(text()).toContain("no dated institutional-holder records");
  });

  it("fails closed on a corrupted content hash and renders no rows", async () => {
    const corrupted = block();
    corrupted.content_sha256 = "0".repeat(64);
    const fund = await fundWith(corrupted);
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).not.toContain("Royal Bank of Canada");
    expect(node.querySelector("tbody")).toBeNull();
    expect(text()).toContain("did not pass its own checks");
    expect(node.querySelector("[data-reported-ownership-state]")?.getAttribute("data-reported-ownership-state")).toBe(
      "rejected",
    );
  });

  it("fails closed on a block addressed to a different listing", async () => {
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="SHOP.TO" fund={fund} />);
    expect(text()).not.toContain("Royal Bank of Canada");
    expect(node.querySelector("tbody")).toBeNull();
  });

  it("handles an absent fund and an absent loading flag", async () => {
    await render(<ReportedOwnershipPanel ticker="RY.TO" />);
    expect(text()).toContain("Reported holdings unavailable");
  });

  it("handles an explicit null fund while loading without inventing rows", async () => {
    const pending = render(<ReportedOwnershipPanel ticker="RY.TO" fund={null} loading />);
    await pending;
    expect(node.querySelector("tbody")).toBeNull();
  });
});

// ── staleness disclosure ────────────────────────────────────────────────────
describe("staleness disclosure", () => {
  it("discloses a block whose acquisition is older than the configured threshold", async () => {
    const fund = await fundWith(
      await sealed((d) => {
        d.acquired_at = "2026-08-01T04:52:16Z";
        d.latest_attempt_at = "2026-08-01T04:52:16Z";
      }),
    );
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("30-day disclosure threshold");
  });

  it("does not treat an old REPORT date as staleness on a fresh acquisition", async () => {
    // The fixture's report dates are months old while its acquisition is recent. A provider that
    // simply has not filed this quarter is not a broken feed, and must not be flagged as one.
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("2026-03-31");
    expect(text()).not.toContain("disclosure threshold");
  });

  it("leaves an unknown acquisition date unknown and undisclosed", async () => {
    const fund = await fundWith(
      await sealed((d) => {
        d.acquired_at = null;
        d.latest_attempt_at = null;
      }),
    );
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />);
    expect(text()).toContain("Unknown");
    expect(text()).not.toContain("disclosure threshold");
  });
});

// ── rapid symbol switching ──────────────────────────────────────────────────
describe("rapid symbol switching", () => {
  it("never renders the previous symbol's rows under the new one", async () => {
    const ryFund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={ryFund} />);
    expect(text()).toContain("Royal Bank of Canada");

    // Switch to a listing whose fund has not arrived yet.
    await act(async () => {
      root.render(
        <LangProvider>
          <ReportedOwnershipPanel ticker="SHOP.TO" fund={null} />
        </LangProvider>,
      );
    });
    // Synchronously after the switch the old rows must already be gone.
    expect(text()).not.toContain("Royal Bank of Canada");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(text()).not.toContain("Royal Bank of Canada");
    expect(node.querySelector("tbody")).toBeNull();
  });

  it("drops an in-flight verification when the symbol changes under it", async () => {
    const ryFund = await fundWith(await sealed());
    let resolveDigest: (value: string) => void = () => {};
    const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((async (
      algorithm: AlgorithmIdentifier,
      data: BufferSource,
    ) => {
      if (spy.mock.calls.length === 1) {
        await new Promise<string>((resolve) => {
          resolveDigest = resolve;
        });
      }
      return realDigest(algorithm as "SHA-256", data);
    }) as typeof globalThis.crypto.subtle.digest);

    act(() => {
      root.render(
        <LangProvider>
          <ReportedOwnershipPanel ticker="RY.TO" fund={ryFund} />
        </LangProvider>,
      );
    });
    // Move to another listing while the first digest is still outstanding.
    await act(async () => {
      root.render(
        <LangProvider>
          <ReportedOwnershipPanel ticker="SHOP.TO" fund={null} />
        </LangProvider>,
      );
    });
    await act(async () => {
      resolveDigest("0".repeat(64));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(text()).not.toContain("Royal Bank of Canada");
    expect(node.querySelector("tbody")).toBeNull();
    spy.mockRestore();
  });
});

// ── localization ─────────────────────────────────────────────────────────────
describe("localization", () => {
  it("renders the Chinese panel copy without leaking English strings", async () => {
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />, "zh");
    expect(text()).toContain("来源披露机构持有人");
    expect(text()).toContain("持有人");
    expect(text()).toContain("报告日期");
    expect(text()).toContain("股数");
    expect(text()).toContain("披露比例");
    expect(text()).toContain("数据供应商未说明该比例的分母");
    // Holder names and dates are data, not chrome, so they stay as the provider stated them.
    expect(text()).toContain("Royal Bank of Canada");
    expect(text()).toContain("2026-06-30");
  });

  it("renders the Chinese unavailable copy and its reason", async () => {
    const fund = await fundWith(null);
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />, "zh");
    expect(text()).toContain("暂无来源披露持仓");
    expect(text()).toContain("尚未发布来源披露机构持有人记录");
  });

  it("keeps the English view free of Chinese copy", async () => {
    const fund = await fundWith(await sealed());
    await render(<ReportedOwnershipPanel ticker="RY.TO" fund={fund} />, "en");
    expect(text()).toContain("Reported institutional holders");
    expect(text()).not.toContain("来源披露");
    expect(text()).not.toContain("数据供应商");
  });
});

// ── OwnershipPage routing ────────────────────────────────────────────────────
describe("OwnershipPage routing", () => {
  it("renders the reported panel above the verified surface for a regional listing", async () => {
    const fund = await fundWith(await sealed());
    await render(<OwnershipPage sym="RY.TO" fund={fund} />);
    expect(node.querySelector("[data-reported-ownership]")).toBeTruthy();
    expect(text()).toContain("Royal Bank of Canada");
  });

  it("keeps the US view exactly as it was, with no reported panel", async () => {
    await render(<OwnershipPage sym="AAPL" fund={await fundWith(await sealed())} />);
    expect(node.querySelector("[data-reported-ownership]")).toBeNull();
    expect(text()).not.toContain("Reported institutional holders");
    // The verified-13F surface is still what renders for US.
    expect(text()).toContain("OWNERSHIP · INSTITUTIONAL");
  });

  it("renders the panel for a CN listing so absence is explicit", async () => {
    await render(<OwnershipPage sym="600519.SS" fund={null} />);
    expect(node.querySelector("[data-reported-ownership]")).toBeTruthy();
    expect(text()).toContain("Reported holdings unavailable");
  });

  it("compiles and renders without a fund prop, as the current callsite does", async () => {
    await render(<OwnershipPage sym="0700.HK" />);
    expect(node.querySelector("[data-reported-ownership]")).toBeTruthy();
    expect(node.querySelector("[data-ownership-page]") ?? node.querySelector("section")).toBeTruthy();
  });

  it("keeps the two snapshots independent: invalid CI does not hide a qualified reported block", async () => {
    ciState.ok = false;
    const fund = await fundWith(await sealed());
    await render(<OwnershipPage sym="RY.TO" fund={fund} />);
    // The reported rows are still there even though the CI call failed...
    expect(text()).toContain("Royal Bank of Canada");
    expect(text()).toContain("5.07%");
    // ...and the CI failure is still reported on its own surface.
    expect(text()).toContain("Ownership context unavailable");
  });

  it("keeps the two snapshots independent: a qualified reported block does not rescue invalid CI", async () => {
    ciState.ok = false;
    const fund = await fundWith(await sealed());
    await render(<OwnershipPage sym="RY.TO" fund={fund} />);
    expect(text()).toContain("Ownership context unavailable");
    expect(text()).not.toContain("No verified company-event pin yet");
  });

  it("shows a reported block while CI is valid and unverified-13F states stay gated as before", async () => {
    const fund = await fundWith(await sealed());
    await render(<OwnershipPage sym="RY.TO" fund={fund} />);
    expect(text()).toContain("Royal Bank of Canada");
    // This fixture has latest_event: null, so the CI side keeps its original "no pin yet" gating.
    expect(text()).toContain("No verified company-event pin yet");
  });
});