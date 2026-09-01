import { describe, expect, it, vi } from "vitest";
import {
  bindMastermindBrainCompanySource,
  openMastermindBrainForCompanySource,
  type MastermindBrainHost,
} from "@/lib/mastermindBrain";
import type { CompanySourceContextRef } from "@/lib/companySourceContext";

const SOURCE_REF: CompanySourceContextRef = {
  schema: "mastermind.research-context-ref/v1",
  kind: "company_source_span",
  authority: "context_only",
  ticker: "NVDA",
  event_id: "cie_rctx_2026q1",
  transcript_id: "2026Q1",
  revision_id: "rctx_revision_2026q1",
  document_sha256: "2".repeat(64),
  segment_index: 7,
  start_byte: 144,
  end_byte: 173,
  segment_text_sha256: "3".repeat(64),
  span_id: `txs1_${"1".repeat(64)}`,
};

describe("exact company-source Brain handoff", () => {
  it("keeps the newer owner through stale cleanup and opens only with an attached getter", () => {
    const open = vi.fn();
    const host: MastermindBrainHost = { MM_BRAIN_CFG: {}, MMBrain: { open } };
    const releaseOlder = bindMastermindBrainCompanySource(() => ({ span_id: "older" } as never), host);
    const releaseNewer = bindMastermindBrainCompanySource(() => ({ span_id: "newer" } as never), host);

    releaseOlder?.();
    expect(host.MM_BRAIN_CFG?.getCompanySourceSpan?.()).toEqual({ span_id: "newer" });
    expect(openMastermindBrainForCompanySource("nvda", host)).toBe(true);
    expect(host.__MM_BRAIN_ACTIVE_SYMBOL__).toBe("NVDA");
    expect(open).toHaveBeenCalledOnce();

    releaseNewer?.();
    expect(host.MM_BRAIN_CFG?.getCompanySourceSpan).toBeUndefined();
    expect(openMastermindBrainForCompanySource("nvda", host)).toBe(false);
    expect(openMastermindBrainForCompanySource("nvda", {
      MM_BRAIN_CFG: { getCompanySourceSpan: () => ({ span_id: "bound" } as never) },
    })).toBe(false);
  });

  it("returns one attachment only on the first Brain send capture and disarms it", () => {
    const onConsume = vi.fn();
    const host: MastermindBrainHost = { MM_BRAIN_CFG: {}, MMBrain: { open: vi.fn() } };
    const release = bindMastermindBrainCompanySource(() => SOURCE_REF, host, onConsume);

    expect(openMastermindBrainForCompanySource("nvda", host)).toBe(true);
    expect(onConsume).not.toHaveBeenCalled();

    expect(host.MM_BRAIN_CFG?.getCompanySourceSpan?.()).toEqual(SOURCE_REF);
    expect(onConsume).toHaveBeenCalledOnce();
    expect(host.MM_BRAIN_CFG?.getCompanySourceSpan?.()).toBeUndefined();
    expect(onConsume).toHaveBeenCalledOnce();

    release?.();
  });
});
