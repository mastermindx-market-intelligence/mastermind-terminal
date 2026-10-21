import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  applyAuthResponseHeaders,
  applySupabaseResponseCookies,
  authCookieOptions,
} from "@/lib/supabase/cookies";

export async function POST(request: NextRequest) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/login" },
  });
  applyAuthResponseHeaders(response.headers);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          applySupabaseResponseCookies(
            response.headers,
            cookiesToSet,
            headers,
          );
        },
      },
    },
  );
  // Signing out this browser must not revoke refresh tokens on other devices.
  // Account-wide revocation belongs to the separate sign-out-everywhere action.
  await supabase.auth.signOut({ scope: "local" });
  // Path-relative Location (not NextResponse.redirect): behind the reverse proxy Next
  // normalizes request.url to its internal listen origin (https://localhost:3000), and the
  // CSP form-action 'self' then blocks that cross-origin redirect after the form POST —
  // the browser resolves a relative Location against the real host instead.
  return response;
}
