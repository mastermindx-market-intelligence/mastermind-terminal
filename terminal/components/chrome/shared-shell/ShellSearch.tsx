"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SymbolPicker from "@/components/SymbolPicker";
import { useActiveSymbol, writeActiveSymbol } from "@/lib/activeSymbol";
import { useSharedShellT } from "@/lib/sharedShellCopy";

export default function ShellSearch({ open, onOpenChange }: {
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const symbol = useActiveSymbol();
  const t = useSharedShellT();
  // SymbolPicker starts the ~2.2 MB manifest request on idle. Keep its trigger
  // available immediately, but don't mount the data owner until genuine search
  // intent. This does not edit or shadow SymbolPicker's recovery/cache policy.
  const [activated, setActivated] = useState(open);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- retain the real picker after a programmatic keyboard opening.
    if (open) setActivated(true);
  }, [open]);
  if (!activated) {
    return (
      <button type="button" className="sym-pick shared-shell-company-search"
        aria-label={t("shellSearchCompanies")} aria-haspopup="dialog" aria-expanded={false}
        title={t("shellSearchCompanies")}
        onPointerEnter={() => setActivated(true)}
        onClick={() => { setActivated(true); onOpenChange(true); }}>
        <span className="sym-pick-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
        </span>
        <span className="sym-pick-id">
          <small>{t("shellSearchCompanies")}</small>
          <strong>{t("shellSearchPlaceholder")}</strong>
        </span>
        <svg className="sym-pick-car" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    );
  }
  return <SymbolPicker scope="companies" symbol={symbol ?? ""} open={open} onOpenChange={onOpenChange}
    onPick={next => {
      writeActiveSymbol(next);
      onOpenChange(false);
      router.push("/analysis?symbol=" + encodeURIComponent(next));
    }}
    className="shared-shell-company-search"
    eyebrow={t("shellSearchCompanies")}
    label={t("shellSearchCompanies")}
    displayLabel={t("shellSearchPlaceholder")}
    mark={<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>}
    trackSource="shared-shell"
  />;
}
