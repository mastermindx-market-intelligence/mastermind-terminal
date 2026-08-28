"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
// `import type` is fully erased — this never becomes a runtime edge into the guest graph.
import type Workspace from "@/components/AlertsView";

/**
 * Guest/member module boundary for /alerts. See components/mounts/README.md for why this
 * exists and why a server-side `await import()` does not work.
 */
const Lazy = dynamic(() => import("@/components/AlertsView"));

export default function AlertsViewMount(props: ComponentProps<typeof Workspace>) {
  return <Lazy {...props} />;
}
