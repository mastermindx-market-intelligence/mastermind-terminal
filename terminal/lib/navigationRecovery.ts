/** Pure matcher for the single existing error-boundary reload guard.
 * Chunk failures can occur on any route after a deploy. Transport/RSC navigation
 * failures get ONE recovery attempt only on Options, the reported broken route.
 * Never treat a programming exception or an ordinary API 5xx as a reload trigger.
 */
const CHUNK_ERROR = /module factory is not available|ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i;
const OPTIONS_TYPE_ERROR = /^(?:network error|Failed to fetch|Load failed)$/i;
const OPTIONS_RSC_ERROR = /ERR_HTTP2_PROTOCOL_ERROR|Failed to fetch RSC payload/i;

export function shouldAutoRecoverNavigationError(
  error: { name?: string; message?: string },
  pathname: string,
): boolean {
  const message = (error.message ?? "").trim();
  if (CHUNK_ERROR.test(message) || CHUNK_ERROR.test(error.name ?? "")) return true;
  if (pathname !== "/options" && !pathname.startsWith("/options/")) return false;
  return (error.name === "TypeError" && OPTIONS_TYPE_ERROR.test(message))
    || OPTIONS_RSC_ERROR.test(message);
}

// Existing one-shot route recovery (Wave-1 INFRA, options-crash audit).
// A stale chunk after deploy or a transient Options RSC/HTTP2 navigation failure
// may recover with one fresh document request. Only the exact Options network
// patterns receive this new behavior; other programming errors keep manual retry.
// tryChunkReload uses the SAME persisted cooldown and can NEVER loop:
// - the one-shot sessionStorage flag records WHEN we last healed;
// - if the just-reloaded document throws a chunk error again within RELOAD_MIN_GAP_MS, we do NOT
//   reload (that's a real loop — e.g. the new build is itself broken) and fall through to the
//   manual retry UI instead;
// - a genuinely-later chunk crash (gap exceeded) heals again. The flag is never explicitly
//   cleared: the 30s window IS the whole guard. Known tradeoff: a different genuine chunk
//   error within 30s of a heal falls to the manual UI (conservative — no loop is possible).
// All other errors never touch the flag and keep the manual retry UI.
const RELOAD_FLAG = "mm.chunkreload";
const RELOAD_MIN_GAP_MS = 30_000;

// Returns true if a heal-reload was triggered (the document is about to navigate away).
// Safe under SSR / disabled storage.
export function tryChunkReload(error: Error): boolean {
  if (typeof window === "undefined" || !shouldAutoRecoverNavigationError(error, window.location.pathname)) return false;
  try {
    const prev = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (prev && Date.now() - prev < RELOAD_MIN_GAP_MS) {
      // reloaded moments ago and still crashing → stop looping, show manual UI.
      return false;
    }
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false; // storage unavailable (private mode) — skip auto-heal, keep manual UI.
  }
}
