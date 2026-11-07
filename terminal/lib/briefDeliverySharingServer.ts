import "server-only";
import { createClient } from "./supabase/server";
import type { SharingDb, SharingReference, SharingResult } from "./briefDeliverySharing";

export function sharingResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export const sharingFailure = (code: string, status: number, reference?: SharingReference) =>
  sharingResponse({ ok: false, code, ...(reference ? { reference } : {}) }, status);

/** Actual Terminal cookie identity only. No email, Workspace or admin mapping. */
export async function authenticatedSharing<T>(
  operation: (db: SharingDb, principalId: string) => Promise<SharingResult<T>>,
  mutatingReference?: SharingReference,
): Promise<Response> {
  let db: Awaited<ReturnType<typeof createClient>>;
  let original: string;
  try {
    db = await createClient();
    const user = await db.auth.getUser();
    if (user.error || !user.data.user?.id) return sharingFailure("not_signed_in", 401);
    original = user.data.user.id;
  } catch { return sharingFailure("unavailable", 503); }
  let result: SharingResult<T>;
  try { result = await operation(db as unknown as SharingDb, original); }
  catch {
    return mutatingReference ? sharingFailure("effect_unknown", 503, mutatingReference)
      : sharingFailure("unavailable", 503);
  }
  try {
    const current = await db.auth.getUser();
    if (current.error || current.data.user?.id !== original) {
      return mutatingReference ? sharingFailure("effect_unknown", 503, mutatingReference)
        : sharingFailure("denied", 403);
    }
  } catch {
    return mutatingReference ? sharingFailure("effect_unknown", 503, mutatingReference)
      : sharingFailure("denied", 403);
  }
  if (result.ok) return sharingResponse(result.value);
  const status = result.code === "denied" ? 403 : result.code === "conflict" ? 409 :
    result.code === "invalid_input" ? 400 : 503;
  return sharingFailure(result.code, status, result.reference);
}

/** Bound the actual input stream, including a false/missing Content-Length. */
export async function sharingCommandText(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    return await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (!expired) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 16384) { await reader.cancel(); return null; }
          chunks.push(part.value);
        }
        if (expired) return null;
        const body = new Uint8Array(bytes);
        let position = 0;
        for (const chunk of chunks) { body.set(chunk, position); position += chunk.byteLength; }
        return new TextDecoder("utf-8", { fatal: true }).decode(body);
      })(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => {
          expired = true;
          void reader.cancel().catch(() => {});
          resolve(null);
        }, 5000);
      }),
    ]);
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** The public Terminal origin is fixed; reverse-proxy internal URLs are not a trust source. */
export function sharingOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === "https://app.mastermind-x.com") return true;
  if (process.env.NODE_ENV === "production" || !origin) return false;
  try {
    const target = new URL(request.url), supplied = new URL(origin);
    return supplied.origin === origin && target.origin === origin && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  } catch { return false; }
}
