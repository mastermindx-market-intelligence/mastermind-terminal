import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  __expireEventWorkspaceCacheForTests,
  __resetEventWorkspaceCacheForTests,
  EVENT_WORKSPACE_MANIFEST_SCHEMA,
  EVENT_WORKSPACE_MANIFEST_SCHEMA_V2,
  QA_UNAVAILABLE_TOPIC,
  normalizeEventWorkspace,
  normalizeEventWorkspaceManifest,
  resolveCurrentEventWorkspaceFromR2,
  resolveEventWorkspaceFromR2,
  selectCurrentEventFromAliases,
  transcriptIdFromWorkspace,
} from "@/lib/eventWorkspace";
import { presentEventWorkspace, eventWorkspaceGlanceTitle, eventWorkspaceHasBeatMissLanguage } from "@/lib/eventWorkspacePresent";

const GOLDEN = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/aapl-event-workspace.json"), "utf8"),
) as Record<string, unknown>;
const QA_FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/aapl-qa-exchanges.json"), "utf8"),
) as unknown[];

const FLAGSHIP = "evt_cik0000320193_2026q3_results";
const PRIOR = "evt_cik0000320193_2026q2_results";
const GEN = "f709a0a6ec514282d5769e7d";
const R2 = "https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";

function sha(body: string | Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function workspaceBody(overrides: Record<string, unknown> = {}): { json: unknown; bytes: Uint8Array; hash: string } {
  const payload = { ...GOLDEN, ...overrides };
  const wire = `${JSON.stringify(payload)}\n`;
  const bytes = new TextEncoder().encode(wire);
  return { json: JSON.parse(wire), bytes, hash: sha(bytes) };
}

function manifestFor(workspaces: Array<{ eventId: string; body: ReturnType<typeof workspaceBody>; aliases: string[] }>, generation = GEN) {
  const files: Record<string, { sha256: string; bytes: number }> = {};
  const aliases: Record<string, string> = {};
  for (const row of workspaces) {
    files[`workspaces/${row.eventId}.json`] = { sha256: row.body.hash, bytes: row.body.bytes.byteLength };
    aliases[row.eventId] = row.eventId;
    for (const alias of row.aliases) aliases[alias] = row.eventId;
  }
  return {
    schema: "event_workspace_manifest.v1",
    generation_id: generation,
    generated_at: "2026-07-30T20:30:28Z",
    status: "ready",
    event_count: workspaces.length,
    files,
    aliases,
    authority: "context_only",
    warnings: [],
  };
}

let calls: string[] = [];
let realFetch: typeof globalThis.fetch;

function installR2(upstream: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    calls.push(String(url));
    return upstream(String(url));
  }) as typeof fetch;
}

afterEach(() => {
  __resetEventWorkspaceCacheForTests();
  if (realFetch) globalThis.fetch = realFetch;
  calls = [];
});

describe("selectCurrentEventFromAliases", () => {
  it("picks the greatest AAPL fiscal period from at least two periods", () => {
    const selected = selectCurrentEventFromAliases("AAPL", {
      "AAPL/2026Q2": PRIOR,
      "AAPL/2026Q3": FLAGSHIP,
      "cie_98e318c37ec1a2a1f83c45e1": FLAGSHIP,
    });
    expect("error" in selected).toBe(false);
    if ("error" in selected) return;
    expect(selected.event_id).toBe(FLAGSHIP);
    expect(selected.year).toBe(2026);
    expect(selected.quarter).toBe(3);
    expect(selected.alias).toBe("AAPL/2026Q3");
  });

  it("allows dual-class aliases that resolve to one canonical event", () => {
    const selected = selectCurrentEventFromAliases("GOOG", {
      "GOOG/2026Q3": "evt_cik0001652044_2026q3_results",
      "GOOGL/2026Q3": "evt_cik0001652044_2026q3_results",
    });
    expect("error" in selected).toBe(false);
    if ("error" in selected) return;
    expect(selected.event_id).toBe("evt_cik0001652044_2026q3_results");
  });

  it("fails closed when the same period has two canonical owners", () => {
    const selected = selectCurrentEventFromAliases("AAPL", [
      ["AAPL/2026Q3", FLAGSHIP],
      ["AAPL/2026Q3", "evt_cik0000999999_2026q3_results"],
    ]);
    expect(selected).toEqual({ error: "ambiguous_event" });
  });

  it("does not ask v1 overlay which event is latest", () => {
    const selected = selectCurrentEventFromAliases("AAPL", {
      "AAPL/2025Q4": "evt_cik0000320193_2025q4_results",
      "AAPL/2026Q3": FLAGSHIP,
    });
    if ("error" in selected) throw new Error("expected a selection");
    expect(selected.event_id).toBe(FLAGSHIP);
  });
});

describe("normalizeEventWorkspace golden AAPL", () => {
  it("accepts the production AAPL FY2026 Q3 shape", () => {
    const workspace = normalizeEventWorkspace(GOLDEN, FLAGSHIP, GEN);
    expect(workspace).not.toBeNull();
    expect(workspace?.event_id).toBe(FLAGSHIP);
    expect(workspace?.generation_id).toBe(GEN);
    expect(workspace?.authority).toBe("context_only");
    expect(workspace?.aliases).toEqual([
      "cie_98e318c37ec1a2a1f83c45e1",
      "AAPL/2026Q3",
      "aapl-2026q3-call-record",
    ]);
    expect(workspace?.facts.some((fact) => fact.fact_id === "fact_revenue_gaap" && fact.value === 109417)).toBe(true);
    expect(workspace?.facts.find((fact) => fact.metric === "questions_count")?.typed_absence?.reason).toBe("no_span_addressable_evidence");
    expect(workspace?.deltas.every((delta) => delta.basis_match === false)).toBe(true);
    expect(transcriptIdFromWorkspace(workspace!)).toBe("2026Q3");
  });

  it("refuses beat/miss on a delta", () => {
    const poisoned = {
      ...GOLDEN,
      deltas: [{ ...(GOLDEN.deltas as object[])[0], beat: true }],
    };
    expect(normalizeEventWorkspace(poisoned)).toBeNull();
  });
});

function cloneGolden(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(GOLDEN));
}

function revenueFact(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload.facts as Array<Record<string, unknown>>).find((row) => row.fact_id === "fact_revenue_gaap")!;
}

function firstClaim(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload.claims as Array<Record<string, unknown>>)[0];
}

function asAddressOnly(span: Record<string, unknown>): Record<string, unknown> {
  span.receipt_state = "address_only";
  span.locator = { kind: "table_cell", table: "income", row: 1, column: 2 };
  span.receipt = null;
  span.text_sha256 = null;
  span.unreplayable_reason = "document bytes are not held by this estate";
  return span;
}

describe("normalizeEventWorkspace contract mutations", () => {
  it("rejects a fact with no span and no typed absence", () => {
    const payload = cloneGolden();
    const fact = revenueFact(payload);
    delete fact.source_span;
    delete fact.typed_absence;
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects a claim with no span and no typed absence", () => {
    const payload = cloneGolden();
    const claim = firstClaim(payload);
    delete claim.source_span;
    delete claim.typed_absence;
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects a fact that carries both a span and a typed absence", () => {
    const payload = cloneGolden();
    const fact = revenueFact(payload);
    fact.typed_absence = {
      schema: "typed_absence.v1",
      authority: "context_only",
      reason: "no_span_addressable_evidence",
      subject: "revenue",
      detail: "both present",
      event_id: FLAGSHIP,
      document_id: null,
      missing_fields: [],
    };
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects a byte_replayed span with no receipt", () => {
    const payload = cloneGolden();
    (revenueFact(payload).source_span as Record<string, unknown>).receipt = null;
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects a byte_replayed span with a missing receipt key", () => {
    const payload = cloneGolden();
    const receipt = (revenueFact(payload).source_span as Record<string, unknown>).receipt as Record<string, unknown>;
    delete receipt.segment_sha256;
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects a span whose text_sha disagrees with its receipt", () => {
    const payload = cloneGolden();
    (revenueFact(payload).source_span as Record<string, unknown>).text_sha256 = "c".repeat(64);
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects a span whose locator bytes disagree with its receipt", () => {
    const payload = cloneGolden();
    const span = revenueFact(payload).source_span as Record<string, unknown>;
    (span.locator as Record<string, unknown>).span_start_byte = 0;
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects address_only that still carries a receipt", () => {
    const payload = cloneGolden();
    const span = asAddressOnly(revenueFact(payload).source_span as Record<string, unknown>);
    span.receipt = {
      source_sha256: "d".repeat(64),
      segment_index: 0,
      segment_sha256: "e".repeat(64),
      segment_bytes: 10,
      span_start_byte: 0,
      span_end_byte: 1,
      text_sha256: "f".repeat(64),
    };
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects address_only that still carries text_sha", () => {
    const payload = cloneGolden();
    const span = asAddressOnly(revenueFact(payload).source_span as Record<string, unknown>);
    span.text_sha256 = "a".repeat(64);
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects address_only without unreplayable_reason", () => {
    const payload = cloneGolden();
    const span = asAddressOnly(revenueFact(payload).source_span as Record<string, unknown>);
    span.unreplayable_reason = "";
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects an unknown typed-absence reason", () => {
    const payload = cloneGolden();
    const questions = (payload.facts as Array<Record<string, unknown>>).find((row) => row.metric === "questions_count")!;
    (questions.typed_absence as Record<string, unknown>).reason = "made_up_reason";
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });

  it("rejects a typed absence for a different event_id", () => {
    const payload = cloneGolden();
    const questions = (payload.facts as Array<Record<string, unknown>>).find((row) => row.metric === "questions_count")!;
    (questions.typed_absence as Record<string, unknown>).event_id = PRIOR;
    expect(normalizeEventWorkspace(payload)).toBeNull();
  });
});

describe("presentEventWorkspace", () => {
  it("formats the golden AAPL glance from payload values, never overlay 14 or beat/miss", () => {
    const workspace = normalizeEventWorkspace(GOLDEN, FLAGSHIP, GEN)!;
    const presented = presentEventWorkspace(workspace);
    expect(eventWorkspaceGlanceTitle(presented)).toBe("AAPL · Q3 FY2026 · 30 Jul");
    expect(presented.plane).toBe("event_workspace.v1");
    expect(presented.event_id).toBe(FLAGSHIP);
    expect(presented.reported[0]?.value).toMatch(/\$109\.4B/);
    expect(presented.reported[0]?.value).toMatch(/\+16%/);
    expect(presented.guidance[0]?.value).toBe("9–11%");
    expect(presented.guidance[0]?.label).toMatch(/Q4/);
    expect(presented.watch.some((item) => /100-year flood/.test(item.value))).toBe(true);
    expect(presented.watch.some((item) => /two and a half percentage points/.test(item.value))).toBe(true);
    expect(presented.honest.questions_count_unavailable).toBe(true);
    expect(presented.honest.consensus_unlicensed).toBe(true);
    expect(presented.honest.slides_absent).toBe(true);
    expect(presented.honest.reaction_not_joined).toBe(true);
    expect(presented.honest.no_beat_miss).toBe(true);
    expect(presented.facts.find((item) => item.id === "fact_questions_count")?.value).toBe("Unavailable / unstructured");
    const glance = [presented.reported, presented.guidance, presented.watch, presented.facts, presented.deltas]
      .flat()
      .map((item) => `${item.label} ${item.value}`)
      .join("\n");
    expect(glance).not.toMatch(/\b14\b/);
    expect(eventWorkspaceHasBeatMissLanguage(glance)).toBe(false);
    expect(presented.watch.some((item) => /remarkably better than we thought/.test(item.value))).toBe(true);
    expect(presented.sources.some((source) => source.label.includes("Exhibit 99.1") && source.receipt_state === "byte_replayed")).toBe(true);
    expect(presented.sources.some((source) => source.kind === "transcript" && source.transcript_id === "2026Q3")).toBe(true);
    expect(presented.transcript_id).toBe("2026Q3");
    expect(presented.reported[0]?.evidence.receipt_state).toBe("byte_replayed");
    expect(presented.guidance[0]?.evidence.receipt_state).toBe("byte_replayed");
    expect(presented.facts.find((item) => item.id === "fact_questions_count")?.evidence.typed_absence?.reason)
      .toBe("no_span_addressable_evidence");
    expect(presented.completeness.find((item) => item.id === "completeness:consensus")?.evidence.typed_absence?.reason)
      .toBe("missing_source");
    expect(presented.completeness.find((item) => item.id === "completeness:reaction")?.evidence.receipt_state)
      .toBe("status_only");
    expect(presented.completeness.find((item) => item.id === "completeness:reaction")?.evidence.typed_absence)
      .toBeNull();
    const presentedAbsences = [
      ...presented.reported, ...presented.guidance, ...presented.watch, ...presented.facts, ...presented.deltas, ...presented.completeness,
    ].map((item) => item.evidence.typed_absence?.reason).filter((reason): reason is string => Boolean(reason));
    const workspaceAbsenceReasons = [
      ...workspace.facts.map((fact) => fact.typed_absence?.reason),
      ...workspace.claims.map((claim) => claim.typed_absence?.reason),
      ...workspace.guidance.map((item) => item.typed_absence?.reason),
      workspace.completeness.consensus.typed_absence?.reason,
      workspace.completeness.slides.typed_absence?.reason,
      workspace.completeness.reaction.typed_absence?.reason,
    ].filter((reason): reason is string => Boolean(reason));
    expect(presentedAbsences.every((reason) => workspaceAbsenceReasons.includes(reason))).toBe(true);
  });

  it("does not borrow a present public_wire address onto reaction:not_joined", () => {
    const payload = cloneGolden();
    const sources = payload.sources as Array<Record<string, unknown>>;
    const wire = sources.find((row) => row.kind === "public_wire");
    expect(wire).toBeDefined();
    delete wire!.typed_absence;
    wire!.receipt_state = "address_only";
    wire!.document_id = "wire_doc_should_not_bind_reaction";
    wire!.url = "https://example.com/wire-address";
    const workspace = normalizeEventWorkspace(payload, FLAGSHIP, GEN);
    expect(workspace).not.toBeNull();
    const presented = presentEventWorkspace(workspace!);
    const reaction = presented.completeness.find((item) => item.id === "completeness:reaction");
    expect(reaction?.value).toBe("not joined");
    expect(reaction?.evidence.receipt_state).toBe("status_only");
    expect(reaction?.evidence.typed_absence).toBeNull();
    expect(reaction?.evidence.document_id).not.toBe("wire_doc_should_not_bind_reaction");
    expect(reaction?.evidence.source_url).not.toBe("https://example.com/wire-address");
    expect(presented.sources.find((source) => source.kind === "public_wire")?.receipt_state).toBe("address_only");
  });
});

describe("resolveCurrentEventWorkspaceFromR2", () => {
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });

  it("follows marker → immutable generation → receipt and selects AAPL/2026Q3 over an earlier period", async () => {
    const q3 = workspaceBody();
    const q2 = workspaceBody({
      event_id: PRIOR,
      generation_id: GEN,
      aliases: ["AAPL/2026Q2"],
      fiscal_period: { year: 2026, quarter: 2, calendar_end: "2026-03-28" },
    });
    const manifest = manifestFor([
      { eventId: PRIOR, body: q2, aliases: ["AAPL/2026Q2"] },
      { eventId: FLAGSHIP, body: q3, aliases: ["AAPL/2026Q3", "cie_98e318c37ec1a2a1f83c45e1", "aapl-2026q3-call-record"] },
    ]);
    installR2((url) => {
      if (url.endsWith("/event_workspaces/manifest.json") || url.includes(`/generations/${GEN}/manifest.json`)) {
        return jsonResponse(manifest);
      }
      if (url.endsWith(`/workspaces/${FLAGSHIP}.json`)) return bytesResponse(q3.bytes);
      if (url.endsWith(`/workspaces/${PRIOR}.json`)) return bytesResponse(q2.bytes);
      return new Response("missing", { status: 404 });
    });
    const result = await resolveCurrentEventWorkspaceFromR2("AAPL", R2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event_id).toBe(FLAGSHIP);
    expect(result.workspace.generation_id).toBe(GEN);
    expect(result.receipt.workspace_sha256).toBe(q3.hash);
    expect(calls.some((url) => url.includes("/company_intelligence/event_workspaces/manifest.json"))).toBe(true);
    expect(calls.some((url) => url.includes(`/generations/${GEN}/manifest.json`))).toBe(true);
  });

  it("advances a corrected generation without changing event identity", async () => {
    const first = workspaceBody();
    const correctedGen = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const second = workspaceBody({ generation_id: correctedGen, lifecycle: { ...(GOLDEN.lifecycle as object), state: "corrected" } });
    const firstManifest = manifestFor([{ eventId: FLAGSHIP, body: first, aliases: ["AAPL/2026Q3"] }]);
    const secondManifest = manifestFor([{ eventId: FLAGSHIP, body: second, aliases: ["AAPL/2026Q3"] }], correctedGen);
    let generation = GEN;
    installR2((url) => {
      const manifest = generation === GEN ? firstManifest : secondManifest;
      const body = generation === GEN ? first : second;
      if (url.endsWith("/event_workspaces/manifest.json") || url.includes("/manifest.json")) return jsonResponse(manifest);
      if (url.endsWith(`/workspaces/${FLAGSHIP}.json`)) return bytesResponse(body.bytes);
      return new Response("missing", { status: 404 });
    });
    const before = await resolveEventWorkspaceFromR2(FLAGSHIP, R2);
    expect(before.ok && before.workspace.generation_id).toBe(GEN);
    __resetEventWorkspaceCacheForTests();
    generation = correctedGen;
    const after = await resolveEventWorkspaceFromR2(FLAGSHIP, R2);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.event_id).toBe(FLAGSHIP);
    expect(after.workspace.generation_id).toBe(correctedGen);
    expect(after.workspace.lifecycle.state).toBe("corrected");
  });

  it("does not follow redirects or fetch v1 overlay", async () => {
    installR2((url) => {
      if (url.includes("score_overlay") || url.includes("/companies/")) {
        throw new Error("v1 overlay must not be fetched");
      }
      return new Response(null, { status: 302, headers: { location: "https://example.com/x" } });
    });
    const result = await resolveCurrentEventWorkspaceFromR2("AAPL", R2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });

  it("returns last-good as stale when the marker becomes unavailable", async () => {
    const q3 = workspaceBody();
    const manifest = manifestFor([{ eventId: FLAGSHIP, body: q3, aliases: ["AAPL/2026Q3"] }]);
    let live = true;
    installR2((url) => {
      if (!live) return new Response("down", { status: 503 });
      if (url.endsWith("/event_workspaces/manifest.json") || url.includes(`/generations/${GEN}/manifest.json`)) {
        return jsonResponse(manifest);
      }
      if (url.endsWith(`/workspaces/${FLAGSHIP}.json`)) return bytesResponse(q3.bytes);
      return new Response("missing", { status: 404 });
    });
    const first = await resolveCurrentEventWorkspaceFromR2("AAPL", R2);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state).toBe("ready");
    __expireEventWorkspaceCacheForTests();
    live = false;
    const second = await resolveCurrentEventWorkspaceFromR2("AAPL", R2);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state).toBe("stale");
    expect(second.event_id).toBe(FLAGSHIP);
    expect(second.workspace.generation_id).toBe(GEN);
  });
});

describe("E3-B manifest v2 and canonical Q&A", () => {
  it("still accepts a v1 manifest", () => {
    const q3 = workspaceBody();
    const manifest = manifestFor([{ eventId: FLAGSHIP, body: q3, aliases: ["AAPL/2026Q3"] }]);
    const normalized = normalizeEventWorkspaceManifest(manifest);
    expect(normalized?.schema).toBe(EVENT_WORKSPACE_MANIFEST_SCHEMA);
    expect(normalized?.previous_generation_id).toBeUndefined();
  });

  it("accepts a v2 manifest with predecessor fields", () => {
    const q3 = workspaceBody();
    const manifest = {
      ...manifestFor([{ eventId: FLAGSHIP, body: q3, aliases: ["AAPL/2026Q3"] }]),
      schema: EVENT_WORKSPACE_MANIFEST_SCHEMA_V2,
      previous_generation_id: "aa".repeat(12),
      previous_manifest_sha256: "bb".repeat(32),
    };
    const normalized = normalizeEventWorkspaceManifest(manifest);
    expect(normalized?.schema).toBe(EVENT_WORKSPACE_MANIFEST_SCHEMA_V2);
    expect(normalized?.previous_generation_id).toBe("aa".repeat(12));
  });

  it("rejects a v2 manifest with only one predecessor field", () => {
    const q3 = workspaceBody();
    const manifest = {
      ...manifestFor([{ eventId: FLAGSHIP, body: q3, aliases: ["AAPL/2026Q3"] }]),
      schema: EVENT_WORKSPACE_MANIFEST_SCHEMA_V2,
      previous_generation_id: "aa".repeat(12),
      previous_manifest_sha256: null,
    };
    expect(normalizeEventWorkspaceManifest(manifest)).toBeNull();
  });

  it("rejects unknown manifest keys", () => {
    const q3 = workspaceBody();
    const manifest = {
      ...manifestFor([{ eventId: FLAGSHIP, body: q3, aliases: ["AAPL/2026Q3"] }]),
      extra: true,
    };
    expect(normalizeEventWorkspaceManifest(manifest)).toBeNull();
  });

  it("accepts the seven-exchange AAPL fixture and preserves respondent turns", () => {
    const payload = cloneGolden();
    payload.qa_exchanges = JSON.parse(JSON.stringify(QA_FIXTURE));
    const workspace = normalizeEventWorkspace(payload, FLAGSHIP, GEN);
    expect(workspace).not.toBeNull();
    expect(workspace?.qa_exchanges).toHaveLength(7);
    expect(workspace?.qa_exchanges.reduce((n, item) => n + item.question_spans.length, 0)).toBe(32);
    expect(workspace?.qa_exchanges.reduce((n, item) => n + item.answer_spans.length, 0)).toBe(36);
    expect(workspace?.qa_exchanges.reduce((n, item) => n + item.respondents.length, 0)).toBe(26);
    expect(workspace?.qa_exchanges.every((item) => item.topics[0] === QA_UNAVAILABLE_TOPIC)).toBe(true);
    expect(workspace?.qa_exchanges[0]?.respondents.map((row) => row.name)).toEqual([
      "Kevan Parekh",
      "Tim Cook",
      "Tim Cook",
    ]);
  });

  it("drops malformed Q&A without failing the workspace", () => {
    const payload = cloneGolden();
    const exchanges = JSON.parse(JSON.stringify(QA_FIXTURE)) as Array<Record<string, unknown>>;
    exchanges[0].extra = "nope";
    payload.qa_exchanges = exchanges;
    const workspace = normalizeEventWorkspace(payload, FLAGSHIP, GEN);
    expect(workspace).not.toBeNull();
    expect(workspace?.qa_exchanges).toEqual([]);
    expect(workspace?.facts.length).toBeGreaterThan(0);
  });

  it("drops Q&A bound to the wrong event without failing E2", () => {
    const payload = cloneGolden();
    const exchanges = JSON.parse(JSON.stringify(QA_FIXTURE)) as Array<Record<string, unknown>>;
    exchanges[0].event_id = PRIOR;
    payload.qa_exchanges = exchanges;
    const workspace = normalizeEventWorkspace(payload, FLAGSHIP, GEN);
    expect(workspace?.qa_exchanges).toEqual([]);
  });

  it("drops a substantive topic without failing the workspace", () => {
    const payload = cloneGolden();
    const exchanges = JSON.parse(JSON.stringify(QA_FIXTURE)) as Array<Record<string, unknown>>;
    exchanges[0].topics = ["demand"];
    payload.qa_exchanges = exchanges;
    expect(normalizeEventWorkspace(payload, FLAGSHIP, GEN)?.qa_exchanges).toEqual([]);
  });

  it("rejects a present malformed source clock instead of omitting it", () => {
    const payload = cloneGolden();
    const sources = payload.sources as Array<Record<string, unknown>>;
    const transcript = sources.find((row) => row.kind === "transcript")!;
    transcript.source_clock = {
      schema: "event_source_clock.v1",
      document_id: transcript.document_id ?? "tx:AAPL/2026Q3",
      source_sha256: transcript.source_sha256,
      source_available_at: null,
      system_recorded_at: "2026-08-16T18:00:00Z",
      clock_state: "unknown",
      rights_profile: "rp_public_primary_v1",
      session_phase: "unknown",
    };
    const kept = normalizeEventWorkspace(payload, FLAGSHIP, GEN);
    expect(kept?.sources.find((row) => row.kind === "transcript")?.source_clock?.clock_state).toBe("unknown");
    transcript.source_clock = { ...transcript.source_clock as object, extra: true };
    expect(normalizeEventWorkspace(payload, FLAGSHIP, GEN)).toBeNull();
  });

  it("still accepts a clockless transcript source", () => {
    const payload = cloneGolden();
    const sources = payload.sources as Array<Record<string, unknown>>;
    const transcript = sources.find((row) => row.kind === "transcript")!;
    expect(transcript.source_clock).toBeUndefined();
    expect(normalizeEventWorkspace(payload, FLAGSHIP, GEN)).not.toBeNull();
  });

  it("drops Q&A whose document SHA does not match the transcript revision", () => {
    const payload = cloneGolden();
    const exchanges = JSON.parse(JSON.stringify(QA_FIXTURE)) as Array<Record<string, unknown>>;
    exchanges[0].document_sha256 = "cd".repeat(32);
    exchanges[0].exchange_id = `qx_${FLAGSHIP}_${"cd".repeat(6)}_00`;
    payload.qa_exchanges = exchanges;
    const workspace = normalizeEventWorkspace(payload, FLAGSHIP, GEN);
    expect(workspace).not.toBeNull();
    expect(workspace?.qa_exchanges).toEqual([]);
  });

  it("drops Q&A when unknown provenance carries an availability timestamp", () => {
    const payload = cloneGolden();
    const exchanges = JSON.parse(JSON.stringify(QA_FIXTURE)) as Array<Record<string, unknown>>;
    const provenance = exchanges[0].provenance as Record<string, unknown>;
    provenance.source_available_at = "2026-07-30T20:30:28Z";
    payload.qa_exchanges = exchanges;
    expect(normalizeEventWorkspace(payload, FLAGSHIP, GEN)?.qa_exchanges).toEqual([]);
  });

  it("drops Q&A when a span receipt SHA does not match the exchange document SHA", () => {
    const payload = cloneGolden();
    const exchanges = JSON.parse(JSON.stringify(QA_FIXTURE)) as Array<Record<string, unknown>>;
    const spans = exchanges[0].question_spans as Array<Record<string, unknown>>;
    const receipt = spans[1].receipt as Record<string, unknown>;
    receipt.source_sha256 = "cd".repeat(32);
    payload.qa_exchanges = exchanges;
    expect(normalizeEventWorkspace(payload, FLAGSHIP, GEN)?.qa_exchanges).toEqual([]);
  });

  it("binds accepted Q&A to a present transcript clock", () => {
    const payload = cloneGolden();
    const exchanges = JSON.parse(JSON.stringify(QA_FIXTURE)) as Array<Record<string, unknown>>;
    const sources = payload.sources as Array<Record<string, unknown>>;
    const transcript = sources.find((row) => row.kind === "transcript")!;
    transcript.source_clock = {
      schema: "event_source_clock.v1",
      document_id: transcript.document_id,
      source_sha256: transcript.source_sha256,
      source_available_at: "2026-07-30T20:30:28Z",
      system_recorded_at: "2026-08-16T18:00:00Z",
      clock_state: "known",
      rights_profile: "rp_public_primary_v1",
      session_phase: "unknown",
    };
    payload.qa_exchanges = exchanges;
    expect(normalizeEventWorkspace(payload, FLAGSHIP, GEN)?.qa_exchanges).toEqual([]);
    for (const item of exchanges) {
      const provenance = item.provenance as Record<string, unknown>;
      provenance.clock_state = "known";
      provenance.source_available_at = "2026-07-30T20:30:28Z";
    }
    payload.qa_exchanges = exchanges;
    const matched = normalizeEventWorkspace(payload, FLAGSHIP, GEN);
    expect(matched?.qa_exchanges).toHaveLength(7);
    expect(matched?.qa_exchanges[0]?.provenance.clock_state).toBe("known");
  });

  it("presents seven exchanges without operator speech or unavailable topic chips", () => {
    const payload = cloneGolden();
    payload.qa_exchanges = JSON.parse(JSON.stringify(QA_FIXTURE));
    const workspace = normalizeEventWorkspace(payload, FLAGSHIP, GEN)!;
    const presented = presentEventWorkspace(workspace);
    expect(presented.honest.questions_count_unavailable).toBe(false);
    expect(presented.facts.find((item) => item.id === "fact_questions_count")).toBeUndefined();
    const first = workspace.qa_exchanges[0]!;
    const visible = first.question_spans
      .filter((span) => span.locator.speaker?.toLowerCase() !== "operator")
      .map((span) => span.display_excerpt ?? "")
      .join(" ");
    expect(visible.toLowerCase()).not.toContain("we will go ahead and take our first question");
    expect(first.respondents.filter((row) => row.name === "Tim Cook")).toHaveLength(2);
    expect(presented.completeness.some((item) => item.id === "fact_questions_count")).toBe(false);
  });
});


function jsonResponse(body: unknown): Response {
  const wire = JSON.stringify(body);
  return new Response(wire, { status: 200, headers: { "content-type": "application/json" } });
}

function bytesResponse(bytes: Uint8Array): Response {
  const copy = new Uint8Array(bytes);
  return new Response(copy, { status: 200, headers: { "content-type": "application/json" } });
}

