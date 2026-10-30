"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type Workspace from "@/components/workspaces/TodayWorkspace";
const Lazy = dynamic(() => import("@/components/workspaces/TodayWorkspace"));
/** Guest/member chunk boundary, following components/mounts/README.md. */
export default function TodayWorkspaceMount(props: ComponentProps<typeof Workspace>) { return <Lazy {...props} />; }
