import type { PlainLang } from "@/lib/plainLabels";

// `failed` states a fact to the customer: five attempts were made. It is written
// by exactly one place, failurePatch at attempt >= 5 (webhookRetry.ts). The two
// outcomes that abandon a delivery WITHOUT exhausting the retry table — the
// endpoint was turned off, or its saved address stopped being a public https
// address — carry their own terminal statuses so the list never claims an
// attempt count that never happened.
export const WEBHOOK_DELIVERY_STATUS_LABEL = {
  pending: ["Queued", "已排队"],
  delivering: ["Sending", "发送中"],
  retrying: ["Retrying", "重试中"],
  delivered: ["Delivered", "已送达"],
  failed: ["Gave up after 5 tries", "已重试 5 次后放弃"],
  not_sent_disabled: ["Not sent — endpoint turned off", "未发送：端点已关闭"],
  not_sent_invalid_url: ["Not sent — address no longer valid", "未发送：地址已失效"],
} as const;

/** Terminal statuses the worker writes without exhausting the retry table. */
export const WEBHOOK_NOT_SENT_STATUS = ["not_sent_disabled", "not_sent_invalid_url"] as const;

export type WebhookDeliveryStatus = keyof typeof WEBHOOK_DELIVERY_STATUS_LABEL;

export function webhookDeliveryStatusLabel(
  value: string | null | undefined,
  lang: PlainLang,
): string {
  if (value == null || value === "") return lang === "zh" ? "未知状态" : "Unknown status";
  const pair = WEBHOOK_DELIVERY_STATUS_LABEL[value as WebhookDeliveryStatus];
  if (!pair) return lang === "zh" ? "未知状态" : "Unknown status";
  return lang === "zh" ? pair[1] : pair[0];
}

// One label pair per legal event_type. The migration's check constraint
// (0018_webhook_delivery.sql) is the source of truth for which values are
// legal, and webhookEventTypeLabels.test.ts reads that constraint and fails
// on any value missing from this table — so widening the constraint without
// writing the customer-facing name is a red test, not a silently wrong row.
export const WEBHOOK_EVENT_TYPE_LABEL = {
  "webhook.test": ["Test event", "测试事件"],
} as const;

export type WebhookEventType = keyof typeof WEBHOOK_EVENT_TYPE_LABEL;

export function webhookEventTypeLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null || value === "") return lang === "zh" ? "未知事件" : "Unknown event";
  const pair = WEBHOOK_EVENT_TYPE_LABEL[value as WebhookEventType];
  if (!pair) return lang === "zh" ? "未知事件" : "Unknown event";
  return lang === "zh" ? pair[1] : pair[0];
}

// The worker records a machine class in `last_error` (endpoint_disabled,
// not_https, private_address, dns_failed, timeout, network, "http <n>", …).
// That column reaches the browser through SAFE_DELIVERY_COLUMNS, so it needs a
// plain sentence in both languages before anything renders it. A code with no
// entry here falls back to a plain sentence, never to the raw code.
export const WEBHOOK_CAUSE_LABEL = {
  endpoint_disabled: [
    "The endpoint was turned off, so we did not send this event.",
    "端点已关闭，因此我们没有发送这条事件。",
  ],
  not_https: [
    "The saved address is not an https address.",
    "保存的地址不是 https 地址。",
  ],
  private_address: [
    "The saved address points to a private or local network.",
    "保存的地址指向私有或本地网络。",
  ],
  invalid_url: [
    "The saved address is not a valid https address.",
    "保存的地址不是有效的 https 地址。",
  ],
  dns_failed: [
    "We could not look up that address on the public internet.",
    "我们无法在公网上解析该地址。",
  ],
  timeout: [
    "The endpoint did not answer within 10 seconds.",
    "端点未在 10 秒内响应。",
  ],
  network: [
    "We could not reach the endpoint.",
    "我们无法连接到该端点。",
  ],
  bad_retry_timestamp: [
    "The saved retry time could not be read, so we tried again right away.",
    "保存的重试时间无法读取，因此我们立即重试了一次。",
  ],
} as const;

export type WebhookCauseCode = keyof typeof WEBHOOK_CAUSE_LABEL;

const HTTP_CODE_RE = /^http (\d{1,3})$/;

/** Plain sentence for a `last_error` code. Empty string when there is none. */
export function webhookCauseLabel(value: string | null | undefined, lang: PlainLang): string {
  if (value == null) return "";
  const code = value.trim();
  if (!code) return "";
  const pair = WEBHOOK_CAUSE_LABEL[code as WebhookCauseCode];
  if (pair) return lang === "zh" ? pair[1] : pair[0];
  const http = HTTP_CODE_RE.exec(code);
  if (http && http[1] !== "0") {
    return lang === "zh"
      ? `端点返回了错误代码 ${http[1]}。`
      : `The endpoint answered with error code ${http[1]}.`;
  }
  return lang === "zh" ? "我们无法发送这条事件。" : "We could not send this event.";
}

export const WEBHOOK_ENABLED_LABEL = {
  enabled: ["Active", "已启用"],
  disabled: ["Disabled", "已停用"],
} as const;

export function webhookEnabledLabel(enabled: boolean, lang: PlainLang): string {
  const pair = enabled ? WEBHOOK_ENABLED_LABEL.enabled : WEBHOOK_ENABLED_LABEL.disabled;
  return lang === "zh" ? pair[1] : pair[0];
}

export const WEBHOOK_COPY = {
  emptyTeam: ["You don't have a team yet", "您还没有团队"],
  emptyTeamHelp: [
    "Create a team first, then you can register an HTTPS address for signed deliveries.",
    "请先创建团队，然后即可登记用于签名送达的 HTTPS 地址。",
  ],
  teamLoadFailed: [
    "We could not load your team right now. Try again.",
    "暂时无法读取你的团队信息，请重试。",
  ],
  createTeam: ["Create a team", "创建团队"],
  teamNameLabel: ["Team name", "团队名称"],
  teamNamePlaceholder: ["Research desk", "研究团队"],
  memberReadOnly: [
    "You can see this team's webhook deliveries. Only an owner or admin can add or turn endpoints on or off.",
    "您可以查看此团队的 Webhook 送达记录。只有所有者或管理员才能添加或开关端点。",
  ],
  addEndpoint: ["Add an endpoint", "添加端点"],
  urlLabel: ["Endpoint URL", "端点地址"],
  urlPlaceholder: ["https://example.com/webhook", "https://example.com/webhook"],
  eventType: ["Event type", "事件类型"],
  testEvent: ["Test event", "测试事件"],
  add: ["Add endpoint", "添加端点"],
  endpoints: ["Endpoints", "端点"],
  deliveries: ["Last 20 deliveries", "最近 20 次送达"],
  sendTest: ["Send a test event", "发送测试事件"],
  secretTitle: ["Signing secret", "签名密钥"],
  secretOnce: [
    "This is shown once. Store it now — it cannot be shown again.",
    "此密钥仅显示一次，请立即保存，之后将无法再次查看。",
  ],
  copySecret: ["Copy secret", "复制密钥"],
  copied: ["Copied", "已复制"],
  dismissSecret: ["I have stored it", "我已保存"],
  noEndpoints: [
    "This team has not registered a webhook endpoint yet.",
    "此团队尚未登记 Webhook 端点。",
  ],
  noDeliveries: ["No deliveries yet.", "尚无送达记录。"],
  teamLabel: ["Team", "团队"],
  ssrf: [
    "Use an https address on the public internet. Private or local addresses are not allowed.",
    "请使用公网的 https 地址。不支持私有或本地地址。",
  ],
  notHttps: ["Webhook addresses must use https.", "Webhook 地址必须使用 https。"],
  invalidUrl: ["Enter an https address on the public internet.", "请输入公网的 https 地址。"],
  testQueued: ["A test event is queued.", "测试事件已排队。"],
  // Wrong-cause guard: a route that answers without a JSON body tells us
  // nothing about WHY. These two say only what is certainly true — never the
  // ssrf or the turned-off sentence, which the route alone is entitled to say.
  saveFailed: [
    "We could not save this endpoint. Try again.",
    "无法保存该端点，请重试。",
  ],
  testFailed: [
    "We could not send the test event. Try again.",
    "无法发送测试事件，请重试。",
  ],
  relativeJustNow: ["just now", "刚刚"],
  minuteAgo: ["minute ago", "分钟前"],
  minutesAgo: ["minutes ago", "分钟前"],
  hourAgo: ["hour ago", "小时前"],
  hoursAgo: ["hours ago", "小时前"],
  dayAgo: ["day ago", "天前"],
  daysAgo: ["days ago", "天前"],
} as const;

export function webhookCopy(key: keyof typeof WEBHOOK_COPY, lang: PlainLang): string {
  const pair = WEBHOOK_COPY[key];
  return lang === "zh" ? pair[1] : pair[0];
}

function agoPhrase(count: number, singular: keyof typeof WEBHOOK_COPY, plural: keyof typeof WEBHOOK_COPY, lang: PlainLang): string {
  const unit = webhookCopy(count === 1 ? singular : plural, lang);
  return `${count} ${unit}`;
}

export function webhookRelativeTime(iso: string | null | undefined, lang: PlainLang, nowMs = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const delta = Math.max(0, nowMs - then);
  if (delta < 45_000) return webhookCopy("relativeJustNow", lang);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return agoPhrase(minutes, "minuteAgo", "minutesAgo", lang);
  const hours = Math.round(minutes / 60);
  if (hours < 48) return agoPhrase(hours, "hourAgo", "hoursAgo", lang);
  const days = Math.round(hours / 24);
  return agoPhrase(days, "dayAgo", "daysAgo", lang);
}
