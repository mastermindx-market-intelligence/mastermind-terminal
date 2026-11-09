/** Pure matcher for the single existing error-boundary reload guard.
 * Chunk failures can occur on any route after a deploy. Transport/RSC navigation
 * failures get ONE recovery attempt only on the explicitly observed Options and
 * Portfolio routes. This is not a generic network/API failure retry.
 * Never treat a programming exception or an ordinary API 5xx as a reload trigger.
 */
const CHUNK_ERROR = /module factory is not available|ChunkLoadError|Loading chunk .* failed/i;
const NAVIGATION_TYPE_ERROR = /^(?:network error|Failed to fetch|Load failed)$/i;
const NAVIGATION_RSC_ERROR = /ERR_HTTP2_PROTOCOL_ERROR|Failed to fetch RSC payload/i;

export function shouldAutoRecoverNavigationError(
  error: { name?: string; message?: string },
  pathname: string,
): boolean {
  const message = (error.message ?? "").trim();
  if (CHUNK_ERROR.test(message) || CHUNK_ERROR.test(error.name ?? "")) return true;
  const affectedRoute = pathname === "/options" || pathname.startsWith("/options/")
    || pathname === "/portfolio" || pathname.startsWith("/portfolio/");
  if (!affectedRoute) return false;
  return (error.name === "TypeError" && NAVIGATION_TYPE_ERROR.test(message))
    || NAVIGATION_RSC_ERROR.test(message);
}
