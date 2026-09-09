import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createFixtureDb, fixtureUserId, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import type { WatchlistDb } from "@/lib/watchlists";
import type { Bilingual } from "@/lib/accountExport";

// Owner-scoped account-deletion INTAKE (B-F12-4 / MO-PAID-087, ceiling governance_only).
//
// This route never deletes anything. It records a request in `account_lifecycle_requests`
// (0016) and returns a durable receipt. The identity-side deletion
// (an admin-only Supabase Auth identity call) needs the service-role key, which the
// Terminal does not and must not hold (F12 do_not_redo: no second auth plane). A fabricated
// receipt — claiming a request was recorded when the store write failed — is the one forbidden
// outcome; every non-happy path below returns 503 `request_not_recorded` instead.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const LIFECYCLE_TABLE = "account_lifecycle_requests";

export type LifecycleStepPhase = "immediate" | "asynchronous" | "external";
export type LifecycleStep = { phase: LifecycleStepPhase; done: boolean; text: Bilingual };
export type LifecycleReceipt = {
  receipt_code: string;
  kind: "deletion";
  status: "received" | "in_progress" | "completed" | "cancelled" | "failed";
  requested_at: string;
  account_email: string;
  steps: LifecycleStep[];
};

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

async function resolveSession(): Promise<{ db: WatchlistDb; userId: string; email: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return {
      db: createFixtureDb(key) as unknown as WatchlistDb,
      userId: fixtureUserId(key),
      email: `${fixtureUserId(key)}@fixture.test`,
    };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as WatchlistDb, userId: user.id, email: user.email || "" };
}

const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });

const NOT_RECORDED_MESSAGE: Bilingual = [
  "We could not record your request, so we are not going to pretend we did. Nothing was filed and nothing was changed. Please try again later.",
  "我们无法记录你的请求，因此不会假装已经记录。没有提交任何请求，你的数据也没有任何改动。请稍后再试。",
];

// `status` is advanced only by the operator's elevated store credential — see 0016's table
// comment. A receipt whose status has moved past "received" must say so: rendering the same
// "nothing has been removed yet" sentence for a completed request was the MAJOR acceptance-2
// finding.
function stepsFor(receiptCode: string, status: string): LifecycleStep[] {
  // Every branch here is a real outcome, never inferred: "completed" is the only status where
  // anything was actually removed, and "cancelled"/"failed" must say so plainly rather than
  // reusing the pending sentence — review MAJOR (round 2): a cancelled/failed request was
  // rendering "Nothing has been removed yet… removed by our team after this request", a false
  // statement about a request that is dead, not pending.
  const asyncDone = status === "completed";
  let asyncText: Bilingual;
  if (asyncDone) {
    asyncText = [
      "Your watchlists and positions from this account have been removed.",
      "你的自选与持仓已从此账户中移除。",
    ];
  } else if (status === "cancelled") {
    asyncText = [
      "This request was cancelled. Nothing was removed under it. You can file a new request below.",
      "此请求已被取消，未删除任何内容。你可以在下方提交新的请求。",
    ];
  } else if (status === "failed") {
    asyncText = [
      "This request could not be completed and nothing was removed under it. You can file a new request below.",
      "此请求未能完成，未删除任何内容。你可以在下方提交新的请求。",
    ];
  } else {
    asyncText = [
      "Nothing has been removed yet. Your watchlists and positions are removed by our team after this request, not the moment you file it.",
      "目前尚未删除任何内容。你的自选与持仓会在此请求提交后由我们的团队处理，而不是在你提交的当下。",
    ];
  }
  return [
    {
      phase: "immediate",
      done: true,
      text: [
        `Your request is recorded. Your reference is ${receiptCode}.`,
        `你的请求已记录。参考编号：${receiptCode}。`,
      ],
    },
    {
      phase: "asynchronous",
      done: asyncDone,
      text: asyncText,
    },
    {
      phase: "external",
      // Always false: whether the identity-side deletion ran is a fact this route never has —
      // it is not derived from `status`, which only tracks this table (F12 do_not_redo: no
      // second auth plane). Stated honestly rather than inferred.
      done: false,
      text: [
        "Your sign-in itself is removed on the account service. That is a separate step we do not perform here, so this page cannot tell you it is done.",
        "你的登录身份需在账户服务端删除。那是我们在此处不执行的独立步骤，因此本页无法告诉你它已完成。",
      ],
    },
  ];
}

function receiptCode(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `MMX-DEL-${y}${m}${d}-${rand}`;
}

function rowToReceipt(row: Record<string, unknown>, email: string): LifecycleReceipt {
  const code = String(row.receipt_code ?? "");
  return {
    receipt_code: code,
    kind: "deletion",
    status: (row.status as LifecycleReceipt["status"]) || "received",
    requested_at: String(row.requested_at ?? new Date().toISOString()),
    account_email: email,
    steps: stepsFor(code, (row.status as string) || "received"),
  };
}

export async function GET(): Promise<Response> {
  const session = await resolveSession();
  if (!session) return unauthenticated();

  let result: { data?: unknown; error?: { message?: string; code?: string } | null };
  try {
    result = await session.db
      .from(LIFECYCLE_TABLE)
      .select("receipt_code,status,requested_at,kind")
      .eq("user_id", session.userId)
      .order("requested_at", { ascending: false });
  } catch (cause) {
    console.error("account deletion GET failed:", cause);
    return NextResponse.json({ ok: false, error: "request_not_recorded" }, { status: 503 });
  }
  if (result?.error) {
    console.error("account deletion GET failed:", result.error.message);
    return NextResponse.json({ ok: false, error: "request_not_recorded" }, { status: 503 });
  }
  const rows = Array.isArray(result?.data) ? (result!.data as Record<string, unknown>[]) : [];
  const requests = rows
    .filter((r) => r.kind === "deletion")
    .map((r) => rowToReceipt(r, session.email));
  return NextResponse.json({ requests });
}

export async function POST(req: Request): Promise<Response> {
  const session = await resolveSession();
  if (!session) return unauthenticated();

  let body: { confirm_email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "confirm_email_mismatch" }, { status: 400 });
  }
  const confirmEmail = typeof body.confirm_email === "string" ? body.confirm_email : "";
  if (confirmEmail.trim().toLowerCase() !== session.email.trim().toLowerCase()) {
    return NextResponse.json({ error: "confirm_email_mismatch" }, { status: 400 });
  }

  const now = new Date();
  const code = receiptCode(now);

  let insertResult: { data?: unknown; error?: { message?: string; code?: string } | null };
  try {
    insertResult = await session.db
      .from(LIFECYCLE_TABLE)
      .insert({ user_id: session.userId, kind: "deletion", status: "received", receipt_code: code })
      .select("receipt_code,status,requested_at,kind");
  } catch (cause) {
    console.error("account deletion POST failed:", cause);
    return NextResponse.json(
      { ok: false, error: "request_not_recorded", message: NOT_RECORDED_MESSAGE },
      { status: 503 },
    );
  }

  if (insertResult?.error) {
    const code2 = insertResult.error.code;
    if (code2 === "23505") {
      // Either the receipt_code collided (retry once) or the one-open-deletion index fired
      // (the user already has an open request) — distinguish by re-reading the existing row.
      let existing: { data?: unknown; error?: { message?: string } | null };
      try {
        existing = await session.db
          .from(LIFECYCLE_TABLE)
          .select("receipt_code,status,requested_at,kind")
          .eq("user_id", session.userId)
          .eq("kind", "deletion")
          // Only the two statuses the partial unique index itself treats as "open" (0016:
          // `where kind = 'deletion' and status in ('received', 'in_progress')`) may ever be
          // reported back as "already_open" — ordering by recency alone (review MINOR round 3)
          // could otherwise surface a newer but DEAD (cancelled/failed) row as if the request
          // were still recorded and pending, which is a false statement about a request that
          // did nothing.
          .in("status", ["received", "in_progress"])
          .order("requested_at", { ascending: false })
          .limit(1);
      } catch (cause) {
        console.error("account deletion POST failed on duplicate lookup:", cause);
        return NextResponse.json(
          { ok: false, error: "request_not_recorded", message: NOT_RECORDED_MESSAGE },
          { status: 503 },
        );
      }
      const row = Array.isArray(existing?.data) ? (existing!.data[0] as Record<string, unknown> | undefined) : undefined;
      if (row) {
        return NextResponse.json({ ok: true, receipt: rowToReceipt(row, session.email), already_open: true }, { status: 200 });
      }
    }
    console.error("account deletion POST failed:", insertResult.error.message);
    return NextResponse.json(
      { ok: false, error: "request_not_recorded", message: NOT_RECORDED_MESSAGE },
      { status: 503 },
    );
  }

  const row = Array.isArray(insertResult?.data) ? (insertResult!.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) {
    console.error("account deletion POST: insert returned no row");
    return NextResponse.json(
      { ok: false, error: "request_not_recorded", message: NOT_RECORDED_MESSAGE },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { ok: true, receipt: rowToReceipt(row, session.email), already_open: false },
    { status: 201 },
  );
}
