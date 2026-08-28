"use client";
import dynamic from "next/dynamic";

/**
 * Guest/member module boundary for /discover. See components/mounts/README.md for why this
 * exists and why a server-side `await import()` does not work. Takes no props — the workspace
 * reads everything it needs from the shell context and the URL.
 */
const Lazy = dynamic(() => import("@/components/workspaces/DiscoverWorkspace"));

export default function DiscoverWorkspaceMount() {
  return <Lazy />;
}
