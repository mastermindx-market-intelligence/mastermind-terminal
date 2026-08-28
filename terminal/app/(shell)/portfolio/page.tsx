import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import PortfolioViewMount from "@/components/mounts/PortfolioViewMount";
import SignupGate from "@/components/gates/SignupGate";
import { readPositions } from "@/lib/portfolio";
import { createFixtureDb, fixtureFaults, fixtureUserId, FIXTURE_FAULT_COOKIE, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";

// W5: this page is the user's REAL portfolio.
//
// Until this wave it rendered WATCHLIST symbols under the name "Conviction Book" — a different
// population wearing the portfolio's name, which is the mismatch the commissioning packet exists
// to close (section 1d). `portfolio_positions` has been live in the shared Supabase project since
// <= 2026-07-18 with ZERO Terminal references; it is now the only thing this page reads.
//
// Watchlists are NOT here any more. Watchlist selection lives in the charting rail, where the job
// is "monitor names"; this page's job is "see what I hold" (packet section 6). A user with ten
// watchlists and no positions correctly sees an empty book — not ten tabs of somebody else's idea
// of their portfolio.
//
// Member surface: a book is per-user data (RLS-scoped), so signed-out visitors get the sign-up gate
// instead. The chart (/terminal) is what stays open to guests.
//
// Chrome comes from app/(shell)/layout.tsx — PortfolioView renders content-only.
// dynamic='auto': supabase reads cookies → Next auto-detects dynamic.

export default async function PortfolioPage() {
  // Deterministic responsive proof only. Production still fails closed through Supabase auth
  // below; this env flag exists solely in the Playwright dev server. The fixture path reads the
  // SAME service against the SAME account-shaped store `POST /api/portfolio` writes, so what a
  // spec creates is what this page renders — there is no parallel fixture truth to drift from.
  if (process.env.TERMINAL_E2E_FIXTURE === "1") {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    const faults = fixtureFaults(jar.get(FIXTURE_FAULT_COOKIE)?.value);
    const read = await readPositions(createFixtureDb(key, faults), fixtureUserId(key));
    return (
      <PortfolioViewMount
        positions={read.ok ? read.positions : []}
        unreadable={!read.ok}
        email={process.env.TERMINAL_E2E_EMAIL || "responsive@example.com"}
      />
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <SignupGate surface="portfolio" />;

  // RLS (`portfolio_select_own`) is the authority; the explicit `user_id` filter inside
  // `readPositions` is the same belt-and-braces the watchlist reads carry.
  //
  // An unreachable store still does not 500 the page — but it no longer renders the empty book
  // either. The previous version described `[]` as "the honest empty state"; it is the opposite
  // of honest on a holdings surface, and in practice the service had already swallowed the error
  // before this try/catch could observe it. The view now receives the FACT that the read failed
  // and says so, with a retry that re-reads through the same /api/portfolio contract.
  const read = await readPositions(supabase as never, user.id);
  return (
    <PortfolioViewMount
      positions={read.ok ? read.positions : []}
      unreadable={!read.ok}
      email={user.email || ""}
    />
  );
}
