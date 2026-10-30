"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type Workspace from "@/components/workspaces/InvestigationWorkspace";
const Lazy=dynamic(()=>import("@/components/workspaces/InvestigationWorkspace"));
export default function InvestigationWorkspaceMount(props:ComponentProps<typeof Workspace>){return <Lazy {...props}/>;}
