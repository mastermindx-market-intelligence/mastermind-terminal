/**
 * Recurring briefs (packet B-F11-7 / MO-PAID-032). Deterministic composition only —
 * the UI renders body JSON sentences verbatim. No LLM, no numeric judgement keys.
 *
 * Cadence and state slugs stay in this module. User-visible strings go through
 * `briefCopy` / `BRIEFS_ROUTE_MESSAGES` and never print the slug.
 */

export type BriefLang = "en" | "zh";
export type BriefTargetKind = "thesis" | "watchlist";
export type BriefCadence = "daily_after_us_close" | "weekly_saturday";
export type BriefDeliveryChannel = "in_product_inbox";
export type BriefSubscriptionState = "active" | "paused";
export type BriefDeliveryState = "ready" | "degraded";

export type BriefTarget = {
  kind: BriefTargetKind;
  id: string;
  name: string;
  version_or_asof: string;
};

export type BriefMarketRead = {
  section: string;
  sentence_en: string;
  sentence_zh: string;
  asof: string;
};

export type BriefMonitor = {
  name: string;
  state_en: string;
  state_zh: string;
};

export type BriefArtifact = {
  name: string;
  asof: string;
};

export type BriefBody = {
  target: BriefTarget;
  market_read: BriefMarketRead[];
  monitors: BriefMonitor[];
  artifact: BriefArtifact;
};

export type BriefSubscription = {
  subscriptionId: string;
  userId: string;
  targetKind: BriefTargetKind;
  targetId: string;
  cadence: BriefCadence;
  delivery: BriefDeliveryChannel;
  state: BriefSubscriptionState;
  createdAt: string;
};

export type BriefDelivery = {
  deliveryId: string;
  subscriptionId: string;
  slotAsof: string;
  state: BriefDeliveryState;
  degradedReason: string | null;
  artifactAsof: string | null;
  body: BriefBody | Record<string, unknown>;
  createdAt: string;
  subscription: Pick<BriefSubscription, "targetKind" | "targetId" | "cadence" | "state"> & {
    targetName?: string;
  };
};

export const TARGET_KINDS: readonly BriefTargetKind[] = ["thesis", "watchlist"];
export const CADENCES: readonly BriefCadence[] = ["daily_after_us_close", "weekly_saturday"];
export const SUBSCRIPTION_STATES: readonly BriefSubscriptionState[] = ["active", "paused"];
export const PATCH_STATES = ["pause", "resume"] as const;
export type BriefPatchState = (typeof PATCH_STATES)[number];

export const BRIEFS_COPY = {
  title: ["Briefs", "简报"],
  controlsTitle: ["Schedule brief", "安排简报"],
  scheduleHelp: [
    "Choose when this thesis or watchlist should appear in your Briefs inbox.",
    "选择这份论点或观察列表何时出现在简报收件箱中。",
  ],
  emailNull: [
    "Delivery: Terminal → Alerts → Briefs. Email and push aren't available yet.",
    "送达位置：终端 → 提醒 → 简报。邮件和推送尚未开通。",
  ],
  subscribeDaily: ["After each US close", "每个美股收盘后"],
  subscribeWeekly: ["Every Saturday", "每周六"],
  add: ["Add", "添加"],
  pause: ["Pause", "暂停"],
  resume: ["Resume", "恢复"],
  paused: ["Paused", "已暂停"],
  on: ["Scheduled", "已安排"],
  empty: [
    "No delivered briefs yet. When a scheduled brief runs, it will appear here.",
    "还没有已送达的简报。定时简报运行后会显示在这里。",
  ],
  degradedDaily: [
    "Tonight's brief didn't run — the market read it uses wasn't rebuilt. Nothing has been recalculated.",
    "今晚的简报没有生成——它所依据的市场解读没有重建。没有任何内容被重新计算。",
  ],
  degradedWeekly: [
    "This week's brief didn't run — the market read it uses wasn't rebuilt. Nothing has been recalculated.",
    "本周的简报没有生成——它所依据的市场解读没有重建。没有任何内容被重新计算。",
  ],
  lastGood: ["Last good brief", "上一份正常简报"],
  monitorOne: ["{n} monitor", "{n} 项监控"],
  monitors: ["{n} monitors", "{n} 项监控"],
  unavailable: ["Briefs could not load right now. Try again in a moment.", "暂时无法加载简报，请稍后再试。"],
  retry: ["Try again", "重试"],
  asof: ["As of {date}", "截至 {date}"],
} as const;

export type BriefCopyKey = keyof typeof BRIEFS_COPY;

export function briefCopy(key: BriefCopyKey, lang: BriefLang, vars?: Record<string, string | number>): string {
  const pair = BRIEFS_COPY[key];
  let text: string = pair[lang === "zh" ? 1 : 0];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export const BRIEFS_ROUTE_MESSAGES = {
  not_signed_in: ["Sign in to manage briefs.", "请先登录，再管理简报。"],
  bad_request: ["That request was not complete. Check the fields and try again.", "请求不完整。请检查填写项后重试。"],
  duplicate: [
    "You already have a brief on this schedule for this thesis or watchlist.",
    "你已经为这份论点或观察列表订阅了同一安排的简报。",
  ],
  not_found: ["That brief could not be found.", "找不到这份简报。"],
  unavailable: ["Briefs could not load right now. Try again in a moment.", "暂时无法加载简报，请稍后再试。"],
  invalid_state: ["That change is not available for this brief.", "这份简报现在不能做这项更改。"],
} as const;

export type BriefsRouteCode = keyof typeof BRIEFS_ROUTE_MESSAGES;

/** Keys that would smuggle a judgement or an LLM field into the body. */
const FORBIDDEN_BODY_KEYS = [
  "score",
  "confidence",
  "judgement",
  "judgment",
  "probability",
  "weight",
  "rank",
  "llm",
  "prompt",
  "completion",
  "model",
  "tokens",
  "embedding",
  "temperature",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function hasForbiddenKey(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_BODY_KEYS.some((bad) => lower === bad || lower.endsWith(`_${bad}`) || lower.startsWith(`${bad}_`))) {
      return true;
    }
    const val = obj[key];
    if (isPlainObject(val) && hasForbiddenKey(val)) return true;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (isPlainObject(item) && hasForbiddenKey(item)) return true;
      }
    }
  }
  return false;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isNumericJudgementValue(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

function objectHasNumericJudgement(obj: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (isNumericJudgementValue(val) && FORBIDDEN_BODY_KEYS.some((bad) => lower.includes(bad))) {
      return true;
    }
    if (isPlainObject(val) && objectHasNumericJudgement(val)) return true;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (isPlainObject(item) && objectHasNumericJudgement(item)) return true;
      }
    }
  }
  return false;
}

export function isBriefTargetKind(v: unknown): v is BriefTargetKind {
  return v === "thesis" || v === "watchlist";
}

export function isBriefCadence(v: unknown): v is BriefCadence {
  return v === "daily_after_us_close" || v === "weekly_saturday";
}

export function isBriefPatchState(v: unknown): v is BriefPatchState {
  return v === "pause" || v === "resume";
}

export function patchStateToRow(state: BriefPatchState): BriefSubscriptionState {
  return state === "pause" ? "paused" : "active";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function validateBriefBody(raw: unknown): BriefBody | null {
  if (!isPlainObject(raw)) return null;
  if (hasForbiddenKey(raw) || objectHasNumericJudgement(raw)) return null;
  const target = raw.target;
  if (!isPlainObject(target)) return null;
  if (!isBriefTargetKind(target.kind)) return null;
  if (!isNonEmptyString(target.id) || !isNonEmptyString(target.name) || !isNonEmptyString(target.version_or_asof)) {
    return null;
  }
  if (!Array.isArray(raw.market_read)) return null;
  const market_read: BriefMarketRead[] = [];
  for (const row of raw.market_read) {
    if (!isPlainObject(row)) return null;
    if (
      !isNonEmptyString(row.section) ||
      !isNonEmptyString(row.sentence_en) ||
      !isNonEmptyString(row.sentence_zh) ||
      !isNonEmptyString(row.asof)
    ) {
      return null;
    }
    market_read.push({
      section: row.section,
      sentence_en: row.sentence_en,
      sentence_zh: row.sentence_zh,
      asof: row.asof,
    });
  }
  if (!Array.isArray(raw.monitors)) return null;
  const monitors: BriefMonitor[] = [];
  for (const row of raw.monitors) {
    if (!isPlainObject(row)) return null;
    if (!isNonEmptyString(row.name) || !isNonEmptyString(row.state_en) || !isNonEmptyString(row.state_zh)) {
      return null;
    }
    monitors.push({ name: row.name, state_en: row.state_en, state_zh: row.state_zh });
  }
  const artifact = raw.artifact;
  if (!isPlainObject(artifact) || !isNonEmptyString(artifact.name) || !isNonEmptyString(artifact.asof)) {
    return null;
  }
  return {
    target: {
      kind: target.kind,
      id: target.id,
      name: target.name,
      version_or_asof: target.version_or_asof,
    },
    market_read,
    monitors,
    artifact: { name: artifact.name, asof: artifact.asof },
  };
}

export function deliveryIsMiss(row: { state: BriefDeliveryState }): boolean {
  return row.state === "degraded";
}

export function subscriptionIsPaused(row: { state: BriefSubscriptionState }): boolean {
  return row.state === "paused";
}

export function degradedLine(cadence: BriefCadence, lang: BriefLang): string {
  return briefCopy(cadence === "weekly_saturday" ? "degradedWeekly" : "degradedDaily", lang);
}

export function marketReadSentences(body: BriefBody, lang: BriefLang, n = 2): string[] {
  return body.market_read.slice(0, n).map((row) => (lang === "zh" ? row.sentence_zh : row.sentence_en));
}

export function monitorsSummary(body: BriefBody, lang: BriefLang): string {
  const n = body.monitors.length;
  const count = briefCopy(n === 1 ? "monitorOne" : "monitors", lang, { n });
  if (n === 0) return count;
  const first = lang === "zh" ? body.monitors[0].state_zh : body.monitors[0].state_en;
  return `${count} · ${first}`;
}

export type PinnedDelivery = BriefDelivery & { pinned?: boolean };

/**
 * Newest-first list. When the newest row is degraded, the most recent `ready`
 * row is marked pinned so it stays visible with its own asof (R6). Never
 * synthesizes a missing slot.
 */
export function pinLastReady(rows: BriefDelivery[]): PinnedDelivery[] {
  const ordered = [...rows].sort((a, b) => {
    if (a.slotAsof !== b.slotAsof) return a.slotAsof < b.slotAsof ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  const newest = ordered[0];
  if (!newest || newest.state !== "degraded") return ordered;
  const lastReady = ordered.find((row) => row.state === "ready");
  if (!lastReady) return ordered;
  return ordered.map((row) => (row.deliveryId === lastReady.deliveryId ? { ...row, pinned: true } : row));
}

export function targetNameFromBody(body: unknown, fallback = ""): string {
  const parsed = validateBriefBody(body);
  return parsed?.target.name || fallback;
}

export function targetNameKey(kind: BriefTargetKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * List field: target name. A degraded row's body is empty by contract, so the
 * name comes from a ready sibling on the same subscription, else from a
 * theses/watchlists join the BFF supplies.
 */
export function fillTargetNames(
  rows: BriefDelivery[],
  joined: Map<string, string>,
): BriefDelivery[] {
  const fromSibling = new Map<string, string>();
  for (const row of rows) {
    const name = (row.subscription.targetName || "").trim() || targetNameFromBody(row.body);
    if (name) fromSibling.set(row.subscriptionId, name);
  }
  return rows.map((row) => {
    const name = (row.subscription.targetName || "").trim()
      || fromSibling.get(row.subscriptionId)
      || joined.get(targetNameKey(row.subscription.targetKind, row.subscription.targetId))
      || "";
    if (!name || row.subscription.targetName === name) return row;
    return { ...row, subscription: { ...row.subscription, targetName: name } };
  });
}

export function parseLimit(raw: string | null, fallback = 40, max = 100): number {
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}
