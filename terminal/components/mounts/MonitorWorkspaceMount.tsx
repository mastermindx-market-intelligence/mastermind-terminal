"use client";
import dynamic from "next/dynamic";
const Lazy = dynamic(() => import("@/components/workspaces/MonitorWorkspace"));
/** Guest/member chunk boundary, following components/mounts/README.md. */
export default function MonitorWorkspaceMount() { return <Lazy />; }
