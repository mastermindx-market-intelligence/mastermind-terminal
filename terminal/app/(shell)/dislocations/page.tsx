import { createClient } from "@/lib/supabase/server";
import DislocationsViewMount from "@/components/mounts/DislocationsViewMount";
import SignupGate from "@/components/gates/SignupGate";

// Member surface: dislocation rows are joined to the signed-in watchlist / book on the API.
// Chrome from app/(shell)/layout.tsx — DislocationsView renders content-only.
// dynamic='auto': supabase reads cookies → Next auto-detects dynamic.

export default async function DislocationsPage() {
  if (process.env.TERMINAL_E2E_FIXTURE === "1") {
    return <DislocationsViewMount />;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // SignupGate surface key lands in a sibling nav/i18n lane; gate copy is unchanged until then.
  // @ts-expect-error dislocations surface wired outside this lane
  if (!user) return <SignupGate surface="dislocations" />;

  return <DislocationsViewMount />;
}
