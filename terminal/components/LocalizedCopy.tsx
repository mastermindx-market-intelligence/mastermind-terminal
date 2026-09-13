"use client";
import type { CSSProperties, ImgHTMLAttributes } from "react";
import { useT } from "@/lib/i18n";

// Lexicon text for SERVER components.
//
// The active language lives in localStorage / <html data-lang>, both of which are
// browser-only, so a server component has no way to pick a language at render
// time — that is why app/not-found.tsx and the provisioning fallback in
// app/terminal/page.tsx shipped English-only. Wrapping just the copy in this
// client leaf keeps those pages server-rendered while the words still follow the
// language the reader picked.
export function T({ k, as: Tag = "span", className, style }: {
  k: string;
  as?: "span" | "p" | "h1" | "h2" | "div";
  className?: string;
  style?: CSSProperties;
}) {
  const t = useT();
  return <Tag className={className} style={style}>{t(k)}</Tag>;
}

export function TImg({ k, ...rest }: { k: string } & ImgHTMLAttributes<HTMLImageElement>) {
  const t = useT();
  /* eslint-disable-next-line @next/next/no-img-element */
  return <img alt={t(k)} {...rest} />;
}
