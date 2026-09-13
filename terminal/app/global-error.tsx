"use client";
// Global error boundary — catches errors in the root layout itself.
// This replaces the entire document (html + body required); LangProvider is NOT available here
// because it lives in the layout being replaced. tPlain reads data-lang, so the copy still
// follows the saved language without mounting the provider.
import { useEffect } from "react";
import { tPlain } from "@/lib/i18n";
import { tryChunkReload } from "./error";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalErrorBoundary]", error);
    // Stale-chunk-after-deploy self-heal (shared one-shot guard with app/error.tsx). A chunk-load /
    // module-factory crash in the root shell reloads the document once; non-chunk errors keep the
    // manual retry UI below.
    tryChunkReload(error);
  }, [error]);

  return (
    <html lang={typeof document !== "undefined" && document.documentElement.getAttribute("data-lang") === "zh" ? "zh-CN" : "en"} data-theme="dark" data-lang={typeof document !== "undefined" && document.documentElement.getAttribute("data-lang") === "zh" ? "zh" : "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{tPlain("errTitle")} — Mastermind Terminal</title>
        <style>{`
          *{box-sizing:border-box;margin:0;padding:0}
          body{min-height:100vh;display:flex;align-items:center;justify-content:center;
               background:#0a0b0e;color:#d6dae3;font-family:system-ui,sans-serif;padding:24px}
          .wrap{max-width:480px;text-align:center}
          h1{font-size:20px;font-weight:700;margin-bottom:10px}
          p{color:#868d9c;font-size:14px;line-height:1.55;margin-bottom:22px}
          .ref{display:block;margin-top:8px;color:#5a616f;font-size:11px;font-family:monospace}
          .cta{display:flex;gap:10px;justify-content:center}
          button,a{display:inline-flex;align-items:center;justify-content:center;
                   height:38px;padding:0 18px;border-radius:8px;font:600 13px/1 system-ui,sans-serif;
                   cursor:pointer;text-decoration:none;border:none}
          .primary{background:#2962ff;color:#fff}
          .primary:hover{background:#1d52ed}
          .ghost{border:1px solid #33373f;color:#d6dae3;background:transparent}
          .ghost:hover{background:#15171d}
        `}</style>
      </head>
      <body>
        <div className="wrap">
          <svg width="40" height="40" viewBox="0 0 40 40" style={{ marginBottom: 18 }} aria-hidden="true">
            <defs>
              <linearGradient id="gbT" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#4d82ff" />
                <stop offset="1" stopColor="#2962ff" />
              </linearGradient>
            </defs>
            <rect x="3" y="3" width="34" height="34" rx="8" fill="url(#gbT)" />
            <path d="M13 28 L13 14.5 L20 22 L27 12.5 L27 28" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1>{tPlain("errTitle")}</h1>
          <p>
            {tPlain("errShellBody")}
            {error.digest && <span className="ref">ref: {error.digest}</span>}
          </p>
          <div className="cta">
            <button className="primary" onClick={() => unstable_retry()}>{tPlain("errTryAgain")}</button>
            <a href="/terminal" className="ghost">{tPlain("errGoToChart")}</a>
          </div>
        </div>
      </body>
    </html>
  );
}
