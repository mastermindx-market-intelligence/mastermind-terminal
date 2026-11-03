"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SHARED_SHELL_NAV, sharedShellActiveKey } from "@/lib/sharedShellNavigation";
import { intelligenceActiveKey } from "@/lib/shared-shell/intelligenceNavigation";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { navHref } from "@/lib/navSymbol";
import { Tip } from "@/components/ui/Tip";
import IntelligenceNav from "./IntelligenceNav";

/** Read the query only for the beta's own nav. Ordinary AppNav and MobileNav never
 * subscribe to it; their legacy preview/runtime tests and CSR boundaries stay intact. */
export default function SharedShellPrimaryNav({ mode, labelled, activeSymbol, activeKeyOverride, renderGlyph, onNavigate }: {
  mode: "rail" | "drawer";
  labelled: boolean;
  activeSymbol: string | null | undefined;
  activeKeyOverride?: string;
  renderGlyph: (key: string) => ReactNode;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const search = useSearchParams();
  const t = useSharedShellT();
  const intelligenceKey = intelligenceActiveKey(path, search.toString());
  const activeKey = intelligenceKey ? null : (activeKeyOverride ?? sharedShellActiveKey(path));
  return <>
    {SHARED_SHELL_NAV.map(item => {
      const selected = item.k === activeKey;
      const label = t(item.k, item.label);
      const href = navHref(item, activeSymbol, path);
      return mode === "rail" ? (
        <Tip key={item.k} label={label} side="right" size="mini" disabled={labelled}>
          <Link href={href} className={`navbtn${selected ? " on" : ""}`}
            aria-current={selected ? "page" : undefined} aria-label={label}>
            {renderGlyph(item.k)}{labelled && <span className="investor-nav-label">{label}</span>}
          </Link>
        </Tip>
      ) : (
        <Link key={item.k} href={href} className={selected ? "on" : ""}
          aria-current={selected ? "page" : undefined} onClick={onNavigate}>
          {renderGlyph(item.k)}{label}
        </Link>
      );
    })}
    <IntelligenceNav mode={mode} labelled={labelled} onNavigate={onNavigate} />
  </>;
}
