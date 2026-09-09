import type { PlainLang } from "@/lib/plainLabels";

export const WEBHOOK_DELIVERY_STATUS_LABEL = {
  pending: ["Queued", "已排队"],
  delivering: ["Sending", "发送中"],
  retrying: ["Retrying", "重试中"],
  delivered: ["Delivered", "已送达"],
  failed: ["Gave up after 5 tries", "已重试 5 次后放弃"],
} as const;

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
  createTeam: ["Create a team", "创建团队"],
  memberReadOnly: [
    "You can see this team's webhook deliveries. Only an owner or admin can add or turn endpoints on or off.",
    "您可以查看此团队的 Webhook 送达记录。只有所有者或管理员才能添加或开关回调地址。",
  ],
  addEndpoint: ["Add an endpoint", "添加回调地址"],
  urlLabel: ["Callback address", "回调地址"],
  urlPlaceholder: ["https://example.com/webhook", "https://example.com/webhook"],
  eventType: ["Event type", "事件类型"],
  testEvent: ["Test event", "测试事件"],
  add: ["Add endpoint", "添加回调"],
  endpoints: ["Endpoints", "回调地址"],
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
    "此团队尚未登记 Webhook 回调地址。",
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
  testDisabled: [
    "This endpoint is turned off, so we did not send a test event.",
    "此回调已关闭，因此我们未发送测试事件。",
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
