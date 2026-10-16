"use client";
import dynamic from "next/dynamic";
import type { FuturesRequest } from "@/lib/futuresRequest";
// Existing paid-workspace mount pattern: a denied page never mounts the data consumer.
const Workspace = dynamic(() => import("@/components/futures/FuturesWorkspaceView"));
export default function FuturesWorkspaceMount({ initialRequest }: { initialRequest: FuturesRequest }) {
  return <Workspace initialRequest={initialRequest} />;
}
