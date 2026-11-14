"use client";
import ShellSearch from "./ShellSearch";
import SharedShellPresentationControls from "./SharedShellPresentationControls";
import SharedShellMarketSelect from "./SharedShellMarketSelect";

export default function SharedShellToolbar({ symbolOpen, onSymbolOpenChange }: {
  symbolOpen: boolean; onSymbolOpenChange: (open: boolean) => void;
}) {
  return <div className="shared-shell-toolbar">
    <ShellSearch open={symbolOpen} onOpenChange={onSymbolOpenChange} />
    <SharedShellPresentationControls />
    <SharedShellMarketSelect />
  </div>;
}
