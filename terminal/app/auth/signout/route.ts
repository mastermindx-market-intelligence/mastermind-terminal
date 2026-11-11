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
  // Signing out here must not revoke sessions on other devices. Even when
  // the Auth API returns an error, expire the CURRENT browser's cookies at
  // both parent-domain and legacy host-only scope so a subsequent visit
  // cannot accidentally restore the session during an Auth outage.
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // An offline Auth service must not trap the visitor in a signed-in tab.
  } finally {
    const authCookies = request.cookies.getAll().filter(({ name }) =>
      /^sb-[a-z0-9]+-auth-token(?:\.\d+|-code-verifier(?:\.\d+)?)?$/.test(name),
    );
    applySupabaseResponseCookies(
      response.headers,
      authCookies.map(({ name }) => ({
        name,
        value: "",
        options: { ...authCookieOptions(), maxAge: 0, expires: new Date(0) },
      })),
      {},
    );
  }
  // Path-relative Location (not NextResponse.redirect): behind the reverse proxy Next
  // normalizes request.url to its internal listen origin (https://localhost:3000), and the
  // CSP form-action 'self' then blocks that cross-origin redirect after the form POST —
  // the browser resolves a relative Location against the real host instead.
  return response;
}
