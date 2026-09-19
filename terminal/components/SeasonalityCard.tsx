"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type SeasonalityCardImplType from "./SeasonalityCardImpl";

type Props = ComponentProps<typeof SeasonalityCardImplType>;

const SeasonalityCardImpl = dynamic(() => import("./SeasonalityCardImpl"), {
  ssr: false,
  loading: () => null,
});

export default function SeasonalityCard(props: Props) {
  return <SeasonalityCardImpl {...props} />;
}
