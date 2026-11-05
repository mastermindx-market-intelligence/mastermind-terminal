// Google OAuth kickoff for the onboarding wizard.
//
// Saves the in-progress wizard state to localStorage (so the provider can restore
// it after the redirect round-trip), then hands off to Supabase's Google provider.
// The redirect lands on /auth/callback (owned by the provider agent) which exchanges
// the code and bounces back to the current route and query with onboard=resume.

import { createClient } from "@/lib/supabase/client";
import { LS_ONBOARD_RESUME, type OnboardResumeStash } from "./types";

export async function startGoogleOAuth(stash: OnboardResumeStash): Promise<{ error: string | null }> {
  try {
    localStorage.setItem(LS_ONBOARD_RESUME, JSON.stringify(stash));
  } catch {
    // Non-fatal: OAuth still proceeds; resume just won't restore step/name/prefs.
  }
  const supabase = createClient();
  // Keep the selected company, research context and nested dashboard return URL.
  // Set only the resume control; duplicate research fields retain their validation.
  const query = new URLSearchParams(location.search);
  query.set("onboard", "resume");
  const next = encodeURIComponent(location.pathname + "?" + query.toString());
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/auth/callback?next=${next}` },
  });
  // On success the browser navigates away; if it returns here, surface the error.
  return { error: error ? error.message : null };
}
