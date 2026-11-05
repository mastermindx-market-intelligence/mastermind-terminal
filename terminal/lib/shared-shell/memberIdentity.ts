import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./readingContracts";

export type ShellMember = { state: "ready"; subjectId: string } | { state: "guest" } | { state: "unavailable" };
export type ShellClaims = { state: "ready"; subjectId: string; email: string } | Exclude<ShellMember, { state: "ready" }>;
export const MEMBER_READ_TIMEOUT_MS = 12_000;

function authFailure(error: { name: string; status?: number }, accessDenialMeansGuest: boolean): { state: "guest" | "unavailable" } {
  return { state: error.name === "AuthSessionMissingError" || (accessDenialMeansGuest && [401, 403].includes(error.status ?? 0)) ? "guest" : "unavailable" };
}

async function boundedRead<T>(read: () => Promise<T>): Promise<T | { state: "unavailable" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<{ state: "unavailable" }>(resolve => { timer = setTimeout(() => resolve({ state: "unavailable" }), MEMBER_READ_TIMEOUT_MS); }),
    ]);
  } catch { return { state: "unavailable" }; }
  finally { if (timer) clearTimeout(timer); }
}

/** Existing server auth is the authority. The result contains no session or user metadata. */
export async function readShellMember(): Promise<ShellMember> {
  return boundedRead<ShellMember>(async () => {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error) return authFailure(error, true);
    return data.user && isUuid(data.user.id) ? { state: "ready", subjectId: data.user.id } : { state: "guest" };
  });
}

/** Local verified claims for shared chrome and Analysis; no additional getUser call. */
export async function readShellClaims(): Promise<ShellClaims> {
  return boundedRead<ShellClaims>(async () => {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    // A failed verifier cannot establish an anonymous or authenticated identity,
    // including when stale claims accompany the failure. Only missing-session
    // provenance is a guest result; a bare HTTP status is not that provenance.
    if (error) return authFailure(error, false);
    const claims = data?.claims;
    if (claims == null) return { state: "guest" };
    if (typeof claims.sub !== "string" || !isUuid(claims.sub)) return { state: "unavailable" };
    return { state: "ready", subjectId: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
  });
}
