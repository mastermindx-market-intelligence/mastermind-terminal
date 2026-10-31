"use client";
import dynamic from "next/dynamic";
const Replay = dynamic(() => import("@/components/futures/IexDepthReplayView"));
export default function IexDepthReplayMount({ initialSymbol }: { initialSymbol: string }) {
  return <Replay initialSymbol={initialSymbol} />;
}
