import type { Metadata } from "next";
import InviteAccept from "./InviteAccept";
import { isInviteToken } from "@/lib/teams";

export const metadata: Metadata = {
  title: "Team invitation — Mastermind Terminal",
  // A link with a one-time token in it is never something to index or follow.
  robots: { index: false, follow: false },
};

// MO-PAID-081 (seat ruling W9T_F12_17, link-only): this is where a copied invitation link lands.
// The page is public — `lib/supabase/middleware.ts` PROTECTED does not name it — because the
// person opening it may not have an account session yet. It therefore renders its own plain
// sign-in sentence instead of bouncing, and it never prints the token back as text.
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.token) ? sp.token[0] : sp.token;
  const token = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return <InviteAccept token={isInviteToken(token) ? token : null} />;
}
