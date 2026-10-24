"use client";
/** Synthetic consumer harness only. Production is always 404. */
import { useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { OptionsPlanPayoffPanel } from "@/components/options/OptionsPlanPayoffPanel";
import { draft } from "@/lib/__tests__/fixtures/optionsPlanPayoff";
export default function OptionsPlanHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Harness />;
}
function Harness() {
  const lang = useSearchParams().get("lang") === "zh" ? "zh" : "en";
  const [source] = useState(draft), [applied, setApplied] = useState(false);
  return <main style={{ maxWidth: 1280, margin: "0 auto", padding: 20 }}>
    <h1>{lang === "en" ? "Synthetic Plan consumer test" : "合成计划消费者测试"}</h1>
    <p>{lang === "en" ? "Fixture only. No provider request or saved account state." : "仅供测试，无服务商请求或账户保存。"}</p>
    <OptionsPlanPayoffPanel scopeKey="fixture-account-selection" draft={source} lang={lang} onDraftChange={() => setApplied(true)} onClose={() => undefined} />
    <output data-testid="draft-returned">{applied ? "canonical-draft-returned" : "not-applied"}</output>
  </main>;
}
