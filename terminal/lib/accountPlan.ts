/**
 * accountPlan.ts — the shape of the billing authority's account payload, in ONE place.
 *
 * `GET /api/me` is piped through verbatim by app/api/me/route.ts, so tier, status,
 * current_period_end, source, interval and chat_budget all arrive as the authority sent them.
 * Both the entitlement store (lib/entitlementStore.ts) and the settings panel's section props
 * describe that payload, and they used to describe it twice — the settings copy typed the
 * metered lanes and the store's copy did not, which is exactly the kind of drift that makes one
 * reader accept a body the other rejects.
 *
 * Free of React, Supabase and DOM imports: a pure contract module.
 */

/** One metered lane as reported by the Brain gateway / `chat_budget`. */
export interface AccountLane {
  remaining?: number;
  /** < 0 = uncapped · 0 = not included on this tier · > 0 = a real cap. */
  limit?: number;
  period?: string;
}

export interface AccountQuotas {
  fast?: AccountLane;
  pro?: AccountLane;
}

/** `GET /api/me` — the billing gateway's entitlement payload. */
export interface AccountPlan {
  tier?: string;
  status?: string;
  features?: string[];
  current_period_end?: string | null;
  /** 'stripe' | 'comp' | … — a non-Stripe source has no portal to open. */
  source?: string | null;
  interval?: string | null;
  chat_budget?: AccountQuotas | null;
}

/** `GET /api/brain/me` — the canonical usage view. A SEPARATE authority from the plan. */
export interface AccountUsage {
  tier?: string;
  quotas?: AccountQuotas;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function parseLane(raw: unknown): AccountLane | undefined {
  if (!isObj(raw)) return undefined;
  const lane: AccountLane = {};
  if (typeof raw.remaining === "number") lane.remaining = raw.remaining;
  if (typeof raw.limit === "number") lane.limit = raw.limit;
  if (typeof raw.period === "string") lane.period = raw.period;
  return lane;
}

export function parseQuotas(raw: unknown): AccountQuotas | null {
  if (!isObj(raw)) return null;
  const quotas: AccountQuotas = {};
  const fast = parseLane(raw.fast);
  const pro = parseLane(raw.pro);
  if (fast) quotas.fast = fast;
  if (pro) quotas.pro = pro;
  return quotas;
}

/** Narrow an untrusted `/api/me` body. Never throws; unknown fields are dropped, not coerced. */
export function parseAccountPlan(raw: unknown): AccountPlan {
  const d = isObj(raw) ? raw : {};
  return {
    tier: typeof d.tier === "string" ? d.tier : "free",
    status: typeof d.status === "string" ? d.status : "none",
    features: Array.isArray(d.features) ? d.features.filter((v): v is string => typeof v === "string") : [],
    current_period_end: typeof d.current_period_end === "string" ? d.current_period_end : null,
    source: typeof d.source === "string" ? d.source : null,
    interval: typeof d.interval === "string" ? d.interval : null,
    chat_budget: parseQuotas(d.chat_budget),
  };
}

/** Narrow an untrusted `/api/brain/me` body. */
export function parseAccountUsage(raw: unknown): AccountUsage {
  const d = isObj(raw) ? raw : {};
  return {
    tier: typeof d.tier === "string" ? d.tier : undefined,
    quotas: parseQuotas(d.quotas) ?? undefined,
  };
}
