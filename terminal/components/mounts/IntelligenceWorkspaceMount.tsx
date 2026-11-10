"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type Workspace from "@/components/intelligence/IntelligenceWorkspace";
const Lazy = dynamic(()=>import("@/components/intelligence/IntelligenceWorkspace"));
export default function IntelligenceWorkspaceMount(props:ComponentProps<typeof Workspace>) { return <Lazy {...props} />; }
