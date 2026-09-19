"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type StockAnalysisImplType from "./StockAnalysisImpl";

type Props = ComponentProps<typeof StockAnalysisImplType>;

const StockAnalysisImpl = dynamic(() => import("./StockAnalysisImpl"), {
  ssr: false,
  loading: () => <div aria-hidden="true" style={{ minHeight: 280 }} />,
});

export default function StockAnalysis(props: Props) {
  return <StockAnalysisImpl {...props} />;
}
