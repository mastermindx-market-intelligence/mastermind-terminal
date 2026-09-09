"use client";
/**
 * LevelsLearn — the Learn academy seed for the Levels board (WP-A3).
 *
 * Six short, original lessons in plain English. Written from scratch for this
 * board — no copy borrowed from any other site. Institutional dark aesthetic.
 * The whole point is honesty: this teaches what the map is AND what it is not.
 */

import React from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/BrandMark";
import { useT } from "@/lib/i18n";

interface Lesson {
  glyph: string;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}

function lessons(t: (key: string) => string): Lesson[] {
  return [
    {
      glyph: "≈",
      eyebrow: t("ll1eyebrow"),
      title: t("ll1title"),
      body: (
        <>
          {t("ll1a")}<em>{t("ll1leans")}</em>{t("ll1b")}
          <b>{t("ll1sticky")}</b>{t("ll1c")}
          <em>{t("ll1chases")}</em>{t("ll1d")}
          <b>{t("ll1slippery")}</b>{t("ll1e")}
        </>
      ),
    },
    {
      glyph: "★",
      eyebrow: t("ll2eyebrow"),
      title: t("ll2title"),
      body: (
        <>
          {t("ll2a")}
          <b>{t("ll2keystone")}</b>
          {t("ll2b")}
        </>
      ),
    },
    {
      glyph: "▔▁",
      eyebrow: t("ll3eyebrow"),
      title: t("ll3title"),
      body: (
        <>
          <b>{t("ll3ceiling")}</b>{t("ll3b")}
          <b>{t("ll3floor")}</b>{t("ll3c")}
          <em>{t("ll3slip")}</em>{t("ll3d")}
        </>
      ),
    },
    {
      glyph: "⚡",
      eyebrow: t("ll4eyebrow"),
      title: t("ll4title"),
      body: (
        <>
          <b>{t("ll4flip")}</b>{t("ll4b")}
          <b>{t("ll4calm")}</b>{t("ll4c")}
          <b>{t("ll4wild")}</b>{t("ll4d")}
        </>
      ),
    },
    {
      glyph: "◆ ≋",
      eyebrow: t("ll5eyebrow"),
      title: t("ll5title"),
      body: (
        <>
          <b>{t("ll5cluster")}</b>{t("ll5b")}
          <b>{t("ll5void")}</b>{t("ll5c")}
        </>
      ),
    },
    {
      glyph: "◑",
      eyebrow: t("ll6eyebrow"),
      title: t("ll6title"),
      body: (
        <>
          {t("ll6a")}<b>{t("ll6loc")}</b>{t("ll6b")}
          <b>{t("ll6daily")}</b>{t("ll6c")}
          <b>{t("ll6assumed")}</b>{t("ll6d")}
        </>
      ),
    },
  ];
}

export function LevelsLearn() {
  const t = useT();
  return (
    <div style={PAGE}>
      <header style={TOPBAR}>
        <Link href="/options?tab=levels" style={{ textDecoration: "none" }}>
          <BrandLockup />
        </Link>
        <Link href="/options?tab=levels" style={BACK_LINK}>{t("llBack")}</Link>
      </header>

      <main style={MAIN}>
        <div style={HERO}>
          <div style={HERO_EYEBROW}>{t("llHeroEyebrow")}</div>
          <h1 style={HERO_TITLE}>{t("llHeroTitle")}</h1>
          <p style={HERO_SUB}>{t("llHeroSub")}</p>
        </div>

        <ol style={LIST}>
          {lessons(t).map((l, i) => (
            <li key={i} style={CARD}>
              <div style={CARD_RAIL}>
                <span style={CARD_NUM}>{String(i + 1).padStart(2, "0")}</span>
                <span style={CARD_GLYPH}>{l.glyph}</span>
              </div>
              <div style={CARD_BODY}>
                <div style={CARD_EYEBROW}>{l.eyebrow}</div>
                <h2 style={CARD_TITLE}>{l.title}</h2>
                <p style={CARD_TEXT}>{l.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div style={FOOT}>
          <Link href="/options?tab=levels" style={FOOT_CTA}>{t("llOpenBoard")}</Link>
          <span style={FOOT_NOTE}>{t("llFootNote")}</span>
        </div>
      </main>
    </div>
  );
}

// ─── Styles (theme tokens from app/globals.css) ───────────────────────────────

const PAGE: React.CSSProperties = {
  minHeight: "100vh", background: "var(--bg)", color: "var(--text)",
  fontFamily: "var(--font-ui)",
};
const TOPBAR: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "12px 20px", borderBottom: "1px solid var(--line)", background: "var(--panel)",
  position: "sticky", top: 0, zIndex: 5,
};
const BACK_LINK: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: "var(--link)", textDecoration: "none",
};
const MAIN: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: "40px 20px 72px" };

const HERO: React.CSSProperties = { marginBottom: 34 };
const HERO_EYEBROW: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
  color: "var(--brand-2)", marginBottom: 12,
};
const HERO_TITLE: React.CSSProperties = {
  fontSize: 30, lineHeight: 1.15, fontWeight: 800, letterSpacing: "-0.02em",
  color: "var(--text)", margin: "0 0 14px",
};
const HERO_SUB: React.CSSProperties = {
  fontSize: 15, lineHeight: 1.6, color: "var(--text-2)", margin: 0, maxWidth: 620,
};

const LIST: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 };
const CARD: React.CSSProperties = {
  display: "flex", gap: 18, padding: "20px 20px", background: "var(--panel)",
  border: "1px solid var(--line)", borderRadius: "var(--r-lg)",
};
const CARD_RAIL: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 10, flexShrink: 0, width: 40,
};
const CARD_NUM: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "var(--text-dim)", fontFamily: "var(--font-num)", letterSpacing: "0.02em",
};
const CARD_GLYPH: React.CSSProperties = {
  fontSize: 20, color: "var(--brand-2)", lineHeight: 1, textAlign: "center",
};
const CARD_BODY: React.CSSProperties = { flex: 1, minWidth: 0 };
const CARD_EYEBROW: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase",
  color: "var(--muted)", marginBottom: 6,
};
const CARD_TITLE: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "var(--text)", margin: "0 0 9px", letterSpacing: "-0.01em",
};
const CARD_TEXT: React.CSSProperties = { fontSize: 14, lineHeight: 1.62, color: "var(--text-2)", margin: 0 };

const FOOT: React.CSSProperties = {
  marginTop: 34, paddingTop: 22, borderTop: "1px solid var(--line)",
  display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
};
const FOOT_CTA: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: "var(--link)", textDecoration: "none",
};
const FOOT_NOTE: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)" };
