/** Server-side source equality only. No action permission, enrollment or lifecycle grant.
 * A matching canonical JSON VALUE fingerprint is not response-byte identity or authentication.
 */
import { createExposureMapReader } from "./exposureMap";
import { exposureValueFingerprint } from "./exposureChartLink";
import type { ExposureLens } from "./exposureMapProjection";
import { isoSession } from "./dte";
import { fnpInstantMicros, frozenNodeTargetFingerprint, type FrozenNodeTarget } from "./optionsAlerts";

export type FrozenNodeSourceRequest = {
  expected: FrozenNodeTarget;
  lens: ExposureLens;
  /** Actual server invocation instant; never defaulted from a source/session label. */
  evaluationAt: string;
};
export type FrozenNodeSourceMatch =
  | { kind: "matched"; target: FrozenNodeTarget }
  | { kind: "missing" }
  | { kind: "unavailable"; reason: string };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const unavailable = (reason: string): FrozenNodeSourceMatch => ({ kind: "unavailable", reason });

function supportedLens(value: unknown): value is ExposureLens {
  if (!object(value)) return false;
  if (value.kind === "one") return Object.keys(value).length === 2 && isoSession(value.exp) !== null;
  return Object.keys(value).length === 1 && typeof value.kind === "string" && ["all", "zero", "ex-zero"].includes(value.kind);
}

function snapshotRequest(request: FrozenNodeSourceRequest): FrozenNodeSourceRequest | null {
  try {
    const pin = structuredClone(request);
    const at = fnpInstantMicros(pin.evaluationAt);
    const available = fnpInstantMicros(pin.expected?.availableAt);
    if (at === null || available === null || available > at || !supportedLens(pin.lens)
      || !isoSession(pin.expected.sourceSession) || !frozenNodeTargetFingerprint(pin.expected)
      || pin.expected.scopeKey !== JSON.stringify([pin.lens.kind, pin.lens.kind === "one" ? pin.lens.exp : null])) return null;
    return pin;
  } catch { return null; }
}

/** Pure composition over one already bounded document, for a dated transport caller and tests.
 * Every selected-price member is derived by the native owner, including missing values.
 * A caller cannot prune a side, change the lens or borrow a current/corrected source.
 */
export async function matchFrozenNodeSource(raw: unknown, request: FrozenNodeSourceRequest): Promise<FrozenNodeSourceMatch> {
  const pin = snapshotRequest(request);
  if (!pin) return unavailable("invalid_source_pin");
  const expected = pin.expected;
  let document: unknown;
  try { document = structuredClone(raw); } catch { return unavailable("document_unreadable"); }
  if (!object(document) || document.schema !== "options_hub.gex/v1" || document.root !== expected.root) {
    return unavailable("document_identity_mismatch");
  }
  const asof = document.asof;
  const documentSession = typeof asof === "string" && (isoSession(asof) || fnpInstantMicros(asof) !== null)
    ? asof.slice(0, 10) : null;
  if (documentSession !== expected.sourceSession) return unavailable("document_session_mismatch");
  let sourceKey: string;
  try {
    // Reuse all incumbent value-count/depth/8MiB bounds. This is the ENTIRE document,
    // never bindCompanionGexComparison's selected values or chart navigation state.
    sourceKey = await exposureValueFingerprint(document);
  } catch { return unavailable("source_fingerprint_unavailable"); }
  if (sourceKey !== expected.sourceKey) return unavailable("source_fingerprint_mismatch");
  const now = Number(fnpInstantMicros(pin.evaluationAt)) / 1000;
  const native = (() => {
    try {
      const reader = createExposureMapReader(document, expected.root, null, new Date(now).toISOString().slice(0, 10), now);
      return { view: reader(pin.lens, "gamma"), reported: reader.reportedGamma(pin.lens) };
    } catch { return null; }
  })();
  if (!native) return unavailable("native_source_unavailable");
  const { view, reported } = native;
  if (!reported || view.state !== "data" || view.qualification !== "dated"
    || reported.sourceSession !== documentSession || reported.root !== expected.root) {
    return unavailable("native_source_unavailable");
  }
  const usable = view.summary.nodes.some(node => node.strike === expected.price
    && typeof node.netMn === "number" && Number.isFinite(node.netMn));
  if (!usable) return unavailable("selected_node_unavailable");
  const members = reported.members.filter(member => member.strike === expected.price)
    .map(({ expiry, strike, right }) => ({ expiry, strike, right }));
  const target: FrozenNodeTarget = {
    root: reported.root, securityId: reported.securityId, sourceSession: reported.sourceSession,
    sourceKey, definitionKey: reported.definitionKey, scopeKey: reported.scopeKey,
    availableAt: reported.availableAt, sourceBinding: reported.sourceBinding,
    members, price: expected.price, qualification: "observed_partial",
  };
  const actualFingerprint = frozenNodeTargetFingerprint(target);
  if (!actualFingerprint || actualFingerprint !== frozenNodeTargetFingerprint(expected)) {
    return unavailable("source_binding_mismatch");
  }
  return { kind: "matched", target };
}
