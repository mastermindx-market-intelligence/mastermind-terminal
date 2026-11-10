"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type Workspace from "@/components/intelligence/IntelligenceToolWorkspace";
const Lazy = dynamic(()=>import("@/components/intelligence/IntelligenceToolWorkspace"));
export default function IntelligenceToolMount(props:ComponentProps<typeof Workspace>) { return <Lazy {...props} />; }
