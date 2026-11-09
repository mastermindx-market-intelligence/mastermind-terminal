/** Pure matcher for the single existing error-boundary reload guard.
 * Chunk failures can occur on any route after a deploy. Transport/RSC navigation
 * failures get ONE recovery attempt only on Options, the reported broken route.
 * Never treat a programming exception or an ordinary API 5xx as a reload trigger.
 */
const CHUNK_ERROR = /module factory is not available|ChunkLoadError|Loading chunk .* failed/i;
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
