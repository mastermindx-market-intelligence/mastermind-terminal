import type { Metadata, Viewport } from "next";

/**
 * Embed layout — the subtree under /embed is an iframe widget, NOT part of the Terminal app.
 *
 * It nests inside the root layout (app/layout.tsx), so it inherits the Inter + JetBrains-Mono
 * font CSS variables (UI *and* numerals are Inter; the mono is code-only) and globals.css —
 * which is what makes the widget read as the same product.
 * What it must NOT carry is the app chrome: the first-party analytics Tracker mounted in the root
 * layout early-returns on /embed/* (see components/Tracker.tsx) so iframed widget loads don't emit
 * pageviews, and LangProvider is inert here (the widget sets its language from the ?lang= param and
 * never reads the shared language context).
 *
 * Bundle: this layout + the page + one client component (EmbedChart) + lightweight-charts. No
 * Supabase, no flow desks, no pine engine, no AppShell.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Full-bleed web widget with browser zoom; native policy stays with the root NativeViewportPolicy owner.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
