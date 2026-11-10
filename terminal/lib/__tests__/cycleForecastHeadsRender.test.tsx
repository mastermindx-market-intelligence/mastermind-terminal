// @vitest-environment jsdom
/**
 * Render-level gates for the per-head forecast capabilities card (v1.1),
 * converted from the independent reviewer's probes P2, P6, P10 and note N3.
 * A reason code is NEVER used as a bare object key on the render path: a
 * hostile or unknown code (`__proto__`, `constructor`, `toString`, a
 * caller-supplied withdraw() reason) must render the generic line — never
 * crash the route, never render nothing, never dump the raw code.
 * FIXTURE wire shapes throughout (they mirror the producer, they are not
 * producer output).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";

import CycleForecastHeads from "@/components/sector-intelligence/cycles/CycleForecastHeads";
import { forecastHeadsReading } from "@/lib/sectorCycleForecastHeads";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROTOCOL = "research/sector_completion_20261021/B12_V11_HEADS_PROTOCOL.md";
const REPORT = "research/sector_completion_20261021/b12/v11_heads_result.json";
const RESULTS = "research/sector_completion_20261021/B12_V11_HEADS_RESULTS.md";

const head = (over: Record<string, unknown> = {}) => ({
  status: "withheld",
  reason_code: "live_state_not_protocol_epoch",
  research_disposition: "QUALIFIED_RESEARCH",
  research_reasons: [],
  evidence: { protocol: PROTOCOL, report_ref: REPORT, results_doc: RESULTS },
  target: "what this head measures",
  horizon_sessions: 20,
  market: "US",
  ...over,
});

/** head_capabilities(record_kind="sector", turn_epoch=None) exactly. */
const producerBlock = (over: Record<string, unknown> = {}) => ({
  schema: "sector_cycles.forecast_heads.v1",
  observed_cycles: "shown",
  protocol: PROTOCOL,
  report_ref: REPORT,
  heads: {
    remaining_return_distribution: head({
      reason_code: "research_withheld_failed",
      research_disposition: "WITHHELD_FAILED",
      research_reasons: ["skill_ci90_includes_or_below_zero"],
    }),
    adverse_tail: head(),
    target_before_invalidation: head(),
    transition_time: head(),
    ...over,
  },
  may_rank: false,
  may_gate: false,
  may_size: false,
  may_trade: false,
  may_escalate: false,
});

function renderCard(block: unknown): { text: string; rowText: (key: string) => string } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  document.documentElement.setAttribute("data-lang", "en");
  let root: Root | null = null;
  act(() => {
    root = createRoot(el);
    root.render(
      <LangProvider>
        <CycleForecastHeads reading={forecastHeadsReading({ forecast_heads: block })} />
      </LangProvider>,
    );
  });
  // Capture everything BEFORE unmount — unmount clears the element.
  const text = el.textContent ?? "";
  const rows = new Map<string, string>();
  for (const key of ["remaining_return_distribution", "adverse_tail", "target_before_invalidation", "transition_time"]) {
    rows.set(key, el.querySelector(`[data-head="${key}"]`)?.textContent ?? "");
  }
  act(() => root!.unmount());
  el.remove();
  return { text, rowText: (key: string) => rows.get(key) ?? "" };
}

describe("CycleForecastHeads render (reviewer probes P2/P6/P10/N3 permanent)", () => {
  it("B1: inherited-key and unknown reason codes render the generic line — no crash, no empty line, no raw code", () => {
    for (const code of ["__proto__", "constructor", "toString", "hasOwnProperty", "parity_lost", "totally_new_code"]) {
      const { text, rowText } = renderCard(
        producerBlock({ adverse_tail: head({ reason_code: code }) }),
      );
      // No uncaught render error: the row exists and carries the generic line.
      expect(rowText("adverse_tail"), code).toContain("Withheld for an unstated reason");
      // The raw code is never dumped to the reader.
      expect(text, code).not.toContain(code);
      // Objects/functions from the prototype chain never reach React children.
      expect(text, code).toContain("Adverse tail");
      // Siblings keep their own mapped lines.
      expect(rowText("remaining_return_distribution")).toContain(
        "the research test failed this forecast",
      );
    }
  });

  it("B1: a non-string reason code also renders the generic line", () => {
    const { rowText } = renderCard(producerBlock({ adverse_tail: head({ reason_code: 42 }) }));
    expect(rowText("adverse_tail")).toContain("Withheld for an unstated reason");
  });

  it("S1: the producer's withdraw() output renders as withheld with the generic line — no Withdrawn/Qualified state, siblings intact", () => {
    // withdraw(block, "adverse_tail", "parity_lost"): status stays "withheld".
    const { text, rowText } = renderCard(
      producerBlock({ adverse_tail: head({ reason_code: "parity_lost" }) }),
    );
    expect(rowText("adverse_tail")).toContain("Withheld for an unstated reason");
    // No dated-withdrawal or qualified state exists on this wire.
    expect(text).not.toContain("Withdrawn");
    expect(text).not.toContain("Qualified");
    // SP10: the withdrawn head's siblings and the observed facts remain.
    expect(rowText("remaining_return_distribution")).toContain(
      "the research test failed this forecast",
    );
    expect(rowText("target_before_invalidation")).toContain("does not match the research protocol");
    // No number for any head.
    expect(text).not.toContain("%");
  });

  it("N3: the leg-direction note rides the target head only, never transition time", () => {
    const { rowText } = renderCard(producerBlock());
    expect(rowText("target_before_invalidation")).toContain("Leg-direction fact");
    expect(rowText("transition_time")).not.toContain("Leg-direction fact");
    expect(rowText("remaining_return_distribution")).not.toContain("Leg-direction fact");
    expect(rowText("adverse_tail")).not.toContain("Leg-direction fact");
  });

  it("N4: a payload_invalid head renders its contract-mismatch line, never an implied qualified forecast", () => {
    const { rowText } = renderCard(
      producerBlock({ transition_time: head({ status: "qualified" }) }),
    );
    expect(rowText("transition_time")).toContain("did not match its published contract");
    expect(rowText("transition_time")).not.toContain("Qualified");
  });
});
