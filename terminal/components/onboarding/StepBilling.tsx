"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe, type Appearance } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useLang, useT } from "@/lib/i18n";
import type { PlanKey, Period } from "./types";
import { perMonth, annualBilled, firstInvoiceTotal, TRIAL_DAYS } from "./plans";
import { parseSubscribeReceipt, classifySubscribeAttempt } from "@/lib/billingReceipt";

// Tier hue CSS var per plan key — mirrors onboarding.css tokens.
const HUE: Record<PlanKey, string> = {
  free: "var(--ob-free)", essential: "var(--ob-essential)", pro: "var(--ob-pro)",
};
const NAME_KEY: Record<Exclude<PlanKey, "free">, string> = {
  essential: "obPlanInsider", pro: "obPlanPro",
};

// The Inter stack, mirrored from globals.css --font-ui, for the Stripe iframe (which
// can't read our CSS vars). Kept in sync by hand — a font mismatch is cosmetic only.
const INTER_STACK =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// House-tokened "night" appearance. Values mirror globals.css literals (the iframe
// is cross-origin, so CSS vars don't reach it — these must be concrete).
const APPEARANCE: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#2962ff",
    colorBackground: "#08090c", // --inset
    colorText: "#d6dae3",       // --text
    borderRadius: "8px",
    fontFamily: INTER_STACK,
  },
};

// The trial's first-charge date = now + TRIAL_DAYS, or the exact trial_end epoch when
// the gateway supplies one (we don't yet at init — this drives the pre-submit summary).
function trialChargeDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d;
}
function fmtDate(d: Date, lang: string): string {
  return d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { month: "long", day: "numeric" });
}

type Phase =
  | { k: "loading" }
  | { k: "ready"; pk: string; clientSecret: string }
  | { k: "error" }
  | { k: "already" }      // 409 — active plan exists
  | { k: "signin" }       // 401 — shouldn't happen in-flow
  | { k: "notConfigured" }; // config 503

export interface StepBillingProps {
  tier: Exclude<PlanKey, "free">;
  period: Period;
  /** Advance to Done carrying the VERIFIED trial outcome. Never null: an unverifiable
   *  receipt keeps the user on Billing rather than claiming a trial started (D7). */
  onTrialStarted: (trialEnd: number) => void;
  /** Fix round 1 (BLOCKER-1): a genuine no-trial purchase completed (e.g. essential,
   *  plans.yml trial_days: 0 — Stripe answers status:"active", trial_end:null). Charged,
   *  plan live, no trial to claim — distinct from onAlreadyActive (a PRE-existing plan). */
  onPurchaseActive: () => void;
  /** Skip straight to Done for an already-active plan (no trial started here). Also used for the
   *  409 "already subscribed" outcome from /complete (fix round 1, MAJOR-2). */
  onAlreadyActive: () => void;
  /** The quiet "or continue with Free" escape — flips plan to free and skips to Done. */
  onFree: () => void;
  /** confirmPending + paid with no session: billing needs auth. Show blocker + continue. */
  needsConfirmFirst: boolean;
  onContinueToDone: () => void;
}

const PLANS_HTML = "https://www.mastermind-x.com/plans.html";

export default function StepBilling(props: StepBillingProps) {
  const { tier, period, needsConfirmFirst } = props;
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  // loadStripe memoized on the resolved pk so we don't re-init on every render.
  const stripePromiseRef = useRef<Promise<Stripe | null> | null>(null);

  const init = useCallback(async () => {
    setPhase({ k: "loading" });
    try {
      // 1) publishable key (config 503 → not configured).
      const cfgRes = await fetch("/api/billing/config", { cache: "no-store" });
      if (cfgRes.status === 503) { setPhase({ k: "notConfigured" }); return; }
      if (!cfgRes.ok) { setPhase({ k: "error" }); return; }
      const cfg = await cfgRes.json().catch(() => ({}));
      const pk = typeof cfg?.publishable_key === "string" ? cfg.publishable_key : "";
      if (!pk) { setPhase({ k: "notConfigured" }); return; }

      // 2) SetupIntent for the chosen tier/interval.
      const initRes = await fetch("/api/billing/subscribe/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval: period }),
      });
      if (initRes.status === 409) { setPhase({ k: "already" }); return; }
      if (initRes.status === 401) { setPhase({ k: "signin" }); return; }
      if (!initRes.ok) { setPhase({ k: "error" }); return; }
      const data = await initRes.json().catch(() => ({}));
      const clientSecret = typeof data?.client_secret === "string" ? data.client_secret : "";
      if (!clientSecret) { setPhase({ k: "error" }); return; }

      stripePromiseRef.current = loadStripe(pk);
      setPhase({ k: "ready", pk, clientSecret });
    } catch {
      setPhase({ k: "error" });
    }
  }, [tier, period]);

  // Skip the network entirely in the confirm-first blocker state.
  useEffect(() => {
    if (needsConfirmFirst) return;
    void init();
  }, [init, needsConfirmFirst]);

  // ── confirm-email-first blocker (rare: confirmation ON + paid, no session) ──
  if (needsConfirmFirst) {
    return (
      <div className="ob-fade">
        <h1 className="ob-h1" data-ob-heading tabIndex={-1}>{t("obBillTitle")}</h1>
        <div className="ob-bill-state">
          <p className="ob-bill-state-msg">{t("obBillConfirmFirst")}</p>
          <button type="button" className="ob-btn" onClick={props.onContinueToDone}>
            {t("obBillConfirmGo")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-fade">
      <h1 className="ob-h1" data-ob-heading tabIndex={-1}>{t("obBillTitle")}</h1>
      <p className="ob-sub">{t("obBillSub")}</p>

      <OrderSummary tier={tier} period={period} />

      {phase.k === "loading" && <BillingSkeleton label={t("obBillLoading")} />}

      {phase.k === "error" && (
        <div className="ob-bill-state">
          <p className="ob-bill-state-msg">{t("obBillErr")}</p>
          <button type="button" className="ob-btn" onClick={() => void init()}>{t("obBillRetry")}</button>
        </div>
      )}

      {phase.k === "already" && (
        <div className="ob-bill-state">
          <div className="ob-bill-state-hd">{t("obBillAlready")}</div>
          <p className="ob-bill-state-msg">{t("obBillAlreadySub")}</p>
          <button type="button" className="ob-btn" onClick={props.onAlreadyActive}>{t("obBillAlreadyGo")}</button>
        </div>
      )}

      {phase.k === "signin" && (
        <div className="ob-bill-state">
          <p className="ob-bill-state-msg">{t("obBillSignin")}</p>
        </div>
      )}

      {phase.k === "notConfigured" && (
        <div className="ob-bill-state">
          <p className="ob-bill-state-msg">{t("obBillNotConfigured")}</p>
          <a className="ob-link brand" href={PLANS_HTML} target="_blank" rel="noopener noreferrer">
            {t("obBillPlansLink")} →
          </a>
        </div>
      )}

      {phase.k === "ready" && stripePromiseRef.current && (
        <Elements
          stripe={stripePromiseRef.current}
          options={{ clientSecret: phase.clientSecret, appearance: APPEARANCE }}
        >
          <PaymentForm
            tier={tier}
            period={period}
            onTrialStarted={props.onTrialStarted}
            onPurchaseActive={props.onPurchaseActive}
            onAlreadyActive={props.onAlreadyActive}
            onFree={props.onFree}
          />
        </Elements>
      )}
    </div>
  );
}

// ── Order summary card (house style, above the Stripe element) ────────────────
function OrderSummary({ tier, period }: { tier: Exclude<PlanKey, "free">; period: Period }) {
  const t = useT();
  const { lang } = useLang();
  const hue = HUE[tier];
  const mo = perMonth(tier, period);
  const total = firstInvoiceTotal(tier, period);
  const date = useMemo(() => fmtDate(trialChargeDate(), lang), [lang]);
  const annual = period === "annual";

  return (
    <div className="ob-order" style={{ ["--ob-accent" as string]: hue } as React.CSSProperties}>
      <div className="ob-order-hd">
        <span className="ob-order-dot" />
        <span className="ob-order-nm">{t(NAME_KEY[tier])}</span>
        <span className="ob-order-price">
          ${mo}<span className="ob-order-per">{t("obBillPerMo")}</span>
        </span>
      </div>
      <div className="ob-order-billed">
        {annual
          ? t("obBillAnnually").replace("{total}", String(annualBilled(tier)))
          : t("obBillMonthly")}
      </div>
      <div className="ob-order-truth">
        <p className="ob-order-trial">
          {t("obBillTrialLine").replace("{total}", String(total)).replace("{date}", date)}
        </p>
        <p className="ob-order-cancel">{t("obBillCancelLine")}</p>
      </div>
    </div>
  );
}

// ── Quiet loading skeleton (house spinner idiom — calm, no Stripe branding) ───
function BillingSkeleton({ label }: { label: string }) {
  return (
    <div className="ob-bill-skel" aria-live="polite" aria-busy="true">
      <span className="ob-bill-spin" />
      <span className="ob-bill-skel-lbl">{label}</span>
      <span className="ob-bill-skel-line" />
      <span className="ob-bill-skel-line short" />
    </div>
  );
}

// ── The PaymentElement + submit, inside <Elements> so the hooks are available ──
function PaymentForm({
  tier, period, onTrialStarted, onPurchaseActive, onAlreadyActive, onFree,
}: {
  tier: Exclude<PlanKey, "free">;
  period: Period;
  onTrialStarted: (trialEnd: number) => void;
  onPurchaseActive: () => void;
  onAlreadyActive: () => void;
  onFree: () => void;
}) {
  const t = useT();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false); // PaymentElement mounted

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true); setErr("");

    // Confirm the SetupIntent (collect + validate the card) without a redirect.
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (error) {
      // Stripe's own message (card declines etc.) — do NOT translate it.
      setErr(error.message || t("obBillErr"));
      setBusy(false);
      return;
    }
    if (!setupIntent?.id) {
      setErr(t("obBillErr"));
      setBusy(false);
      return;
    }

    // Card attached → tell the gateway to start/complete the subscription.
    try {
      const res = await fetch("/api/billing/subscribe/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setup_intent_id: setupIntent.id, tier, interval: period }),
      });
      // D7 — fail closed. This used to accept ANY 2xx: it parsed whatever arrived, took trial_end
      // if it happened to be a number, and called onTrialStarted() unconditionally, so
      // `HTTP 200 {}` was enough to tell a user their paid trial had started (and StepDone then
      // invented a first-charge date). On a money surface a malformed success is a failure.
      //
      // Fix round 1 (BLOCKER-1) — a receipt is EITHER a trial OR a genuine no-trial "active"
      // purchase (essential, plans.yml trial_days: 0 -> Stripe answers status:"active",
      // trial_end:null). Only a receipt that fails BOTH shapes is refused.
      const data = res.ok ? await res.json().catch(() => null) : null;
      const receipt = res.ok ? parseSubscribeReceipt(data) : null;
      // Round 2 review (MAJOR-1 + MINOR-1) — every outcome funnels through one classifier so the
      // routing decision is pinned by a unit test rather than read off these branches. "already" is
      // the explicit 409 landing (fix round 1, MAJOR-2) — the card is already attached, so a
      // generic "checkout failed" would be the wrong cause. "unknown" covers any other non-2xx, a
      // 2xx whose body didn't parse, and a 2xx that parsed but matched neither successful shape —
      // none of these can support "you have not been charged", which is what obBillErrIncomplete
      // used to assert here.
      const outcome = classifySubscribeAttempt({ phase: "response", status: res.status, ok: res.ok, receipt });
      if (outcome.kind === "already") { onAlreadyActive(); return; }
      if (outcome.kind === "unknown") { setErr(t("obBillErrUnknown")); setBusy(false); return; }
      if (outcome.kind === "trial") { onTrialStarted(outcome.trialEnd); return; }
      onPurchaseActive();
    } catch {
      // Round 2 review (MINOR-1, latest-round correction) — this catch covers BOTH a genuine
      // network drop/timeout on the response leg AFTER the POST reached the network, AND a `fetch`
      // that never dispatched at all (offline, DNS failure, a CSP/extension block all reject with
      // a TypeError before any bytes leave the browser) — the two are not distinguishable from
      // here. Either way we cannot prove the charge did not land, so this stays "unknown", never
      // the not-charged copy. A failure BEFORE this fetch is even called (the Stripe confirmSetup
      // step above, outside this try) is the one place that keeps the honest not-charged copy
      // (obBillErr) — that request never reached our own gateway at all.
      const outcome = classifySubscribeAttempt({ phase: "exception" });
      // Round 2 review (MINOR-3) — classifySubscribeAttempt returns {kind:"unknown"} unconditionally
      // for phase:"exception" (see its own guard), so a bare `if (outcome.kind === "unknown")` could
      // never be false — but silently doing nothing is the wrong failure mode on a money screen: a
      // future classifier change would leave the form busy with no message. This switch lists every
      // SubscribeOutcome case by hand so a future new case is caught by eye at review time — it is
      // NOT compiler-checked exhaustiveness (no `default` arm asserting `outcome.kind` as `never`),
      // so an added case with no arm here would still compile. `setBusy(false)` two lines below the
      // switch runs unconditionally for every case (it is not itself inside the switch), so no
      // branch above needs to set it individually.
      switch (outcome.kind) {
        case "unknown":
          setErr(t("obBillErrUnknown"));
          break;
        case "already":
        case "trial":
        case "active":
          // Not reachable from phase:"exception" today — still surface a message rather than
          // leaving the form silently busy if that ever changes.
          setErr(t("obBillErrUnknown"));
          break;
      }
      setBusy(false);
    }
  }

  return (
    <form className="ob-bill-form" onSubmit={submit}>
      <div className="ob-bill-el">
        <PaymentElement onReady={() => setReady(true)} />
      </div>
      {err && <div className="ob-err">{err}</div>}
      <button type="submit" className="ob-btn wide" disabled={!stripe || !ready || busy} style={{ marginTop: 14 }}>
        {busy ? t("obBillSubmitBusy") : t("obBillSubmit")}
      </button>
      <button type="button" className="ob-link" style={{ marginTop: 12, alignSelf: "center" }}
        onClick={onFree} disabled={busy}>
        {t("obBillOrFree")}
      </button>
    </form>
  );
}
