"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, IconCheck, Msg, Row, SectionHead } from "./icons";
import type { SectionProps } from "./types";
import {
  webhookCauseLabel,
  webhookCopy,
  webhookDeliveryStatusLabel,
  webhookEnabledLabel,
  webhookEventTypeLabel,
  webhookRelativeTime,
} from "@/lib/webhookLabels";
import { validateWebhookUrl } from "@/lib/webhookUrl";

type Team = { id: string; name: string; role: "owner" | "admin" | "member" };
type Endpoint = {
  id: string;
  teamId: string;
  url: string;
  enabled: boolean;
  eventFilter: string[];
};
type Delivery = {
  id: string;
  eventType: string;
  status: string;
  lastError: string | null;
  createdAt: string | null;
};

type LoadState = "loading" | "loaded" | "failed";
type DeliveryBucket = { state: LoadState; rows: Delivery[] };

function truncateUrl(url: string): string {
  const bare = url.replace(/^https:\/\//, "");
  return bare.length > 48 ? `${bare.slice(0, 45)}…` : bare;
}

function pickRouteText(
  body: { message?: unknown; messageZh?: unknown },
  lang: "en" | "zh",
  fallback: string,
): string {
  const raw = lang === "zh" ? body.messageZh : body.message;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return fallback;
}

/** Byte-identical to WEBHOOK_ROUTE_MESSAGES.write_failed. Client cannot import webhooks.ts. */
function writeFailedText(lang: "en" | "zh"): string {
  return lang === "zh" ? "我们无法保存该 Webhook 端点。" : "We could not save that webhook endpoint.";
}

function notSignedInText(lang: "en" | "zh"): string {
  return lang === "zh" ? "你尚未登录。" : "You are not signed in.";
}

export default function SectionWebhooks({ t, lang, onClose }: SectionProps) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string>("");
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [endpointsState, setEndpointsState] = useState<LoadState>("loading");
  const [endpointsErr, setEndpointsErr] = useState("");
  const [deliveriesByEp, setDeliveriesByEp] = useState<Record<string, DeliveryBucket>>({});
  const [callerRole, setCallerRole] = useState<"owner" | "admin" | "member" | null>(null);
  const [loadErr, setLoadErr] = useState<string>("");
  const [signedOut, setSignedOut] = useState(false);
  const [urlIn, setUrlIn] = useState("");
  const [teamNameIn, setTeamNameIn] = useState("");
  const [wantTest, setWantTest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formMsg, setFormMsg] = useState<{ text: string; kind: "ok" | "err" | "wait" } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const eligible = useMemo(
    () => (teams ?? []).filter((tm) => tm.role === "owner" || tm.role === "admin"),
    [teams],
  );
  const canWrite = callerRole === "owner" || callerRole === "admin";

  const loadTeams = useCallback(async () => {
    setLoadErr("");
    setSignedOut(false);
    try {
      const r = await fetch("/api/teams");
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setTeams([]);
        setSignedOut(true);
        setLoadErr(pickRouteText(body, lang, notSignedInText(lang)));
        return;
      }
      if (!r.ok) {
        setLoadErr(webhookCopy("teamLoadFailed", lang));
        setTeams([]);
        return;
      }
      const list = Array.isArray(body.teams) ? (body.teams as Team[]) : [];
      setTeams(list);
      const admins = list.filter((tm) => tm.role === "owner" || tm.role === "admin");
      const pick = admins[0]?.id || list[0]?.id || "";
      setTeamId((cur) => cur || pick);
    } catch {
      setLoadErr(webhookCopy("teamLoadFailed", lang));
      setTeams([]);
    }
  }, [lang]);

  const loadEndpoints = useCallback(async (id: string) => {
    if (!id) {
      setEndpoints([]);
      setCallerRole(null);
      setEndpointsState("loaded");
      setEndpointsErr("");
      return;
    }
    setEndpointsState("loading");
    try {
      const r = await fetch(`/api/webhooks?teamId=${encodeURIComponent(id)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setEndpoints([]);
        setCallerRole(null);
        setEndpointsState("failed");
        setEndpointsErr(pickRouteText(body, lang, webhookCopy("endpointsLoadFailed", lang)));
        return;
      }
      setEndpointsState("loaded");
      setEndpointsErr("");
      setEndpoints(Array.isArray(body.endpoints) ? body.endpoints : []);
      setCallerRole(body.callerRole === "owner" || body.callerRole === "admin" || body.callerRole === "member" ? body.callerRole : null);
    } catch {
      setEndpoints([]);
      setCallerRole(null);
      setEndpointsState("failed");
      setEndpointsErr(webhookCopy("endpointsLoadFailed", lang));
    }
  }, [lang]);

  const loadDeliveries = useCallback(async (epId: string) => {
    setDeliveriesByEp((cur) => ({ ...cur, [epId]: { state: "loading", rows: cur[epId]?.rows ?? [] } }));
    try {
      const r = await fetch(`/api/webhooks/${encodeURIComponent(epId)}/deliveries`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setDeliveriesByEp((cur) => ({ ...cur, [epId]: { state: "failed", rows: [] } }));
        return;
      }
      const rows = Array.isArray(body.deliveries) ? (body.deliveries as Delivery[]) : [];
      setDeliveriesByEp((cur) => ({ ...cur, [epId]: { state: "loaded", rows } }));
    } catch {
      setDeliveriesByEp((cur) => ({ ...cur, [epId]: { state: "failed", rows: [] } }));
    }
  }, []);

  useEffect(() => { void loadTeams(); }, [loadTeams]);
  useEffect(() => {
    if (!teamId) return;
    void loadEndpoints(teamId);
  }, [teamId, loadEndpoints]);
  useEffect(() => {
    for (const ep of endpoints) void loadDeliveries(ep.id);
  }, [endpoints, loadDeliveries]);

  async function addEndpoint() {
    const check = validateWebhookUrl(urlIn);
    if (!check.ok) {
      const key = check.code === "not_https" ? "notHttps" : check.code === "private_address" ? "ssrf" : "invalidUrl";
      setFormMsg({ text: webhookCopy(key, lang), kind: "err" });
      return;
    }
    if (!teamId) return;
    setBusy(true);
    setFormMsg({ text: "", kind: "wait" });
    try {
      const r = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          url: urlIn.trim(),
          event_filter: wantTest ? ["webhook.test"] : [],
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        // The route names the cause when it can. When it answers without one,
        // say only that the save failed — never invent the ssrf sentence.
        setFormMsg({ text: lang === "zh" ? body.messageZh || webhookCopy("saveFailed", lang) : body.message || webhookCopy("saveFailed", lang), kind: "err" });
        return;
      }
      if (typeof body.secret === "string") setSecret(body.secret);
      setUrlIn("");
      setFormMsg(null);
      await loadEndpoints(teamId);
    } catch {
      setFormMsg({ text: writeFailedText(lang), kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(ep: Endpoint) {
    const previous = ep.enabled;
    const next = !previous;
    setBusy(true);
    setEndpoints((cur) => cur.map((row) => (row.id === ep.id ? { ...row, enabled: next } : row)));
    try {
      const r = await fetch(`/api/webhooks/${encodeURIComponent(ep.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setEndpoints((cur) => cur.map((row) => (row.id === ep.id ? { ...row, enabled: previous } : row)));
        setFormMsg({ text: pickRouteText(body, lang, writeFailedText(lang)), kind: "err" });
        return;
      }
      await loadEndpoints(teamId);
    } catch {
      setEndpoints((cur) => cur.map((row) => (row.id === ep.id ? { ...row, enabled: previous } : row)));
      setFormMsg({ text: writeFailedText(lang), kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(ep: Endpoint) {
    setBusy(true);
    try {
      const r = await fetch(`/api/webhooks/${encodeURIComponent(ep.id)}/test`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Same rule as addEndpoint: only the route may say "turned off".
        setFormMsg({
          text: lang === "zh" ? body.messageZh || webhookCopy("testFailed", lang) : body.message || webhookCopy("testFailed", lang),
          kind: "err",
        });
        return;
      }
      setFormMsg({ text: webhookCopy("testQueued", lang), kind: "ok" });
      await loadDeliveries(ep.id);
    } catch {
      setFormMsg({ text: writeFailedText(lang), kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function createTeam() {
    // The user names their own team. No creation page exists to link to, so the
    // section creates it in place — but it never picks the name for them, and
    // that name is what the multi-team select shows later.
    const name = teamNameIn.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoadErr(pickRouteText(body, lang, writeFailedText(lang)));
        return;
      }
      await loadTeams();
    } catch {
      setLoadErr(writeFailedText(lang));
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

  const emptyTeam = teams !== null && teams.length === 0 && !loadErr && !signedOut;
  const memberOnly = teams !== null && teams.length > 0 && eligible.length === 0;
  const showEndpoints = teams !== null && teams.length > 0 && !signedOut;

  return (
    <>
      <SectionHead title={t("acsWebhooks")} sub={t("acsWebhooksSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {loadErr ? <Msg text={loadErr} kind="err" /> : null}

        {emptyTeam ? (
          <Group>
            <Row label={webhookCopy("emptyTeam", lang)} desc={webhookCopy("emptyTeamHelp", lang)} />
            <label className="acs-row-lbl" htmlFor="wh-team-name">{webhookCopy("teamNameLabel", lang)}</label>
            <input
              id="wh-team-name"
              className="acs-in"
              type="text"
              maxLength={80}
              value={teamNameIn}
              placeholder={webhookCopy("teamNamePlaceholder", lang)}
              aria-label={webhookCopy("teamNameLabel", lang)}
              onChange={(e) => setTeamNameIn(e.target.value)}
            />
            <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
              <button
                type="button"
                className="acs-btn primary"
                onClick={() => void createTeam()}
                disabled={busy || !teamNameIn.trim()}
              >
                {webhookCopy("createTeam", lang)}
              </button>
            </div>
          </Group>
        ) : null}

        {memberOnly ? (
          <Group>
            <Row desc={webhookCopy("memberReadOnly", lang)} />
          </Group>
        ) : null}

        {eligible.length > 1 ? (
          <Group title={webhookCopy("teamLabel", lang)}>
            <select
              className="acs-in"
              aria-label={webhookCopy("teamLabel", lang)}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              {eligible.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.name}</option>
              ))}
            </select>
          </Group>
        ) : null}

        {secret ? (
          <Group title={webhookCopy("secretTitle", lang)}>
            <Row desc={webhookCopy("secretOnce", lang)} />
            <input className="acs-in" type="text" readOnly value={secret} aria-label={webhookCopy("secretTitle", lang)} />
            <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="acs-btn primary" onClick={copySecret}>
                {copied ? webhookCopy("copied", lang) : webhookCopy("copySecret", lang)}
              </button>
              <button type="button" className="acs-btn ghost" onClick={() => { setSecret(null); setCopied(false); }}>
                {webhookCopy("dismissSecret", lang)}
              </button>
            </div>
          </Group>
        ) : null}

        {canWrite ? (
          <Group title={webhookCopy("addEndpoint", lang)}>
            <label className="acs-row-lbl" htmlFor="wh-url">{webhookCopy("urlLabel", lang)}</label>
            <input
              id="wh-url"
              className="acs-in"
              type="url"
              value={urlIn}
              placeholder={webhookCopy("urlPlaceholder", lang)}
              aria-label={webhookCopy("urlLabel", lang)}
              onChange={(e) => setUrlIn(e.target.value)}
            />
            <button
              type="button"
              className="acs-check"
              aria-pressed={wantTest}
              onClick={() => setWantTest((v) => !v)}
              style={{ marginTop: 10 }}
            >
              <span className="box"><IconCheck /></span>
              {webhookCopy("testEvent", lang)}
            </button>
            <Msg text={formMsg?.text || ""} kind={formMsg?.kind || "err"} />
            <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="acs-btn primary" onClick={() => void addEndpoint()} disabled={busy}>
                {webhookCopy("add", lang)}
              </button>
            </div>
          </Group>
        ) : null}

        {showEndpoints ? (
          <Group title={webhookCopy("endpoints", lang)}>
            {endpointsState === "failed" ? (
              <Row desc={endpointsErr || webhookCopy("endpointsLoadFailed", lang)} />
            ) : endpointsState === "loaded" && endpoints.length === 0 ? (
              <Row desc={webhookCopy("noEndpoints", lang)} />
            ) : endpointsState === "loaded" ? (
              endpoints.map((ep) => {
                const bucket = deliveriesByEp[ep.id];
                return (
                <div key={ep.id}>
                  <Row
                    label={truncateUrl(ep.url)}
                    value={canWrite ? undefined : webhookEnabledLabel(ep.enabled, lang)}
                    control={
                      canWrite ? (
                        <button
                          type="button"
                          className="acs-btn ghost"
                          aria-pressed={ep.enabled}
                          aria-label={webhookEnabledLabel(ep.enabled, lang)}
                          onClick={() => void toggleEnabled(ep)}
                          disabled={busy}
                        >
                          {webhookEnabledLabel(ep.enabled, lang)}
                        </button>
                      ) : undefined
                    }
                  />
                  {canWrite ? (
                    <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
                      <button type="button" className="acs-btn ghost" onClick={() => void sendTest(ep)} disabled={busy || !ep.enabled}>
                        {webhookCopy("sendTest", lang)}
                      </button>
                    </div>
                  ) : null}
                  <Group title={webhookCopy("deliveries", lang)}>
                    <div id={`wh-deliveries-${ep.id}`} className="acs-webhook-deliveries">
                    {bucket?.state === "failed" ? (
                      <Row desc={webhookCopy("deliveriesLoadFailed", lang)} />
                    ) : bucket?.state === "loaded" && bucket.rows.length === 0 ? (
                      <Row desc={webhookCopy("noDeliveries", lang)} />
                    ) : bucket?.state === "loaded" ? (
                      bucket.rows.map((d) => {
                        const cause = webhookCauseLabel(d.lastError, lang);
                        return (
                          <Row
                            key={d.id}
                            label={webhookEventTypeLabel(d.eventType, lang)}
                            desc={webhookRelativeTime(d.createdAt, lang)}
                            control={
                              <span
                                className="acs-webhook-status"
                                style={{
                                  display: "inline-block",
                                  maxWidth: "11em",
                                  whiteSpace: "normal",
                                  overflowWrap: "anywhere",
                                  textAlign: "right",
                                  fontSize: 13,
                                  color: "var(--text-2)",
                                  lineHeight: 1.3,
                                }}
                              >
                                {webhookDeliveryStatusLabel(d.status, lang)}
                              </span>
                            }
                          >
                            {cause ? <span className="acs-row-desc">{cause}</span> : null}
                          </Row>
                        );
                      })
                    ) : null}
                    </div>
                  </Group>
                </div>
                );
              })
            ) : null}
          </Group>
        ) : null}
      </div>
    </>
  );
}
