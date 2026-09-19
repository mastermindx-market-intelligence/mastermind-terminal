"use client";
import { useCallback, useEffect, useState } from "react";
import { Group, Msg, Row, SectionHead } from "./icons";
import type { SectionProps } from "./types";
import { apiKeyCopy } from "@/lib/apiKeyLabels";
import type { ApiKeyMeta } from "@/lib/apiKeys";

type LoadState = "loading" | "loaded" | "failed";

function pickRouteText(
  body: { message?: unknown; messageZh?: unknown },
  lang: "en" | "zh",
  fallback: string,
): string {
  const raw = lang === "zh" ? body.messageZh : body.message;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return fallback;
}

function maskSecret(secret: string): string {
  if (secret.length < 8) return "mmx_••••";
  return `${secret.slice(0, 8)}${"•".repeat(Math.max(8, secret.length - 8))}`;
}

export default function SectionDeveloper({ t, lang, onClose }: SectionProps) {
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [err, setErr] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [formMsg, setFormMsg] = useState<{ text: string; kind: "ok" | "err" | "wait" } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealMasked, setRevealMasked] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await fetch("/api/account/api-keys");
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setKeys([]);
        setState("failed");
        setErr(pickRouteText(body, lang, apiKeyCopy("notSignedIn", lang)));
        return;
      }
      if (!r.ok) {
        setKeys([]);
        setState("failed");
        setErr(pickRouteText(body, lang, apiKeyCopy("loadFailed", lang)));
        return;
      }
      setState("loaded");
      setErr("");
      setKeys(Array.isArray(body.keys) ? body.keys : []);
    } catch {
      setKeys([]);
      setState("failed");
      setErr(apiKeyCopy("loadFailed", lang));
    }
  }, [lang]);

  useEffect(() => { void load(); }, [load]);

  async function mint() {
    setBusy(true);
    setFormMsg({ text: "", kind: "wait" });
    try {
      const r = await fetch("/api/account/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFormMsg({
          text: pickRouteText(body, lang, apiKeyCopy("mintFailed", lang)),
          kind: "err",
        });
        return;
      }
      if (typeof body.secret === "string") {
        setSecret(body.secret);
        setRevealMasked(false);
      }
      setLabel("");
      setFormMsg(null);
      await load();
    } catch {
      setFormMsg({ text: apiKeyCopy("mintFailed", lang), kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/account/api-keys/${encodeURIComponent(id)}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFormMsg({
          text: pickRouteText(body, lang, apiKeyCopy("revokeFailed", lang)),
          kind: "err",
        });
        return;
      }
      setFormMsg(null);
      await load();
    } catch {
      setFormMsg({ text: apiKeyCopy("revokeFailed", lang), kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  function copySecret() {
    if (!secret) return;
    const flip = () => setCopied(true);
    const legacy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = secret;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        flip();
      } catch { /* clipboard unavailable */ }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(secret).then(flip).catch(legacy);
    else legacy();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://terminal.mastermind-x.com";
  const contractHref = "/docs/api/contract";
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);
  const atCap = active.length >= 5;

  return (
    <>
      <SectionHead title={t("acsDeveloper")} sub={t("acsDeveloperSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body" data-testid="developer-access">
        <Group>
          <Row desc={apiKeyCopy("truth", lang)} />
          <Row label={apiKeyCopy("baseUrl", lang)} value={`${origin}/api/v1`} />
          <p className="acs-sub" style={{ margin: "8px 0 0" }}>
            <a href={contractHref} className="acs-link">{apiKeyCopy("contractLink", lang)}</a>
          </p>
        </Group>

        <Group>
          <Row desc={apiKeyCopy("teamNull", lang)} />
        </Group>

        {err ? <Msg text={err} kind="err" /> : null}

        {secret ? (
          <Group title={apiKeyCopy("secretTitle", lang)}>
            <Row desc={apiKeyCopy("secretOnce", lang)} />
            <input
              className="acs-in"
              data-testid="api-key-secret"
              type="text"
              readOnly
              value={revealMasked ? maskSecret(secret) : secret}
              aria-label={apiKeyCopy("secretTitle", lang)}
            />
            <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="acs-btn primary" onClick={copySecret}>
                {copied ? apiKeyCopy("copied", lang) : apiKeyCopy("copy", lang)}
              </button>
              <button
                type="button"
                className="acs-btn ghost"
                onClick={() => { setSecret(null); setCopied(false); }}
              >
                {apiKeyCopy("dismiss", lang)}
              </button>
            </div>
          </Group>
        ) : null}

        <Group title={apiKeyCopy("mint", lang)}>
          <label className="acs-row-lbl" htmlFor="api-key-label">{apiKeyCopy("mintLabel", lang)}</label>
          <input
            id="api-key-label"
            className="acs-in"
            type="text"
            maxLength={80}
            value={label}
            placeholder={apiKeyCopy("mintPlaceholder", lang)}
            aria-label={apiKeyCopy("mintLabel", lang)}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Row desc={apiKeyCopy("rotateHelp", lang)} />
          <Msg text={formMsg?.text || ""} kind={formMsg?.kind || "err"} />
          <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
            <button
              type="button"
              className="acs-btn primary"
              data-testid="api-key-mint"
              onClick={() => void mint()}
              disabled={busy || atCap || !label.trim()}
            >
              {busy ? apiKeyCopy("minting", lang) : apiKeyCopy("mint", lang)}
            </button>
          </div>
          {atCap ? <Msg text={apiKeyCopy("activeCap", lang)} kind="err" /> : null}
        </Group>

        {state === "loaded" && keys.length === 0 && !secret ? (
          <Group>
            <Row label={apiKeyCopy("empty", lang)} desc={apiKeyCopy("emptyHelp", lang)} />
          </Group>
        ) : null}

        {active.length > 0 ? (
          <Group title={t("acsDeveloper")}>
            {active.map((k) => (
              <Row
                key={k.keyId}
                userId={k.keyId}
                label={k.label}
                desc={`${apiKeyCopy("prefix", lang)} mmx_${k.keyPrefix} · ${apiKeyCopy("created", lang)} ${k.createdAt ? k.createdAt.slice(0, 10) : "—"} · ${k.lastUsedAt ? `${apiKeyCopy("lastUsed", lang)} ${k.lastUsedAt.slice(0, 10)}` : apiKeyCopy("neverUsed", lang)}`}
                control={
                  <button
                    type="button"
                    className="acs-btn ghost"
                    data-testid={`api-key-revoke-${k.keyId}`}
                    onClick={() => void revoke(k.keyId)}
                    disabled={busy}
                  >
                    {apiKeyCopy("revoke", lang)}
                  </button>
                }
              />
            ))}
          </Group>
        ) : null}

        {revoked.length > 0 ? (
          <Group title={apiKeyCopy("revoked", lang)}>
            {revoked.map((k) => (
              <Row
                key={k.keyId}
                label={k.label}
                desc={`${apiKeyCopy("revoked", lang)} · mmx_${k.keyPrefix}`}
              />
            ))}
          </Group>
        ) : null}
      </div>
    </>
  );
}
