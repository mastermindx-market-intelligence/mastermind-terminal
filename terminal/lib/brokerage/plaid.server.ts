import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type BrokerageConfig = { clientId: string; secret: string; host: string; key: Buffer; origin: string };
export function brokerageConfig(): BrokerageConfig | null {
  const env = process.env;
  if (env.PORTFOLIO_BROKERAGE_ENABLED !== "1" || !env.PLAID_CLIENT_ID || !env.PLAID_SECRET ||
      !env.PORTFOLIO_BROKERAGE_KEY || !env.PORTFOLIO_BROKERAGE_ORIGIN) return null;
  const host = env.PLAID_ENV === "sandbox" ? "https://sandbox.plaid.com" :
    env.PLAID_ENV === "production" ? "https://production.plaid.com" : null;
  const key = Buffer.from(env.PORTFOLIO_BROKERAGE_KEY, "base64");
  let origin: URL;
  try { origin = new URL(env.PORTFOLIO_BROKERAGE_ORIGIN); } catch { return null; }
  if (!host || key.length !== 32 || origin.protocol !== "https:" || origin.href !== origin.origin + "/") return null;
  return { host, key, clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, origin: origin.origin };
}
export function seal(config: BrokerageConfig, value: string, binding: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(part => part.toString("base64url")).join(".");
}
export function unseal(config: BrokerageConfig, value: string, binding: string): string {
  const [iv,tag,data] = value.split(".").map(part => Buffer.from(part,"base64url"));
  const cipher = createDecipheriv("aes-256-gcm",config.key,iv);
  cipher.setAAD(Buffer.from(binding)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data),cipher.final()]).toString("utf8");
}
type Endpoint = "/link/token/create" | "/link/token/get" | "/item/public_token/exchange" | "/investments/holdings/get" | "/item/remove";
export async function plaid(config: BrokerageConfig, path: Endpoint, body: Record<string, unknown>) {
  const res = await fetch(config.host + path, {method:"POST", cache:"no-store", redirect:"error",
    headers: {"Content-Type":"application/json","PLAID-CLIENT-ID":config.clientId,"PLAID-SECRET":config.secret,"Plaid-Version":"2020-09-14"},
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error("Brokerage provider unavailable");
  return res.json();
}
