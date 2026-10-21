/** Re-enter a server-gated route after Supabase has issued fresh auth cookies.
 * Navigation is same-origin by construction; no callback or query target is trusted.
 */
export function signedInWorkspacePath(pathname: string, search: string, hash: string): string {
  return pathname + search + hash;
}

export function navigateToSignedInWorkspace(): void {
  window.location.assign(signedInWorkspacePath(window.location.pathname, window.location.search, window.location.hash));
}
