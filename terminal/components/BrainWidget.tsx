"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type BrainWidgetImplType from "./BrainWidgetImpl";

type Props = ComponentProps<typeof BrainWidgetImplType>;

const BrainWidgetImpl = dynamic(() => import("./BrainWidgetImpl"), {
  ssr: false,
  loading: () => null,
});

export default function BrainWidget(props: Props) {
  return <BrainWidgetImpl {...props} />;
}
