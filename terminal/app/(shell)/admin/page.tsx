import AdminView from "@/components/AdminView";
import { isAdminRequest } from "@/lib/adminGate";
import { notFound, redirect } from "next/navigation";

// Moved under the (shell) route group in Wave-2; URL stays /admin (route groups
// don't affect the path). Admin is off-nav (direct URL only) but now gains the
// shared shell from app/(shell)/layout.tsx — AdminView renders content-only.
//
// Owner plane. isAdminRequest reads cookies → auto-dynamic, never cached.
// Non-admin gets a 404 (don't advertise the route exists); logged-out gets login.
//
// `unavailable` is deliberately NOT folded into either of those. Sending an admin to /login
// during a Supabase blip invites them to re-authenticate against the same broken authority, and
// `notFound()` tells them their console does not exist. Rendering the shell instead lets the
// client's own retry path own the outage — it will get a 503 from the API and say so.
//
// ── This segment has NO loading.tsx, on purpose ──
// It used to inherit one from app/(shell)/loading.tsx, and that boundary silently voided both
// status codes below: React flushed the shell (HTTP 200) behind the fallback while this page was
// still awaiting the gate, and a redirect/notFound raised afterwards can only be delivered as a
// soft client-side navigation inside the RSC payload. Measured on production 2026-08-21 — an
// anonymous GET /admin answered 200 with a workspace skeleton, so monitoring, caches and crawlers
// were told the owner console is OK, and the 307/404 the F-1 work gave the API had no counterpart
// on the page beside it. With no boundary above it, this gate resolves before the first flush and
// the status line is the real answer. Do not add app/(shell)/loading.tsx back — declare the
// fallback per workspace (components/WorkspaceLoading.tsx), and never over this route.
export default async function AdminPage() {
  const verdict = await isAdminRequest();
  if (verdict.status === "anonymous") redirect("/login");
  if (verdict.status === "denied") notFound();
  return <AdminView email={verdict.email ?? ""} authorityUnavailable={verdict.status === "unavailable"} />;
}
