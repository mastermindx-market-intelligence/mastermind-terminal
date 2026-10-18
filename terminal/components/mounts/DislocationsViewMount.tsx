"use client";
import dynamic from "next/dynamic";
import RouteSkeleton from "@/components/RouteSkeleton";

/**
 * Guest/member module boundary for /dislocations. See components/mounts/README.md.
 */
const Lazy = dynamic(() => import("@/components/dislocations/DislocationsView"), {
  loading: () => <RouteSkeleton title="Dislocations" variant="table" bare />,
});

export default function DislocationsViewMount() {
  return <Lazy />;
}
