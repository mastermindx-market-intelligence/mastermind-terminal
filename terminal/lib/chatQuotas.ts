/**
 * Display-only monthly caps for Brain's deep-research lane (`quotas.<tier>.pro`).
 *
 * Enforcement is NOT in this repo. Macro `config/brain.yml` is read by
 * `engine/neuralweb/brain_gateway._get_allowance`; Terminal `/api/brain/*` proxies
 * there and the gateway returns 402 on exhaustion. `insider` is an inbound alias
 * of `essential` (`lib/subscriptionTier.ts`).
 */
export const DEEP_RESEARCH_MONTHLY = {
  essential: 10,
  pro: 150,
} as const;
