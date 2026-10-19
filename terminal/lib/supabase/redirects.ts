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

/** Beta confirmations return through its existing callback and onboarding resume. */
export function sharedShellSignupRedirect(origin: string, pathname: string): string | undefined {
  if (origin !== "https://beta.mastermind-x.com") return undefined;
  const path = new URL(safeAuthNext(pathname, "/macro.html"), origin).pathname;
  return origin + "/auth/callback?next=" + encodeURIComponent(path + "?onboard=resume");
}
