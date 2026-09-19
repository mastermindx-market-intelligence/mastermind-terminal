export type ApiKeyLang = "en" | "zh";

const COPY = {
  teamNull: [
    "Team keys aren't available yet — keys are personal for now.",
    "团队密钥暂未开放，目前仅支持个人密钥。",
  ],
  empty: [
    "You have not minted a personal API key yet.",
    "你还没有创建个人 API 密钥。",
  ],
  emptyHelp: [
    "A key lets you read what you already see in the Terminal from your own tools. It cannot write, and it originates no signals.",
    "密钥让你从自己的工具读取终端里已经能看到的内容。它不能写入，也不会产生任何信号。",
  ],
  mintLabel: ["Label", "名称"],
  mintPlaceholder: ["Research laptop", "研究用电脑"],
  mint: ["Mint a personal key", "创建个人密钥"],
  minting: ["Minting…", "正在创建…"],
  secretTitle: ["Copy this key now", "请立即复制此密钥"],
  secretOnce: [
    "This is shown once. Store it now — it cannot be shown again.",
    "此密钥仅显示一次，请立即保存，之后将无法再次查看。",
  ],
  copy: ["Copy key", "复制密钥"],
  copied: ["Copied", "已复制"],
  dismiss: ["I have stored it", "我已保存"],
  revoke: ["Revoke", "吊销"],
  revoking: ["Revoking…", "正在吊销…"],
  revoked: ["Revoked", "已吊销"],
  created: ["Created", "创建于"],
  lastUsed: ["Last used", "最近使用"],
  neverUsed: ["Not used yet", "尚未使用"],
  prefix: ["Prefix", "前缀"],
  activeCap: [
    "You can have up to 5 active keys. Revoke one before minting another.",
    "最多可同时保留 5 个有效密钥。请先吊销一个，再创建新的。",
  ],
  baseUrl: ["Base URL", "接口地址"],
  contractLink: ["Read the API contract", "阅读接口约定"],
  truth: [
    "This API returns what you already see in the Terminal. It originates no signals, rankings or advice.",
    "本接口只返回你在终端里已经能看到的内容。它不产生任何信号、排名或建议。",
  ],
  loadFailed: [
    "We could not read your API keys just now. Please try again.",
    "暂时无法读取你的 API 密钥，请重试。",
  ],
  mintFailed: [
    "We could not mint that key. Please try again.",
    "无法创建该密钥，请重试。",
  ],
  revokeFailed: [
    "We could not revoke that key. Please try again.",
    "无法吊销该密钥，请重试。",
  ],
  notSignedIn: ["You are not signed in.", "你尚未登录。"],
  rotateHelp: [
    "To rotate a key, mint a new one and revoke the old one. Keys are not changed in place.",
    "轮换密钥时，请先创建新密钥，再吊销旧密钥。密钥不能在原地更换。",
  ],
} as const;

export type ApiKeyCopyKey = keyof typeof COPY;

export function apiKeyCopy(key: ApiKeyCopyKey, lang: ApiKeyLang): string {
  const pair = COPY[key];
  return lang === "zh" ? pair[1] : pair[0];
}
