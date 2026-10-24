/** Prerequisites from verified server account observations; never a grant from condition JSON.
 * Only the source/action reader may combine this result with exact native source equality.
 */
import { optionsReadAccess } from "./optionsAccess";
import { isPaidSubscriptionTier } from "./subscriptionTier";
import { fnpInstantMicros } from "./optionsAlerts";

export type FrozenNodeAccountCheck =
  | { kind: "eligible"; principal: string }
  | { kind: "denied" | "unavailable"; reason: string };
const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CATEGORIES = new Set(["holdings_material_change", "thesis_window", "fif_saved_issuer", "options_exposure_node"]);

export function checkFrozenNodeAccount(user: unknown, me: unknown, principal: string, evaluationAt: string): FrozenNodeAccountCheck {
  const unavailable = (reason: string): FrozenNodeAccountCheck => ({ kind: "unavailable", reason });
  const denied = (reason: string): FrozenNodeAccountCheck => ({ kind: "denied", reason });
  const at = fnpInstantMicros(evaluationAt);
  if (!UUID.test(principal) || at === null) return unavailable("invalid_account_pin");
  if (!record(user) || !record(me)) return unavailable("account_unavailable");
  if (user.id !== principal || me.id !== principal) return denied("account_principal_mismatch");
  if (typeof me.tier !== "string" || !["free", "essential", "insider", "pro", "unlimited"].includes(me.tier.trim().toLowerCase())
    || !Array.isArray(me.features) || !me.features.every(x => typeof x === "string")) return unavailable("account_entitlement_malformed");
  if (!isPaidSubscriptionTier(me.tier) || !optionsReadAccess(me)) return denied("options_access_denied");
  if (typeof me.status !== "string" || !["active", "trialing", "none"].includes(me.status)) return denied("subscription_not_current");
  // The native /api/me operator overlay may use unlimited with status none.
  // A comp row may have no billing period; neither case fabricates an expiry.
  if (me.status === "none" && me.source !== "comp" && me.tier.trim().toLowerCase() !== "unlimited") return denied("subscription_not_current");
  if (me.current_period_end !== null && me.current_period_end !== undefined) {
    const end = fnpInstantMicros(me.current_period_end);
    if (end === null) return unavailable("subscription_clock_malformed");
    if (end < at) return denied("subscription_expired");
  }
  if (!record(user.user_metadata)) return unavailable("notification_preferences_unavailable");
  const meta = user.user_metadata;
  // Match lib/user_prefs normalization, with absent consent explicitly OFF.
  const opted = meta.alert_email_optin === true || (typeof meta.alert_email_optin === "string"
    && ["true", "on", "1"].includes(meta.alert_email_optin.trim().toLowerCase()));
  if (!opted) return denied("notification_not_opted_in");
  if (meta.alert_categories === null || meta.alert_categories === undefined) return denied("node_category_not_opted_in");
  if (!Array.isArray(meta.alert_categories) || !meta.alert_categories.every(x => typeof x === "string" && CATEGORIES.has(x.trim().toLowerCase()))) {
    return unavailable("notification_categories_malformed");
  }
  if (!meta.alert_categories.some(x => x.trim().toLowerCase() === "options_exposure_node")) return denied("node_category_not_opted_in");
  return { kind: "eligible", principal };
}
