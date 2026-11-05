import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TerminalTfDeepLink from "@/components/TerminalTfDeepLink";

export default async function TerminalLayout({ children }: { children: React.ReactNode }) {
  // Gate on the env switch FIRST. `auth.getUser()` is a network round-trip to the Supabase
  // Auth API on every render (it revalidates the token server-side rather than trusting the
  // cookie), and login is disabled in production — TERMINAL_REQUIRE_AUTH is unset, so the
  // previous order paid for that round-trip on every /terminal request and then discarded the
  // answer. The page itself still resolves the user it actually needs for watchlists.
  if (process.env.TERMINAL_REQUIRE_AUTH === "1") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
  }
  // `?tf=` (a Screener result's requested timeframe) is applied beside the page, through the
  // shell's existing `mm:set-tf` seam — see components/TerminalTfDeepLink.tsx.
  return <>{children}<TerminalTfDeepLink /></>;
}
