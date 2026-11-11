/**
 * sectorDepthHref.ts — the one owner-href acceptance law for the Sector
 * Intelligence depth surfaces (review N4).
 *
 * A carried href is actionable ONLY when it is a same-site relative path
 * beginning with exactly one "/": no scheme (javascript:, data:, vbscript:,
 * https:…), no protocol-relative "//host", no backslash (browsers normalize
 * "\" to "/", which would smuggle a "//" back in), and no whitespace or
 * control characters anywhere. Anything else — including non-strings —
 * returns null, and the caller renders the mark WITHOUT a link and never
 * invokes its navigation callback. No href is ever rewritten, normalized or
 * invented to make a non-conforming value pass: the owner's vocabulary
 * either conforms or the link is simply not shown.
 */

/** Acceptance pattern: one leading "/" that is not followed by a second "/",
 * then any run of characters that are not whitespace, not control (C0/C1),
 * and not a backslash. */
const SAME_SITE_HREF = /^\/(?!\/)[^\s\\\u0000-\u001f\u007f-\u009f]*$/;

/** True only for a same-site relative path beginning with exactly one "/"
 * (a lone "/" is accepted — it is the site root, still same-site). */
export function isSameSiteHref(v: unknown): v is string {
  return typeof v === "string" && SAME_SITE_HREF.test(v);
}

/** The actionable form of a carried href, or null when it does not conform. */
export function sameSiteHref(v: unknown): string | null {
  return isSameSiteHref(v) ? v : null;
}
