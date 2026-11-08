import "server-only";
import { NextResponse } from "next/server";
import { readInvestigationBootAdmission, hasObservedInvestigationClosure, observeInvestigationClosure } from "./investigationBootAdmission";

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
 * time, in addition to the immutable negative boot ceiling below. Each process must actually receive its
 * service configuration; editing an external env file is not a hot reload.
 * The Linux initial environment is an additional immutable ceiling. Once THIS
 * Node realm observes a closed request it cannot reopen; no restart authority is
 * granted. Unobserved historical changes before lazy import are not attested.
 * Already admitted requests are not cancelled. It returns null when the surface is
 * open; otherwise it returns the shared 503 envelope for every handler to
 * return verbatim, before any auth, rate-limit, body or RPC work.
 */

export function investigationApiAdmission(value: unknown): boolean {
  return value === "open";
}

// A lazy route import must not confuse current env with the Linux execve block.
// Default-CLOSED imports perform no proc read. A negative ceiling never opens.
const bootAllowsOpen = investigationApiAdmission(process.env.INVESTIGATION_API_ADMISSION) && readInvestigationBootAdmission();
if (!bootAllowsOpen) observeInvestigationClosure();

const closedHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie" };

export function investigationApiUnavailable(): NextResponse | null {
  if (!investigationApiAdmission(process.env.INVESTIGATION_API_ADMISSION)) observeInvestigationClosure();
  if (bootAllowsOpen && !hasObservedInvestigationClosure()) return null;
  return NextResponse.json({ status: "unavailable" }, { status: 503, headers: closedHeaders });
}
