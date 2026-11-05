/** MO-PAID-027 adapter inside the existing suite_alerts lane. No scheduler or sender.
 * Public discovery is independent of private membership. Only the established R2
 * reader's hash-verified immutable workspaces become event inputs; generation
 * publication time is never an event clock. Activation is an explicit CLI opt-in.
 */
import { createHash } from "node:crypto";
import { normalizeEventWorkspaceManifest, resolveEventWorkspaceFromR2, type EventWorkspace } from "../terminal/lib/eventWorkspace";
import { R2_BASE } from "../terminal/lib/upstreams";
import type { foldHeldPositions } from "./heldPositionFold";

type Position = ReturnType<typeof foldHeldPositions>["positions"][number];
export const HELD_SOURCE = "terminal.held_material_event.v1";
// A report older than three calendar days is coverage debt, never a fresh fire.
export const HELD_EVENT_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const ROOT = `${R2_BASE}/company_intelligence/event_workspaces`;
export interface HeldOutboxRow {
  user_id: string; alert_id: null; fire_event_id: string;
  channel: "email"; status: "pending"; payload: {
    source: typeof HELD_SOURCE; category: "holdings_material_change"; authority: "notification_only";
    ticker: string; event_id: string; source_asof: string; event_time: string; recorded_at: string;
    fired_at: string; subject: string; subject_zh: string;
    summary_plain: string; summary_plain_zh: string; evidence_url: string;
    source_generation: string; source_revision: string;
    requires_tier: "essential"; condition_plain: string; condition_plain_zh: string;
    corrects?: { lane: "suite_alerts"; id: string } | null;
  };
}

/** Discovery bytes only choose bounded public IDs. The existing resolver separately
 * qualifies marker/immutable-manifest equality, object size/SHA and schema. Never
 * pass an unverified preloaded manifest to that resolver. No holding is an input.
 */
export async function loadHeldPublicEvents(): Promise<EventWorkspace[]> {
  const signal = AbortSignal.timeout(30_000);
  const response = await fetch(`${ROOT}/manifest.json`, { signal, cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("held_source_unavailable");
  const text = await response.text();
  if (Buffer.byteLength(text) > 512_000) throw new Error("held_source_over_limit");
  const manifest = normalizeEventWorkspaceManifest(JSON.parse(text));
  if (!manifest || manifest.status !== "ready") throw new Error("held_source_not_ready");
  const files = Object.keys(manifest.files).sort();
  if (files.length === 0 || files.length > 100) throw new Error("held_source_no_coverage");
  const events: EventWorkspace[] = [];
  for (const file of files) {
    const match = /^workspaces\/(evt_[a-z0-9_]+)\.json$/.exec(file);
    if (!match) throw new Error("held_source_invalid_identity");
    const result = await resolveEventWorkspaceFromR2(match[1], R2_BASE, { signal });
    if (!result.ok || result.state !== "ready" || result.workspace.generation_id !== manifest.generation_id) continue;
    // An unverified issuer never enters the private join. Holders without a
    // verified current event are explicitly unevaluable; another issuer's broken
    // object does not invalidate an independently verified issuer's receipt.
    events.push(result.workspace);
  }
  if (events.length === 0) throw new Error("held_source_unverified");
  return events;
}

function clock(value: string | null): number {
  return value && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

/** Native completeness binds an SEC filing key, rather than a present/absent
 * document flag. Keep the binding on the same issuer and canonical event. */
function hasBoundNativeFiling(event: EventWorkspace): boolean {
  const filing = event.completeness.filing;
  const key = filing.filing_key;
  return filing.status === "bound" && key != null && /^\d{10}$/.test(key.cik) &&
    /^\d{10}-\d{2}-\d{6}$/.test(key.accession) &&
    event.issuer.company_id === `cik:${key.cik}` && event.event_id.startsWith(`evt_cik${key.cik}_`);
}

/** Global lane receipts may expose only a public, membership-independent clock. */
export function heldPublicSourceAsof(events: readonly EventWorkspace[]): string | null {
  const clocks = events.map(event => clock(event.lifecycle.source_available_at)).filter(Number.isFinite);
  return clocks.length ? new Date(Math.min(...clocks)).toISOString() : null;
}

export function planHeldMaterialEvents(positions: readonly Position[], events: readonly EventWorkspace[], now: number) {
  const rows: HeldOutboxRow[] = [];
  let unevaluable = 0;
  let evaluated = 0;
  let sourceAsof: string | null = null;
  for (const position of positions) {
    if (position.status !== "open") continue;
    const matches = events.filter((event) => event.issuer.listings.some((listing) =>
      listing.ticker === position.ticker && listing.is_primary && listing.valid_to === null &&
      Number.isFinite(Date.parse(listing.valid_from ?? "")) && Date.parse(listing.valid_from ?? "") <= clock(event.lifecycle.source_available_at)));
    if (matches.length === 0) { unevaluable++; continue; }
    let covered = false;
    const seen = new Set<string>();
    for (const event of matches) {
      const available = clock(event.lifecycle.source_available_at);
      const observed = clock(event.lifecycle.observed_at);
      if (!event.event_id.endsWith("_results") || event.authority !== "context_only" || !["complete", "corrected"].includes(event.lifecycle.state) ||
          !hasBoundNativeFiling(event) || event.completeness.release.status !== "present" ||
          !Number.isFinite(now) || !Number.isFinite(available) || !Number.isFinite(observed) || observed < available ||
          observed > now || available > now || now - available > HELD_EVENT_MAX_AGE_MS) continue;
      covered = true;
      const asof = new Date(available).toISOString();
      if (!sourceAsof || asof < sourceAsof) sourceAsof = asof;
      // No historical backfill for a newly opened holding. An older still-open lot
      // remains the fold's ownership floor; no prices/shares/notes enter the join.
      if (available < Date.parse(position.firstHeldAt)) continue;
      const revision = `${event.lifecycle.state}:${asof}:${new Date(observed).toISOString()}`;
      const identity = JSON.stringify([HELD_SOURCE, position.userId, event.event_id, revision]);
      const fire = `held:${createHash("sha256").update(identity).digest("hex")}`;
      if (seen.has(fire)) continue;
      seen.add(fire);
      const corrected = event.lifecycle.state === "corrected";
      const summary = corrected ? "Published company results were corrected. Review the source; no trade action is implied." : "New company results are available. Review the source; no trade action is implied.";
      const summaryZh = corrected ? "已发布的公司业绩有更正。请查看来源；这不代表交易指令。" : "公司发布了新业绩。请查看来源；这不代表交易指令。";
      rows.push({ user_id: position.userId, alert_id: null, fire_event_id: fire, channel: "email", status: "pending", payload: {
        source: HELD_SOURCE, category: "holdings_material_change", authority: "notification_only",
        ticker: position.ticker, event_id: event.event_id, source_asof: asof,
        event_time: new Date(observed).toISOString(), recorded_at: new Date(now).toISOString(), fired_at: new Date(observed).toISOString(),
        subject: `${position.ticker}: company results ${corrected ? "corrected" : "published"}`,
        subject_zh: `${position.ticker}：公司业绩${corrected ? "已更正" : "已发布"}`,
        summary_plain: summary, summary_plain_zh: summaryZh,
        evidence_url: `${ROOT}/generations/${event.generation_id}/workspaces/${event.event_id}.json`,
        source_generation: event.generation_id, source_revision: revision,
        requires_tier: "essential", condition_plain: summary, condition_plain_zh: summaryZh,
      } });
    }
    if (covered) evaluated++; else unevaluable++;
  }
  return { rows, evaluated, unevaluable, sourceAsof };
}
