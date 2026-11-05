import { NextResponse } from "next/server";
import {
  isSharedShellEnabled, SHARED_SHELL_BUILD, SHARED_SHELL_BRIDGE_VERSION,
  SHARED_SHELL_DOCUMENT_VERSION, SHARED_SHELL_PROTOCOL,
} from "@/lib/sharedShellContracts";
import { sharedShellSource } from "@/lib/sharedShellRoutes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json({
    enabled: isSharedShellEnabled(process.env.MMX_SHARED_SHELL) && SHARED_SHELL_BUILD !== "unversioned",
    protocol: SHARED_SHELL_PROTOCOL,
    buildId: SHARED_SHELL_BUILD,
    bridgeVersion: SHARED_SHELL_BRIDGE_VERSION,
    documentVersion: SHARED_SHELL_DOCUMENT_VERSION,
    registrySha256: sharedShellSource.registrySha256,
  }, { headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
  } });
}
