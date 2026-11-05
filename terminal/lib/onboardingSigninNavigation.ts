/** Re-enter a server-gated route after Supabase has issued fresh auth cookies.
 * Navigation is same-origin by construction; no callback or query target is trusted.
 */
export function signedInWorkspacePath(pathname: string, search: string, hash: string): string {
  // A browser pathname can begin with "//" or "/\\". Never pass a
  // network-path reference to location.assign() after authentication.
  const safePath = "/" + pathname.replace(/^[\\/]+/, "");
  return safePath + search + hash;
}

export function navigateToSignedInWorkspace(): void {
  // Assigning the exact current URL when a fragment exists can perform only a
  // same-document fragment navigation. That leaves the anonymous RSC gate in
  // place even after the new cookies have been issued.
  if (window.location.hash) {
    window.location.reload();
    return;
  }
  window.location.assign(signedInWorkspacePath(window.location.pathname, window.location.search, window.location.hash));
}
