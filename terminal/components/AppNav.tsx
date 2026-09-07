"use client";
import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useActiveSymbol } from "@/lib/activeSymbol";
// The nav-decoration policy is a leaf module so both nav surfaces share one rule and it can be
// unit-tested without mounting a nav.
import { navHref } from "@/lib/navSymbol";
import { Tip } from "@/components/ui/Tip";

// Line glyphs — all share the 24-box, 1.7-stroke, fill:none house style (.navbtn svg).
// Multi-path keys draw each `d` as a stacked <path>; a few workspaces need composite
// primitives (arc + line + blip, etc.) and render inline below.
const ICON: Record<string, string[]> = {
  chart: ["M3 17l5-6 4 3 4-7 5 9", "M3 21h18"],
  // Analysis — an analytics card: a rounded frame holding three fundamentals bars.
  analysis: ["M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z", "M8 16v-3", "M12 16v-6", "M16 16v-4"],
  // Options — a long-call payoff diagram: L-axes with the flat-then-rising hockey stick.
  options: ["M4 4v16h16", "M8 15h3l6-8"],
  // Scripts — code angle-brackets with a script slash between them.
  scripts: ["M9 8l-4 4 4 4", "M15 8l4 4-4 4", "M13.5 7l-3 10"],
  portfolio: ["M21 12a9 9 0 1 1-9-9v9z"],
  // Alerts — a notification bell with its clapper.
  alerts: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  ai: ["M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z"],
};

export function Glyph({ k }: { k: string }) {
  // Discover — radar scan: one open concentric arc (the sweep boundary) + a sweep line
  // from center out to a blip on the ring. "Scan the market for setups" reads truer than
  // a literal compass rose, and stays legible at 20px.
  if (k === "discover")
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 4a8 8 0 1 1-8 8" />
        <path d="M8 8a5.5 5.5 0 1 0 4-2" />
        <path d="M12 12l5.5-4" />
        <circle cx="17.5" cy="8" r="1.15" fill="currentColor" stroke="none" />
      </svg>
    );
  return (<svg viewBox="0 0 24 24">{(ICON[k] ?? []).map((d, i) => <path key={i} d={d} />)}</svg>);
}

// The single source of truth for the primary nav. Exported so the mobile drawer (MobileNav)
// derives its items from the SAME list — the two nav surfaces can't drift. Wave-3: the
// options hub is renamed Options; Fundamentals is promoted to its own Analysis page; Automate
// is split back into standalone Scripts + Alerts.
export const TOP = [
  { k: "chart", label: "Chart", href: "/terminal" },
  { k: "analysis", label: "Analysis", href: "/analysis" },
  { k: "discover", label: "Discover", href: "/discover" },
  { k: "options", label: "Options", href: "/options" },
  { k: "scripts", label: "Scripts", href: "/scripts" },
  { k: "portfolio", label: "Portfolio", href: "/portfolio" },
  { k: "alerts", label: "Alerts", href: "/alerts" },
];

// useSearchParams() forces a CSR bailout during static prerender; the primary nav no longer
// reads params (active key is pure path-prefix), but the Suspense boundary is retained so the
// nav keeps rendering a stable fallback while the shell hydrates.
export function AppNav() {
  return (
    <Suspense fallback={<nav className="appnav" aria-label="Primary" />}>
      <AppNavInner />
    </Suspense>
  );
}

function AppNavInner() {
  const path = usePathname();
  const router = useRouter();
  const t = useT();
  const activeSymbol = useActiveSymbol();
  // Active key = path prefix per workspace. Chart is the default/center. Fundamentals now
  // owns its own top-level Analysis highlight (/analysis); the chart's in-shell fundamentals
  // pane still exists but no longer drives the nav.
  const activeKey = path.startsWith("/analysis") ? "analysis"
    : path.startsWith("/discover") ? "discover"
    : path.startsWith("/options") ? "options"
    : path.startsWith("/scripts") ? "scripts"
    : path.startsWith("/alerts") ? "alerts"
    : path.startsWith("/portfolio") ? "portfolio"
    : "chart";
  const openAI = () => { if (path.startsWith("/terminal")) window.dispatchEvent(new CustomEvent("mm:copilot")); else router.push("/terminal?ai=1"); };
  return (
    <nav className="appnav" aria-label="Primary">
      {TOP.map((it) => {
        const on = it.k === activeKey;
        return (
          <Tip key={it.k} label={t(it.k, it.label)} side="right" size="mini">
            <Link
              href={navHref(it, activeSymbol, path)}
              onClick={path.startsWith("/terminal") && it.k === "chart" ? () => window.dispatchEvent(new CustomEvent("mm:close-pane")) : undefined}
              className={`navbtn${on ? " on" : ""}`}
              aria-current={on ? "page" : undefined}
              aria-label={t(it.k, it.label)}
            ><Glyph k={it.k} /></Link>
          </Tip>
        );
      })}
      <div className="gap" />
      <Tip label={t("ai")} side="right" size="mini">
        <button className="navbtn" onClick={openAI} aria-label={t("ai")}><Glyph k="ai" /></button>
      </Tip>
    </nav>
  );
}
