import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AlertsCockpitMount from "@/components/alerts/AlertsCockpitMount";
import AlertsViewMount from "@/components/mounts/AlertsViewMount";
import SignupGate from "@/components/gates/SignupGate";

// Alerts (Wave-3 IA) — split back out of the former Automate page into its own
// /alerts route. Shared chrome from app/(shell)/layout.tsx. The page only resolves
// the signed-in email (auth reads cookies → auto-dynamic); AlertsCockpitMount is the
// ONE client component that brings the page's <main className="main2"><div
// className="pg">, and it renders as its single composition.
//
// Member surface: an alert is a row on the user's account that the 5-min VPS cron
// evaluates, so there is nothing a guest can create here — signed-out visitors get
// the sign-up gate. The chart (/terminal) is what stays open to guests.
//
// B-F08-3: the monitor/delivery cockpit composes ABOVE the existing create/pause/
// delete management view — it augments that surface, it does not replace it. The
// cockpit renders its own create form inline (NewAlertPanel, id="alerts-manage" —
// the cockpit's own "Add a watch" empty-state action scrolls there); the
// existing-alerts list (ExistingAlertsPanel via `listOnly`, passed as `children`) is
// mounted INSIDE the cockpit's own container, directly below it, so pause/rearm/
// delete stay reachable without a second, duplicate "New alert" form and without a
// second page-level <main>/`.pg` — this is one page composition, not two mounts
// stitched together at the page level.

export const metadata: Metadata = { title: "Alerts · Mastermind Terminal" };

function AlertsSurfaces({ email }: { email: string }) {
  return (
    <AlertsCockpitMount email={email}>
      <AlertsViewMount email={email} listOnly />
    </AlertsCockpitMount>
  );
}

export default async function AlertsPage() {
  if (process.env.TERMINAL_E2E_FIXTURE === "1") {
    return <AlertsSurfaces email={process.env.TERMINAL_E2E_EMAIL || "responsive@example.com"} />;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <SignupGate surface="alerts" />;
  return <AlertsSurfaces email={user.email || ""} />;
}
