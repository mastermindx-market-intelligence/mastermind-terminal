import "server-only";
import { BILLING_BASE } from "@/app/api/billing/gateway";
import { checkFrozenNodeAccount, FROZEN_NODE_COMMERCIAL_DECISION, FROZEN_NODE_ACCOUNT_POLICY } from "./frozenNodeAccountPolicy";
import { resolveFrozenNodeSource, type FrozenNodeSourceRequest } from "./frozenNodeSourceResolver";
import { FNP_ADMITTED_ACTION, fnpInstantMicros, frozenNodeTargetFingerprint, type FrozenNodeAdmissionContext } from "./optionsAlerts";
import type { FrozenNodeFetcher } from "./frozenNodeSource";

export { FROZEN_NODE_COMMERCIAL_DECISION, FROZEN_NODE_ACCOUNT_POLICY } from "./frozenNodeAccountPolicy";
/** This is deliberately NOT a complete evaluator admission: only the protected
 * lifecycle RPC may add createdAt, armingEpoch and priorState. */
export type FrozenNodeSourceActionContext = Pick<FrozenNodeAdmissionContext, "principal" | "action" | "evaluationAt" | "target" | "rights"> & {
  rights_decision_ref: typeof FROZEN_NODE_COMMERCIAL_DECISION;
};
export type FrozenNodeSourceActionResult =
  | { kind: "admitted"; context: FrozenNodeSourceActionContext }
  | { kind: "missing" }
  | { kind: "denied" | "unavailable"; reason: string };
/** Supabase Auth's existing exact-token methods. Implementations are server
 * capabilities, never condition fields, request JSON or an allowed=true callback. */
export type FrozenNodeSessionAuth = {
  getSession: () => Promise<{ data: { session: { access_token: string } | null }; error: unknown }>;
  getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }>;
};
export type FrozenNodeSourceActionDependencies = {
  auth: FrozenNodeSessionAuth;
  accountFetcher: FrozenNodeFetcher;
  sourceTransport: Parameters<typeof resolveFrozenNodeSource>[1];
  /** Actual current server invocation instant, not a condition/source date. */
  clock: () => string;
};

function cleanup(action: () => unknown): void {
  try { void Promise.resolve(action()).catch(() => {}); } catch { /* best effort */ }
}
async function bounded<T>(operation: () => Promise<T>, ms: number, onLate?: (value: T) => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const work = Promise.resolve().then(operation).then(value => {
    if (expired) { if (onLate) cleanup(() => onLate(value)); throw new Error("account_deadline"); }
    return value;
  });
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("account_deadline")); }, ms);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Uncached read from the incumbent /api/me owner, using precisely the Auth-verified bearer.
 * No ambient fetch, client Authorization, redirects or alternate account backend. */
async function readAccount(token: string, fetcher: FrozenNodeFetcher): Promise<unknown> {
  const url = `${BILLING_BASE}/api/me`;
  const controller = new AbortController();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const end = performance.now() + 4_000;
  const active = () => { if (performance.now() >= end) throw new Error("account_deadline"); };
  try {
    return await bounded(async () => {
      const fetched = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store", redirect: "error", signal: controller.signal });
      if (controller.signal.aborted || performance.now() >= end) {
        if (fetched.body) cleanup(() => fetched.body!.cancel());
        throw new Error("account_deadline");
      }
      response = fetched;
      active();
      if (!response.ok || response.redirected || response.url !== url || !response.body) throw new Error("account_response_unavailable");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^[0-9]+$/.test(length) || length.trim() !== length || Number(length) > 65_536)) throw new Error("account_response_size");
      reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      while (true) {
        active();
        const part = await reader.read();
        active();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw new Error("account_response_bytes");
        size += part.value.byteLength;
        if (size > 65_536) throw new Error("account_response_size");
        parts.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }, 4_000);
  } finally {
    controller.abort();
    if (reader) { const held = reader; cleanup(() => held.cancel()); cleanup(() => held.releaseLock()); }
    else if (response?.body) { const body = response.body; cleanup(() => body.cancel()); }
  }
}

/** Opt-in source composition only: no route/default reader, service credential,
 * lifecycle read/write, enrollment, state commit, outbox or send is installed here.
 * A future interactive caller can supply its existing createClient().auth. A
 * background Python evaluator still needs an independently qualified service
 * account-read bridge; a row user_id is not a verified interactive principal. */
export async function readFrozenNodeSourceAction(
  request: Omit<FrozenNodeSourceRequest, "evaluationAt"> & { principal: string },
  dependencies: FrozenNodeSourceActionDependencies,
): Promise<FrozenNodeSourceActionResult> {
  const unavailable = (reason: string): FrozenNodeSourceActionResult => ({ kind: "unavailable", reason });
  try {
    // Full immutable request snapshot before ANY auth/source await. Extra grant,
    // lifecycle and evaluation-clock fields in caller JSON are not consumed.
    const pin = structuredClone({ expected: request.expected, lens: request.lens, principal: request.principal });
    const at = dependencies.clock();
    if (fnpInstantMicros(at) === null || !frozenNodeTargetFingerprint(pin.expected)) return unavailable("invalid_source_action_pin");
    if (!dependencies.auth || typeof dependencies.accountFetcher !== "function") return unavailable("account_reader_unavailable");
    const session = await bounded(() => dependencies.auth.getSession(), 5_000);
    const token = !session.error && session.data.session?.access_token;
    if (typeof token !== "string" || !token) return { kind: "denied", reason: "unauthenticated" };
    const userRead = await bounded(() => dependencies.auth.getUser(token), 5_000);
    if (userRead.error || !userRead.data.user) return { kind: "denied", reason: "unauthenticated" };
    // Snapshot the server observation before another dependency can mutate it.
    const user = structuredClone(userRead.data.user);
    const me = await readAccount(token, dependencies.accountFetcher);
    const account = checkFrozenNodeAccount(user, me, pin.principal, at);
    if (account.kind !== "eligible") return account;
    const source = await resolveFrozenNodeSource({ expected: pin.expected, lens: pin.lens, evaluationAt: at }, dependencies.sourceTransport);
    if (source.kind !== "matched") return source;
    return { kind: "admitted", context: {
      principal: account.principal, action: FNP_ADMITTED_ACTION, evaluationAt: at, target: source.target,
      rights: { allowed: true, policy_version: FROZEN_NODE_ACCOUNT_POLICY, checked_at: at },
      rights_decision_ref: FROZEN_NODE_COMMERCIAL_DECISION,
    } };
  } catch { return unavailable("source_action_reader_unavailable"); }
}
