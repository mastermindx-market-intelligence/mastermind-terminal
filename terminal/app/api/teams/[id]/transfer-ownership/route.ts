import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  TEAM_ROUTE_MESSAGES,
  transferOwnership,
  type TeamRouteCode,
  type TenancyRpcDb,
} from "@/lib/teams";

export const runtime = "nodejs";

function errorBody(error: string, code: TeamRouteCode) {
  const [message, messageZh] = TEAM_ROUTE_MESSAGES[code];
  return { error, message, messageZh };
}

const unauthenticated = () =>
  NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
const invalid = (code: TeamRouteCode, status = 400) =>
  NextResponse.json(errorBody("INVALID", code), { status });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthenticated();

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return invalid("send_json");

  const newOwnerUserId = typeof body.newOwnerUserId === "string" ? body.newOwnerUserId.trim() : "";
  // The function is the source of truth. This route validates UUID shape, then relays.
  const result = await transferOwnership(supabase as unknown as TenancyRpcDb, id, newOwnerUserId);
  if (!result.success) {
    const code = result.message;
    const status = result.status;
    const error =
      status === 401
        ? "UNAUTHENTICATED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : status === 409
              ? "CONFLICT"
              : status === 400
                ? "INVALID"
                : status === 503
                  ? "READ_UNAVAILABLE"
                  : "WRITE_FAILED";
    return NextResponse.json(errorBody(error, code), { status });
  }
  const [message, messageZh] = TEAM_ROUTE_MESSAGES.transfer_success;
  return NextResponse.json({
    success: true,
    newOwnerId: result.newOwnerId,
    message,
    messageZh,
  });
}
