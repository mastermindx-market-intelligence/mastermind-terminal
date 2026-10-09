import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/chrome/AppShell";

/**
 * Route-group layout for every non-chart workspace (Discover / Research /
 * Automate / Portfolio / Admin). The route group `(shell)` does NOT affect the
 * URL — `app/(shell)/portfolio/page.tsx` still serves `/portfolio`.
 *
 * Auth is resolved ONCE here (the same supabase getUser() pattern the old
 * per-page routes used) and the resolved AccountIdentity is handed to the shared
 * AppShell, which forwards it to MobileNav / SettingsButton and exposes it to
 * client children via useShellIdentity() / useShellEmail(). Pages that need the
 * user for data (portfolio watchlists, scripts seeding, admin gate) still resolve
 * it themselves — this read is for the chrome only and is cheap/deduped by
 * supabase's per-request client.
 *
 * BOTH claims are taken, not just the email: `sub` is the immutable auth uuid and
 * is the OWNERSHIP key every owner-scoped client store (preferences, watchlists,
 * entitlement) is keyed on, while `email` is display/routing information only. The
 * shell used to extract the email and discard the subject, which left the client
 * stores to key ownership on a mutable, reassignable address — see
 * lib/accountIdentity.ts for why that is a boundary failure rather than a
 * cosmetic one.
 *
 * This shell is explicitly dynamic and private because it contains auth state.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Opt-in fixture identity for research consumers; unrelated suites keep their existing identity.
  // Both development and the existing fixture flag are required; production uses verified claims.
  if (process.env.NODE_ENV === "development" && process.env.TERMINAL_E2E_FIXTURE === "1") {
    const jar = await cookies();
    if (jar.get("mm_e2e_rs30")?.value === "1") {
      const guest = jar.get("mm_e2e_guest")?.value === "1";
      return <AppShell email={guest ? "" : process.env.TERMINAL_E2E_EMAIL ?? "responsive@example.com"}
        userId={guest ? "" : "terminal-responsive-fixture"}>{children}</AppShell>;
    }
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : "";
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : "";
  return <AppShell email={email} userId={userId}>{children}</AppShell>;
}
