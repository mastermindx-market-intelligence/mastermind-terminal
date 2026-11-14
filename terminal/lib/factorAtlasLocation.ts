/** Pure URL-state codec for the existing Factor Atlas read-only preview.
 * This is presentation state only: no authority, source, entitlement, or
 * persisted portfolio preference is conveyed by a URL parameter.
 */
import type { HistoryWindowRequest } from "./factorAtlasHistory";

export interface FactorLocationState {
  valid: boolean;
  explicit: boolean;
  reason: "INVALID_FACTOR_LINK" | null;
  selection: string[];
  window: HistoryWindowRequest;
}

const SELECTION_PARAM = "faFactor";
const START_PARAM = "faStart";
const END_PARAM = "faEnd";
const LIMIT = 8;

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validWindow(value: HistoryWindowRequest): boolean {
  return date(value.anchorDate) && date(value.endDate) && value.anchorDate < value.endDate;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128
    && !/[\x00-\x1f\x7f]/.test(value);
}

export function decodeFactorLocation(
  search: string,
  eligibleIds: readonly string[],
  defaultSelection: readonly string[],
  defaultWindow: HistoryWindowRequest,
): FactorLocationState {
  const invalid = (): FactorLocationState => ({
    valid: false, explicit: true, reason: "INVALID_FACTOR_LINK",
    selection: [], window: { ...defaultWindow },
  });
  if (typeof search !== "string" || search.length > 8192
    || !Array.isArray(eligibleIds) || !validWindow(defaultWindow)) return invalid();
  const eligible = new Set(eligibleIds);
  if (eligible.size !== eligibleIds.length) return invalid();
  const params = new URLSearchParams(search);
  const explicit = params.has(SELECTION_PARAM) || params.has(START_PARAM) || params.has(END_PARAM);
  if (!explicit) {
    const selected = defaultSelection.filter(id => eligible.has(id)).slice(0, LIMIT);
    return { valid: true, explicit: false, reason: null, selection: [...new Set(selected)], window: { ...defaultWindow } };
  }
  if (!params.has(SELECTION_PARAM) || params.getAll(START_PARAM).length !== 1
    || params.getAll(END_PARAM).length !== 1) return invalid();
  const ids = params.getAll(SELECTION_PARAM);
  const selection = ids.length === 1 && ids[0] === "" ? [] : ids;
  if (selection.length > LIMIT || new Set(selection).size !== selection.length
    || selection.some(id => !validId(id) || !eligible.has(id))) return invalid();
  const window = { anchorDate: params.get(START_PARAM) ?? "", endDate: params.get(END_PARAM) ?? "" };
  if (!validWindow(window)) return invalid();
  return { valid: true, explicit: true, reason: null, selection: selection.slice(), window };
}

export function encodeFactorLocation(
  previousSearch: string,
  selection: readonly string[],
  window: HistoryWindowRequest,
): string {
  if (typeof previousSearch !== "string" || previousSearch.length > 8192
    || !Array.isArray(selection) || selection.length > LIMIT
    || new Set(selection).size !== selection.length || selection.some(id => !validId(id))
    || !validWindow(window)) throw new Error("INVALID_FACTOR_URL_STATE");
  const params = new URLSearchParams(previousSearch);
  params.delete(SELECTION_PARAM);
  params.delete(START_PARAM);
  params.delete(END_PARAM);
  for (const id of selection.length ? selection : [""]) params.append(SELECTION_PARAM, id);
  params.set(START_PARAM, window.anchorDate);
  params.set(END_PARAM, window.endDate);
  return "?" + params.toString();
}
