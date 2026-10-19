"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type Manager from "@/components/alerts/AlertBulkManager";

// E18: the alert management panel stays out of the signed-out /alerts graph (guest-bundle law).
const Lazy = dynamic(() => import("@/components/alerts/AlertBulkManager"));

export default function AlertBulkManagerMount(props: ComponentProps<typeof Manager>) {
  return <Lazy {...props} />;
}
