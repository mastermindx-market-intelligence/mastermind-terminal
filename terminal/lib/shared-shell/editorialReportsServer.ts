import "server-only";
import { SHARED_SHELL_LEGACY_ORIGIN } from "@/lib/sharedShellOrigins";
import { decodeEditorialReports, type EditorialReport } from "./editorialReports";

const manifest = SHARED_SHELL_LEGACY_ORIGIN + "/research/editorial-reports.json";
const maxBytes = 1_048_576;

export async function readEditorialReports(): Promise<EditorialReport[] | null> {
  try {
    const response = await fetch(manifest, { cache: "no-store", redirect: "error", credentials: "omit",
      signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let body = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); return null; }
        body += decoder.decode(value, { stream: true });
      }
      return decodeEditorialReports(JSON.parse(body + decoder.decode()));
    } finally {
      reader.releaseLock();
    }
  } catch {
    return null;
  }
}
