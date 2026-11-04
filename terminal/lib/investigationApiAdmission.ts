import "server-only";
import { NextResponse } from "next/server";

/**
 * Server-only admission gate for the Investigation API surface.
 *
 * `investigationApiAdmission` is the pure decision: ONLY the exact literal
 * "open" is admitted. A missing, empty, whitespace-padded, differently cased
 * or mistyped value fails CLOSED, so no misconfiguration can widen the
 * surface. There is no default-open path and no test bypass here — the fixture
 * environments opt in explicitly through their own env blocks.
 *
 * `investigationApiUnavailable` reads INVESTIGATION_API_ADMISSION at REQUEST
 * time (never at import or build time). Each process must actually receive its
 * service configuration; editing an external env file is not a hot reload.
 * Already admitted requests are not cancelled. It returns null when the surface is
 * open; otherwise it returns the shared 503 envelope for every handler to
 * return verbatim, before any auth, rate-limit, body or RPC work.
 */

export function investigationApiAdmission(value: unknown): boolean {
  return value === "open";
}

const closedHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie" };

export function investigationApiUnavailable(): NextResponse | null {
  if (investigationApiAdmission(process.env.INVESTIGATION_API_ADMISSION)) return null;
  return NextResponse.json({ status: "unavailable" }, { status: 503, headers: closedHeaders });
}
