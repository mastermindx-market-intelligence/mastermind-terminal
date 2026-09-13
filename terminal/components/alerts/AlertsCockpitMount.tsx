"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type Cockpit from "@/components/alerts/AlertsCockpit";

const Lazy = dynamic(() => import("@/components/alerts/AlertsCockpit"));

export default function AlertsCockpitMount(props: ComponentProps<typeof Cockpit>) {
  return <Lazy {...props} />;
}
