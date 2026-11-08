// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import EvidenceRail, { type CompanyEvidenceSelection } from "@/components/fin/EvidenceRail";
import type { CompanyIntelligenceEvent } from "@/lib/companyIntelligence";
import type { EventWorkspaceEvidenceView } from "@/lib/eventWorkspacePresent";

const locale = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => locale }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const metrics = {
  sentiment: null, performance: null, confidence: null, combined: null,
  call_positivity: null, management_confidence: null, analyst_criticism: null,
  future_outlook: null, revenue_growth_pct: null, eps_growth_pct: null,
  gross_margin_pct: null, analysts_count: null, questions_count: null,
};
// Explicit synthetic metadata only: no event read, rights receipt or source bytes.
const event: CompanyIntelligenceEvent = {
  event_id: "fixture-event", ticker: "ACME", fiscal_year: 2026, fiscal_quarter: 3,
  call_date: "2026-07-31", summary: null, highlights: [], positive_highlights: [],
  negative_highlights: [], key_quote: null, tags: [], metrics, previous_event_deltas: metrics,
  field_lineage: { summary: null, key_quote: null, metrics: { ...metrics },
    positive_highlights: [], negative_highlights: [], highlights: [], tags: {} },
  sources: [], claim_citations_pending: true,
};
let root: Root, host: HTMLDivElement;
const close = vi.fn();
beforeEach(() => {
  locale.lang = "en"; close.mockReset(); host = document.createElement("div");
  document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(state: EventWorkspaceEvidenceView["receipt_state"], status = "not joined") {
  const v2: EventWorkspaceEvidenceView = {
    receipt_state: state, excerpt: null, document_id: null, document_label: "Fixture source",
    speaker: null, role: null, segment_index: null, span_start_byte: null, span_end_byte: null,
    text_sha256: null, source_sha256: null, source_clock: null, typed_absence: null,
    transcript_id: null, source_url: null, status_label: status,
  };
  const evidence: CompanyEvidenceSelection = {
    id: "fixture-completeness", kind: "metric", label: "Coverage", text: "Fixture status",
    source: null, v2,
  };
  await act(async () => root.render(<EvidenceRail event={event} evidence={evidence}
    open overlay={false} onClose={close} onOpenTranscript={vi.fn()} />));
  return host.querySelector<HTMLElement>(".ci-receipt-card")!;
}
it.each(["en", "zh"] as const)("labels producer completeness as status only in %s, preserving its recorded status", async lang => {
  locale.lang = lang;
  for (const status of ["present", "bound", "not joined"]) {
    const receipt = await render("status_only", status);
    expect(receipt.dataset.ciReceiptState).toBe("status_only");
    expect(receipt.querySelector(".ci-receipt-row b")?.textContent).toBe(lang === "zh" ? "仅状态" : "Status only");
    expect(receipt.textContent).not.toContain(lang === "zh" ? "类型化缺项" : "Typed absence");
    expect(receipt.querySelector(".ci-evidence-note")?.textContent).toContain(status);
    expect(receipt.querySelector(".ci-evidence-note")?.textContent).toContain(lang === "zh" ? "这不是逐行引用" : "This is not a line citation");
  }
});
it.each(["en", "zh"] as const)("preserves the three source receipt labels and ordinary close action in %s", async lang => {
  locale.lang = lang;
  for (const [state, en, zh] of [
    ["byte_replayed", "Byte-replayed", "字节回放"],
    ["address_only", "Address only", "仅地址"],
    ["typed_absence", "Typed absence", "类型化缺项"],
  ] as const) {
    const receipt = await render(state);
    expect(receipt.dataset.ciReceiptState).toBe(state);
    expect(receipt.querySelector(".ci-receipt-row b")?.textContent).toBe(lang === "zh" ? zh : en);
  }
  await act(async () => host.querySelector<HTMLButtonElement>(".ci-evidence-close")!.click());
  expect(close).toHaveBeenCalledTimes(1);
});
