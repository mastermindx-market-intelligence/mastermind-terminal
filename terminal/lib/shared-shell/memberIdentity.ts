import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./readingContracts";

export type ShellMember = { state: "ready"; subjectId: string } | { state: "guest" } | { state: "unavailable" };
export const MEMBER_READ_TIMEOUT_MS = 12_000;
/** Existing server auth is the authority. The result contains no session or user metadata. */
export async function readShellMember(): Promise<ShellMember> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<ShellMember>([
      (async () => {
        const client = await createClient();
        const { data, error } = await client.auth.getUser();
        if (error) return { state: error.name === "AuthSessionMissingError" || [401,403].includes(error.status ?? 0) ? "guest" : "unavailable" };
        return data.user && isUuid(data.user.id) ? { state: "ready", subjectId: data.user.id } : { state: "guest" };
      })(),
      new Promise<ShellMember>(resolve => { timer = setTimeout(() => resolve({ state: "unavailable" }), MEMBER_READ_TIMEOUT_MS); }),
    ]);
  } catch { return { state: "unavailable" }; }
  finally { if (timer) clearTimeout(timer); }
}
