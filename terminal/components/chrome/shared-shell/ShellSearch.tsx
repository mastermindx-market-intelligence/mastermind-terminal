"use client";
import { useRouter } from "next/navigation";
import SymbolPicker from "@/components/SymbolPicker";
import { useActiveSymbol, writeActiveSymbol } from "@/lib/activeSymbol";
import { useT } from "@/lib/i18n";

export default function ShellSearch({ open, onOpenChange }: {
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const symbol = useActiveSymbol();
  const t = useT();
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
