// Size-bounded projection for the EXISTING chart-state mirror. No fetch, retry or store.
// Preserve command receipts and exact host context; any omitted observation is explicit.
import type { Ack } from "./chartBus";

export const CHART_STATE_SAFE_BYTES = 60 * 1024;
export const CHART_STATE_ACK_BATCH = 32;
export type ChartStatePayload = {
  client: string; origin_id: string; context_revision: number;
  session: Record<string, unknown>; acks: Ack[];
};
export type PreparedChartState =
  | { ok: true; text: string; sentAcks: Ack[]; remainingAcks: Ack[]; sizeUpperBound: number }
  | { ok: false; reason: "chart_state_not_serializable" | "essential_chart_state_too_large" };

/** The server's existing validator measures Python's ASCII-escaped, spaced JSON.
 * Bounding browser UTF-8 alone is insufficient for Chinese labels or emoji.
 * Account for ASCII escaping, separator spaces and a conservative finite-number
 * rendering bound. This is intentionally an upper bound, not a byte-exact codec.
 */
export function chartStateSizeUpperBound(text: string): number {
  const ascii = text.replace(/[\u007f-\uffff]/g, (ch) =>
    "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
  let size = ascii.length + 256; // envelope / serializer headroom
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < ascii.length; i++) {
    const ch = ascii[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ":" || ch === ",") size++;
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      while (i + 1 < ascii.length && /[0-9eE+.\-]/.test(ascii[i + 1])) i++;
      size += Math.max(0, 32 - (i - start + 1));
    }
  }
  return size;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Prepare one batch without mutating host state or discarding unsent acknowledgements.
 * Small snapshots retain their existing wire shape. Under pressure, retain drawing
 * identity/ownership before geometry; keep native evidence where it fits; never
 * truncate an ACK identity, indicator setting, origin or context revision to fit.
 */
export function prepareChartStatePayload(
  input: ChartStatePayload, maxBytes = CHART_STATE_SAFE_BYTES,
): PreparedChartState {
  const session = { ...input.session };
  const allAcks = input.acks;
  let ackCount = Math.min(allAcks.length, CHART_STATE_ACK_BATCH);
  const omittedFields: string[] = [];
  const originalDrawings = Array.isArray(session.drawings) ? session.drawings : [];
  let drawingCoverage: { available: number; returned: number; omitted: number; details_omitted: number } | null = null;
  const putCoverage = () => {
    if (!omittedFields.length && !drawingCoverage && ackCount === allAcks.length) return;
    session.mirror_coverage = {
      schema: "chart.state_coverage.v1", partial: true,
      omitted_fields: [...omittedFields], drawings: drawingCoverage ? { ...drawingCoverage } : null,
      acks_in_batch: ackCount, acks_pending: allAcks.length - ackCount,
      basis: "transport_projection_not_chart_deletion",
    };
  };
  let text = "";
  let sizeUpperBound = Number.POSITIVE_INFINITY;
  const fits = () => {
    putCoverage();
    text = JSON.stringify({ ...input, session, acks: allAcks.slice(0, ackCount) });
    sizeUpperBound = chartStateSizeUpperBound(text);
    return sizeUpperBound <= maxBytes;
  };
  const result = (): PreparedChartState => ({ ok: true, text,
    sentAcks: allAcks.slice(0, ackCount), remainingAcks: allAcks.slice(ackCount), sizeUpperBound });
  const omit = (key: "pane_contexts" | "native_observations" | "data_readout", schema: string) => {
    if (session[key] == null) return;
    session[key] = { schema, status: "unavailable", reason: "chart_state_budget" };
    omittedFields.push(key);
  };
  try {
    if (fits()) return result();

    if (originalDrawings.length) {
      // Every roster row still names its original object and owner. Only the wire
      // projection loses detail; no drawing reducer or user store is touched.
      const roster = originalDrawings.map((row) => {
        if (!object(row)) return {};
        const out: Record<string, unknown> = {};
        for (const key of ["id", "by", "op", "kind"])
          if (typeof row[key] === "string") out[key] = row[key];
        return out;
      });
      session.drawings = roster;
      drawingCoverage = { available: roster.length, returned: roster.length, omitted: 0,
        details_omitted: roster.length };
      if (fits()) return result();
    }

    const capabilities = session.capabilities;
    if (object(capabilities) && capabilities.native_parameters != null) {
      // Keep supported ops, exact-target contract and configured study identities.
      session.capabilities = { ...capabilities, native_parameters: {
        status: "unavailable", reason: "chart_state_budget",
      } };
      omittedFields.push("capabilities.native_parameters");
      if (fits()) return result();
    }

    if (drawingCoverage) {
      const roster = session.drawings as unknown[];
      const setCount = (count: number) => {
        session.drawings = roster.slice(0, count);
        drawingCoverage = { available: roster.length, returned: count, omitted: roster.length - count,
          details_omitted: count };
      };
      setCount(0);
      if (fits()) {
        let low = 0, high = roster.length;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          setCount(mid);
          if (fits()) low = mid; else high = mid - 1;
        }
        setCount(low);
        if (fits()) return result();
      }
    }

    // Cross-pane comparison is useful but subordinate to the active chart and ACKs.
    // Under pressure, withhold it before active-pane native/Data Window evidence.
    omit("pane_contexts", "chart.pane_contexts.v1");
    if (fits()) return result();
    omit("native_observations", "chart.native_live_observations.v1");
    if (fits()) return result();
    omit("data_readout", "chart.data_readout.v1");
    if (fits()) return result();

    // A very large individual ACK must not be silently truncated or skipped. A
    // smaller FIFO prefix can advance; an unfittable first ACK remains retained.
    if (ackCount > 1) {
      let low = 1, high = ackCount;
      ackCount = 1;
      if (fits()) {
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          ackCount = mid;
          if (fits()) low = mid; else high = mid - 1;
        }
        ackCount = low;
        if (fits()) return result();
      }
    }
    return { ok: false, reason: "essential_chart_state_too_large" };
  } catch {
    return { ok: false, reason: "chart_state_not_serializable" };
  }
}
