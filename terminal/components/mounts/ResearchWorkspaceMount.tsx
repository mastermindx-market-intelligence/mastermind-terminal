"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type Workspace from "@/components/workspaces/ResearchWorkspace";
const Lazy = dynamic(() => import("@/components/workspaces/ResearchWorkspace"));
/** Guest/member chunk boundary, following components/mounts/README.md. */
export default function ResearchWorkspaceMount(props: ComponentProps<typeof Workspace>) { return <Lazy {...props} />; }
