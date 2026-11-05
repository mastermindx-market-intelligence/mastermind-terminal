/** The auth callback owns same-origin return admission for every app profile. */
export function safeAuthNext(raw: string | null | undefined, fallback: string): string {
  if (!raw || raw.length > 8192 || !raw.startsWith("/") || raw.startsWith("//")
    || /[\\\u0000-\u0020\u007f]/.test(raw)) return fallback;
  try {
    const origin = "https://auth-return.invalid";
    const parsed = new URL(raw, origin);
    if (parsed.origin !== origin || parsed.username || parsed.password) return fallback;
    return raw;
  } catch { return fallback; }
}

/** Reuse the onboarding sheet without discarding a safe explicit workspace URL. */
export function loginSheetHref(rawNext: string | null | undefined, fallback: string): string {
  const next = safeAuthNext(rawNext, fallback);
  const hashAt = next.indexOf("#");
  const path = hashAt < 0 ? next : next.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : next.slice(hashAt);
  if (new URL(next, "https://auth-return.invalid").searchParams.has("signin")) return next;
  const separator = path.includes("?") ? (path.endsWith("?") ? "" : "&") : "?";
  return path + separator + "signin=1" + hash;
}

/** Beta confirmations return through its existing callback and onboarding resume. */
export function sharedShellSignupRedirect(origin: string, pathname: string): string | undefined {
  if (origin !== "https://beta.mastermind-x.com") return undefined;
  const path = new URL(safeAuthNext(pathname, "/today"), origin).pathname;
  return origin + "/auth/callback?next=" + encodeURIComponent(path + "?onboard=resume");
}
