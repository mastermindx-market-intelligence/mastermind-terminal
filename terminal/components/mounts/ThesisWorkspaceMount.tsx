"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type Workspace from "@/components/workspaces/ThesisWorkspace";

/** Member-only bundle boundary for `/analysis?view=theses`. SSR intentionally remains enabled. */
const Lazy = dynamic(() => import("@/components/workspaces/ThesisWorkspace"));

export default function ThesisWorkspaceMount(props: ComponentProps<typeof Workspace>) {
  return <Lazy {...props} />;
}
