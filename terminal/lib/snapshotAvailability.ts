import { R2_BASE } from "@/lib/upstreams";
import { isSnapshotSlug } from "@/lib/snapshotSlug";

export type SnapshotAvailability = "available" | "missing" | "unavailable";

export function snapshotImageUrl(slug: string): string | null {
  return isSnapshotSlug(slug) ? `${R2_BASE}/snapshots/${slug}.png` : null;
}

export function classifySnapshotStatus(status: number): SnapshotAvailability {
  if (status === 404 || status === 410) return "missing";
  return status >= 200 && status < 300 ? "available" : "unavailable";
}

// Closed read-only browser fixtures use the same status classifier. They cannot
// admit a production override, arbitrary upstream URL or writable test endpoint.
const FIXTURE_STATUS: Readonly<Record<string, number>> = {
  snapready1: 200, snapgone01: 404, snapfail01: 503,
};
export async function readSnapshotAvailability(slug: string): Promise<SnapshotAvailability> {
  const url = snapshotImageUrl(slug);
  if (!url) return "missing";
  if (process.env.NODE_ENV === "development" && process.env.TERMINAL_E2E_FIXTURE === "1"
    && Object.hasOwn(FIXTURE_STATUS, slug)) return classifySnapshotStatus(FIXTURE_STATUS[slug]);
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(8000) });
    return classifySnapshotStatus(response.status);
  } catch {
    return "unavailable";
  }
}
