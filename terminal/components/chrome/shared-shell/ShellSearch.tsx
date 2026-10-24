"use client";
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
