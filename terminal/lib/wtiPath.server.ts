import "server-only";
import { BILLING_BASE, billingAuthResult } from "@/app/api/billing/gateway";
import { readBoundedJson } from "./readBoundedJson";
import { parseWtiPath, WTI_CHAIN, type WtiRead } from "./wtiPath";

async function readOwner(signal: AbortSignal): Promise<WtiRead> {
  const session = await billingAuthResult();
  if (session.status === "denied") return { status: "signin" };
  if (session.status !== "ok" || signal.aborted) return { status: "unavailable" };
  const base = new URL(BILLING_BASE);
  if (!["https://www.mastermind-x.com", "https://mastermind-x.com"].includes(base.origin) ||
    base.username || base.password || base.pathname !== "/" || base.search || base.hash) return { status: "unavailable" };
  const response = await fetch(new URL("/api/ontology/explorer/v1?chain=" + WTI_CHAIN, base), {
    headers: { Authorization: "Bearer " + session.token, Accept: "application/json" },
    redirect: "error", cache: "no-store", signal,
  });
  if (![200, 503].includes(response.status) || !response.headers.get("content-type")?.startsWith("application/json")) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 401) return { status: "signin" };
    if (response.status === 403) return { status: "restricted" };
    if (response.status === 429) return { status: "limited" };
    return { status: "unavailable" };
  }
  const raw = await readBoundedJson(response, response.status === 200 ? 4 * 1024 * 1024 : 8192);
  if (response.status === 503) {
    const detail = typeof raw === "object" && raw !== null && "detail" in raw ? raw.detail : null;
    return { status: detail && typeof detail === "object" && "code" in detail && detail.code === "source_incoherent"
      ? "incoherent" : "unavailable" };
  }
  return { status: "ready", data: parseWtiPath(raw) };
}

export async function readWtiPath(): Promise<WtiRead> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([readOwner(controller.signal),
      new Promise<WtiRead>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve({ status: "unavailable" }); }, 10000);
      })]);
  } catch { return { status: "unavailable" }; }
  finally { clearTimeout(timer); controller.abort(); }
}
