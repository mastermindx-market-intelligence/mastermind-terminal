import "server-only";

/**
 * Shared Shell development mode: admit signed-out visitors to the member
 * workspaces while the beta candidate runs, so agent sessions developing
 * against beta.mastermind-x.com are not blocked by the sign-up gate.
 *
 * This is NOT an auth bypass on production:
 *  - The flag is a runtime declaration of the beta candidate's EnvironmentFile
 *    (`MMX_SHARED_SHELL_DEV_OPEN=1`). Production declares no `MMX_*`
 *    environment variables, so `isSharedShellDevOpen` is false in every
 *    production deployment.
 *  - Honored only in conjunction with the shared-shell runtime flag: the
 *    dev-open flag alone (without `MMX_SHARED_SHELL=1`) does nothing. A
 *    misconfigured production process can never accidentally open the gates.
 *  - With the flag pair set, member pages render their real workspaces for
 *    signed-out visitors under a fixed development subject. Server reads stay
 *    honest: per-user stores scoped by the dev subject read that dev
 *    subject's own (typically empty) data, and server writes gated on real
 *    Supabase users remain refused — RLS still applies because no session
 *    exists. The dev-open mode is scoped to development convenience, not
 *    a data-permission change.
 */

/** Fixed UUID-shaped development subject (not a real Supabase account). */
export const SHARED_SHELL_DEV_SUBJECT =
  "00000000-0000-4000-8000-000000000001";

export const SHARED_SHELL_DEV_EMAIL = "dev-open@shared-shell.local";

/**
 * True only when the beta's runtime environment declares both flags. Reads
 * `process.env` at call time; a unit test can set/clear these before invoking
 * a page. Deliberately NOT a Next build-time inline: the flag is a runtime
 * declaration, and the module is server-only.
 */
export function isSharedShellDevOpen(): boolean {
  return process.env.MMX_SHARED_SHELL === "1"
    && process.env.MMX_SHARED_SHELL_DEV_OPEN === "1";
}
