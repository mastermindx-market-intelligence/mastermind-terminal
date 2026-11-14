"use client";
import dynamic from "next/dynamic";
const MacroDashboard = dynamic(() => import("@/components/macro/MacroDashboard"));
export default function MacroDashboardMount({ ownerKey }: { ownerKey: string }) {
  return <MacroDashboard key={ownerKey} ownerKey={ownerKey} />;
}
