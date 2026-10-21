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
  return <SymbolPicker symbol={symbol ?? ""} open={open} onOpenChange={onOpenChange}
    onPick={next => {
      writeActiveSymbol(next);
      onOpenChange(false);
      router.push("/analysis?symbol=" + encodeURIComponent(next));
    }}
    className="shared-shell-company-search"
    eyebrow={t("shellSearchCompanies")}
    label={t("shellSearchCompanies")}
    displayLabel={t("shellSearchPlaceholder")}
    mark="⌕"
    trackSource="shared-shell"
  />;
}
