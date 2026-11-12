import { createClient } from "@/lib/supabase/server";
import { isSharedShellDevOpen } from "@/lib/shared-shell/devOpen";
import DislocationsViewMount from "@/components/mounts/DislocationsViewMount";
import SignupGate from "@/components/gates/SignupGate";

// Member surface: dislocation rows are joined to the signed-in watchlist / book on the API.
// Chrome from app/(shell)/layout.tsx — DislocationsView renders content-only.
// dynamic='auto': supabase reads cookies → Next auto-detects dynamic.

export default async function DislocationsPage() {
  if (process.env.TERMINAL_E2E_FIXTURE === "1") {
    return <DislocationsViewMount />;
  }

  // Beta development mode (lib/shared-shell/devOpen.ts): open the surface to
  // signed-out development sessions without the member gate or any auth read.
  if (isSharedShellDevOpen()) return <DislocationsViewMount />;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <SignupGate surface="dislocations" />;

  return <DislocationsViewMount />;
}
