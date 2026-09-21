import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./fin.css";
// NB: company-intelligence.css is deliberately NOT here. Its selectors (`.ci-*`, `.analysis-*`)
// belong to two surfaces only, so it is imported by those components instead
// (components/fin/CompanyIntelligencePage + components/workspaces/AnalysisWorkspace) and no
// longer blocks first paint on the routes that cannot render any of it. fin.css stays global:
// its classes are shared across the options desks, screener and chart rail, not just fin/.
// observatory.css is shell-only and is imported by AppShell so the chart route does not pay for it.
import "./onboarding.css";
import "./settings.css";
import { LangProvider } from "@/lib/i18n";
import Tracker from "@/components/Tracker";
import EmbeddedTerminalBridge from "@/components/EmbeddedTerminalBridge";

// Inter carries the whole product now — UI text *and* every numeral (--font-ui / --font-num).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
// JetBrains Mono is code-only (--font-code: Pine editor, gutters, console, source dumps), so it
// no longer needs to preload on pages that never render a character cell.
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], display: "swap", preload: false });

// Viewport config: device-width, no zoom (full-bleed chart UX), safe-area insets via viewportFit.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Mastermind Terminal",
  description: "Institutional charting — proprietary confluence signals, macro regime, and an AI copilot.",
};

// Runs before first paint (no flash): pick the up/down color scheme + language from a saved
// override, else from the browser locale. CN/HK/TW/MO (red = up) → "east"; everywhere else → "west".
const LOCALE_INIT = `(function(){try{
  var L=((navigator.languages&&navigator.languages[0])||navigator.language||'').toLowerCase();
  var ud=localStorage.getItem('mm.updown'); if(ud!=='east'&&ud!=='west') ud=/zh|hans|hant|-cn|-hk|-tw|-mo/.test(L)?'east':'west';
  document.documentElement.setAttribute('data-updown',ud);
  var lg=localStorage.getItem('mm.lang'); if(lg!=='zh'&&lg!=='en') lg=/^zh/.test(L)?'zh':'en';
  document.documentElement.setAttribute('data-lang',lg);
  var sp=new URLSearchParams(location.search);
  if(sp.get('shell')==='app'){
    document.documentElement.setAttribute('data-shell','app');
    if(sp.get('tray')==='1') document.documentElement.setAttribute('data-tray','1');
  }
}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: LOCALE_INIT }} /></head>
      <body><LangProvider>{children}</LangProvider><EmbeddedTerminalBridge /><Tracker /></body>
    </html>
  );
}
