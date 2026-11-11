export type OptionsTickerTier = "core" | "rotating";
export type OptionsTickerStatus = "available" | "quiet" | "waiting";
export type OptionsTickerChoiceStatus = OptionsTickerStatus | "unknown";
export type OptionsTickerChoiceSource = "catalog" | "active" | "fallback";

export interface OptionsTickerCatalogEntry {
  root: string;
  tier: OptionsTickerTier;
  status: OptionsTickerStatus;
  lastSuccess: string | null;
  sessionDate: string;
}

export interface OptionsTickerChoice {
  root: string;
  tier: OptionsTickerTier;
  status: OptionsTickerChoiceStatus;
  lastSuccess: string | null;
  sessionDate: string | null;
  active: boolean;
  source: OptionsTickerChoiceSource;
}

interface ChoiceArgs {
  catalog: readonly OptionsTickerCatalogEntry[];
  activeRoots: readonly string[];
  fallbackRoots?: readonly string[];
  query?: string;
}

const ROOT_RE = /^[A-Z][A-Z0-9.\-]{0,11}$/;
const TIERS = new Set<OptionsTickerTier>(["core", "rotating"]);
const STATUSES = new Set<OptionsTickerStatus>(["available", "quiet", "waiting"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeOptionsTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const root = value.trim().toUpperCase();
  return ROOT_RE.test(root) ? root : null;
}

export function parseOptionsTickerCatalog(meta: unknown): OptionsTickerCatalogEntry[] {
  const envelope = asRecord(meta);
  const catalog = asRecord(envelope?.ticker_catalog);
  if (!catalog || catalog.schema !== "live_flow.ticker_catalog/v1" || !Array.isArray(catalog.roots)) {
    return [];
  }

  const seen = new Set<string>();
  const entries: OptionsTickerCatalogEntry[] = [];
  for (const raw of catalog.roots) {
    const row = asRecord(raw);
    const root = normalizeOptionsTicker(row?.root);
    const tier = row?.tier;
    const status = row?.status;
    const sessionDate = row?.session_date;
    if (
      !root || seen.has(root)
      || typeof tier !== "string" || !TIERS.has(tier as OptionsTickerTier)
      || typeof status !== "string" || !STATUSES.has(status as OptionsTickerStatus)
      || typeof sessionDate !== "string" || sessionDate.length === 0
    ) {
      continue;
    }
    const lastSuccess = typeof row?.last_success === "string" && row.last_success.length > 0
      ? row.last_success
      : null;
    seen.add(root);
    entries.push({
      root,
      tier: tier as OptionsTickerTier,
      status: status as OptionsTickerStatus,
      lastSuccess,
      sessionDate,
    });
  }
  return entries;
}

function unknownChoice(root: string, source: "active" | "fallback"): OptionsTickerChoice {
  return {
    root,
    tier: "rotating",
    status: "unknown",
    lastSuccess: null,
    sessionDate: null,
    active: false,
    source,
  };
}

export function buildOptionsTickerChoices({
  catalog,
  activeRoots,
  fallbackRoots = [],
  query = "",
}: ChoiceArgs): OptionsTickerChoice[] {
  const byRoot = new Map<string, OptionsTickerChoice>();
  for (const entry of catalog) {
    byRoot.set(entry.root, {
      ...entry,
      active: false,
      source: "catalog",
    });
  }

  for (const value of activeRoots) {
    const root = normalizeOptionsTicker(value);
    if (!root) continue;
    const current = byRoot.get(root);
    // Once the producer catalog is present, activity is only a ranking signal.
    // Before rollout (catalog absent), a real feed root remains a valid fallback.
    if (!current && catalog.length > 0) continue;
    byRoot.set(root, { ...(current ?? unknownChoice(root, "active")), active: true });
  }

  if (catalog.length === 0) {
    for (const value of fallbackRoots) {
      const root = normalizeOptionsTicker(value);
      if (!root || byRoot.has(root)) continue;
      byRoot.set(root, unknownChoice(root, "fallback"));
    }
  }

  const normalizedQuery = query.trim().toUpperCase();
  return Array.from(byRoot.values())
    .filter((choice) => !normalizedQuery || choice.root.includes(normalizedQuery))
    .sort((a, b) => {
      const rank = (choice: OptionsTickerChoice) => {
        if (choice.active) return 0;
        if (choice.source === "catalog" && choice.tier === "core") return 1;
        if (choice.source === "catalog") return 2;
        return 3;
      };
      return rank(a) - rank(b) || a.root.localeCompare(b.root);
    });
}

export function findExactOptionsTickerChoice(
  choices: readonly OptionsTickerChoice[],
  query: string,
): OptionsTickerChoice | null {
  const root = normalizeOptionsTicker(query);
  if (!root) return null;
  return choices.find((choice) => choice.root === root) ?? null;
}

export function optionsTickerNoDataMessage(
  choice: OptionsTickerChoice | null,
  selectedRoot: string,
  marketOpen: boolean,
  lang: "en" | "zh",
  catalogAvailable: boolean,
): string {
  const root = normalizeOptionsTicker(selectedRoot) ?? selectedRoot.trim().toUpperCase();
  if (choice?.status === "waiting") {
    if (choice.tier === "core") {
      return lang === "zh"
        ? `${root} 核心覆盖尚未发布当前交易时段的数据。`
        : `${root} core coverage has not published a current-session payload yet.`;
    }
    return lang === "zh"
      ? `${root} 已纳入轮换覆盖，但当前交易时段的轮询尚未完成。`
      : `${root} is covered on the rotating lane but has not completed its current-session cycle yet.`;
  }
  if (choice?.status === "quiet") {
    if (marketOpen) {
      return lang === "zh"
        ? `${root} 的覆盖已刷新，但本时段暂无达标的期权成交。`
        : `${root} coverage refreshed, but there are no qualifying options prints this session.`;
    }
    return lang === "zh"
      ? `市场休市 — ${root} 在上一交易时段没有达标的期权成交。`
      : `Market closed — ${root} carried no qualifying options prints in the last session.`;
  }
  if (choice?.status === "available") {
    return lang === "zh"
      ? `${root} 已有覆盖数据，但当前详情文件未能加载，请稍后重试。`
      : `${root} is covered with session data, but the current drill artifact did not load. Try again shortly.`;
  }
  if (catalogAvailable && !choice) {
    return lang === "zh"
      ? `${root} 不在当前盘中期权覆盖目录中。`
      : `${root} is not in the current intraday options coverage catalog.`;
  }
  return marketOpen
    ? (lang === "zh"
        ? `${root} 本时段暂无可用的期权流详情。`
        : `${root} has no options-flow drill available this session.`)
    : (lang === "zh"
        ? `市场休市 — ${root} 暂无上一交易时段的期权流详情。`
        : `Market closed — ${root} has no options-flow drill from the last session.`);
}
