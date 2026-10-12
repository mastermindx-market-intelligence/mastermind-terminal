/**
 * flowRoot.ts — the one rule for an option root that /api/flow will read.
 *
 * Client-safe on purpose (no imports). The route applies it through isValidF to every
 * f-param whose tail is a root; a per-root view applies the same rule before it asks,
 * so a name the route would refuse with a 400 is never sent, and that refusal is never
 * shown to a reader as a failed read with a Retry that can never land.
 */

/**
 * A syntactically valid option root, for f-params whose tail is interpolated into a
 * backend path or an R2 object key.
 *
 * ⚠️ SECURITY, not tidiness. Before this existed, `isValidF` accepted ANY non-empty
 * string after `gex:` / `vol:` / `matrix:` / `agg:` / … and `backendPath` / `r2Key`
 * interpolated it raw. `gex:../../admin/secrets` normalises away the `..` segments at
 * fetch time and reads an arbitrary backend endpoint or R2 object — and because the
 * route caches by the f-param string, the result is then served from the shared
 * server-side CACHE under the attacker's key. Path traversal plus cache poisoning from
 * one query parameter.
 *
 * Roots are uppercase alphanumerics with an optional dot or hyphen inside (BRK.B,
 * RDS-A) — never a slash, a dot-dot, a space or a percent escape. 12 chars matches the
 * ticker input's own maxLength.
 */
const ROOT_RE = /^[A-Z0-9]{1,10}(?:[.-][A-Z0-9]{1,4})?$/;

export function isValidRoot(root: string): boolean {
  return root.length > 0 && root.length <= 12 && ROOT_RE.test(root);
}
