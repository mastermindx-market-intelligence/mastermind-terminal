"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { SS_OPEN, normalizePlanKey, type OnboardMode, type PlanKey, type Period, type OnboardingSheetProps } from "./types";
import { deliverPendingPrefs, readPendingPrefs } from "@/lib/onboardingPrefsOutbox";

// The wizard itself is code-split (ssr:false) so it never bloats first paint — it only loads
// when the user actually opens onboarding. Generic pinned to the shared contract so the JSX
// below is validated against OnboardingSheetProps regardless of inference.
const OnboardingSheet = dynamic<OnboardingSheetProps>(() => import("./OnboardingSheet"), { ssr: false });

interface OnboardingApi {
  open: (mode: OnboardMode, opts?: { plan?: PlanKey; period?: Period }) => void;
  close: () => void;
}

// No-op fallback for provider-less hosts. SettingsButton (via MobileNav) is also rendered inside
// the transient route-loading skeleton (components/RouteSkeleton.tsx, used by the loading.tsx
// files), which sits OUTSIDE any provider by design — a throwing hook would crash every route
// transition. The skeleton's onboarding buttons are non-interactive placeholders, so a no-op is
// the correct degradation there; real hosts (both shells) always supply the provider.
const NOOP_API: OnboardingApi = { open: () => {}, close: () => {} };

const OnboardingCtx = createContext<OnboardingApi>(NOOP_API);

export function useOnboarding(): OnboardingApi {
  return useContext(OnboardingCtx);
}

// Sheet state lives HERE, above the (unmounted-when-closed) sheet, so a closed sheet reopens
// where it left off — the state-preserving requirement. `email` is the shell's auth signal.
export function OnboardingProvider({ email, children }: { email: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  // Once opened, the sheet stays MOUNTED (hidden via `visible`) so a dismissed mid-flow
  // wizard reopens exactly where it left off — the state-preserving requirement.
  const [everOpened, setEverOpened] = useState(false);
  const [mode, setMode] = useState<OnboardMode>("signup");
  const [plan, setPlan] = useState<PlanKey | undefined>();
  const [period, setPeriod] = useState<Period | undefined>();
  const [resume, setResume] = useState(false);

  const open = useCallback<OnboardingApi["open"]>((m, opts) => {
    setMode(m);
    setResume(false);
    if (opts?.plan) setPlan(opts.plan);
    if (opts?.period) setPeriod(opts.period);
    setIsOpen(true);
    setEverOpened(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  // Stable API object so the (large) consumer tree doesn't re-render on every provider render;
  // open/close are useCallback-stable, so this recomputes never.
  const api = useMemo<OnboardingApi>(() => ({ open, close }), [open, close]);

  // ── Window-event bridge ───────────────────────────────────────────────────────
  //    Some hosts render this provider as a DESCENDANT of the component that needs to
  //    open it (TerminalShell mounts <OnboardingProvider> inside its own JSX), so their
  //    useOnboarding() resolves to NOOP_API and the context is unreachable upward. Those
  //    call sites dispatch `mm:onboard` instead; the detail mirrors open()'s signature.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ mode?: OnboardMode; plan?: PlanKey; period?: Period }>).detail;
      open(d?.mode === "signin" ? "signin" : "signup", { plan: d?.plan, period: d?.period });
    };
    window.addEventListener("mm:onboard", onOpen);
    return () => window.removeEventListener("mm:onboard", onOpen);
  }, [open]);

  // ── Remount resilience: router.refresh() at the signup step-1→2 boundary flips
  //    app/terminal/page.tsx from its guest branch to its signed-in branch, which
  //    remounts this provider. Restore the open-state stash so the sheet carries on
  //    (its own wizard fields rehydrate from SS_WIZARD). A restored SIGNIN sheet is
  //    NOT reopened once signed in — that flow is complete by definition. ──
  useEffect(() => {
    let saved: { open?: boolean; mode?: OnboardMode; plan?: PlanKey; period?: Period } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(SS_OPEN) || "null"); } catch { /* ignore */ }
    if (!saved?.open) return;
    if (saved.mode === "signin") { if (email !== "") return; setMode("signin"); }
    else setMode("signup");
    // A stash written before the rename can still hold `insider` — normalize on READ.
    const savedPlan = normalizePlanKey(saved.plan);
    if (savedPlan) setPlan(savedPlan);
    if (saved.period) setPeriod(saved.period);
    setIsOpen(true);
    setEverOpened(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the open-state (per-tab) so a remount can restore it.
  useEffect(() => {
    try { sessionStorage.setItem(SS_OPEN, JSON.stringify({ open: isOpen, mode, plan, period })); }
    catch { /* ignore */ }
  }, [isOpen, mode, plan, period]);

  // ── Deep-links: read window.location.search on mount (client-side; avoids useSearchParams +
  //    Suspense). Consume the onboarding params, then strip them via history.replaceState while
  //    keeping every other param (e.g. ?sym) intact. Runs once. ──
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const wantSignup = sp.has("signup") || sp.has("onboard") || sp.has("plan");
    const wantSignin = sp.has("signin");
    const isResume = sp.get("onboard") === "resume";
    if (!wantSignup && !wantSignin) return;

    // `essential` is the canonical plan key. `?plan=insider` still arrives from cached
    // landing pages and old links, and normalizePlanKey folds it onto `essential` so
    // every step (rail, pricing, checkout) sees one key.
    const planParam = normalizePlanKey(sp.get("plan"));
    const periodParam = sp.get("period");
    if (planParam) setPlan(planParam);
    if (periodParam === "monthly" || periodParam === "annual") setPeriod(periodParam);

    setMode(wantSignin && !wantSignup ? "signin" : "signup");
    setResume(isResume);
    setIsOpen(true);
    setEverOpened(true);

    // Strip only the onboarding params; preserve the rest of the query string.
    for (const k of ["signup", "signin", "onboard", "plan", "period"]) sp.delete(k);
    const qs = sp.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState(null, "", url);
  }, []);

  // ── Auto-close on auth: when `email` transitions ""→non-empty while a SIGNIN sheet is open,
  //    close it (the AuthSheet parent-close pattern). SIGNUP does NOT auto-close — that flow
  //    continues to prefs/plan/done after the session lands. ──
  const prevEmail = useRef(email);
  useEffect(() => {
    const was = prevEmail.current;
    prevEmail.current = email;
    if (was === "" && email !== "" && isOpen && mode === "signin") setIsOpen(false);
  }, [email, isOpen, mode]);

  // ── Pending prefs: on first authed mount, deliver whatever the outbox holds. ──
  //
  // D5: this used to burn a one-shot latch, fire an UN-AWAITED updateUser(...).catch(console.warn),
  // and remove the localStorage copy immediately. If that write failed, both retry mechanisms were
  // already destroyed — the latch said "done" and the durable record was gone — so an explicitly
  // chosen preference was lost forever to one transient Supabase hiccup, with the user having
  // watched onboarding complete normally.
  //
  // Acknowledge before delete: the record is cleared only by deliverPendingPrefs, and only after
  // the authority confirms the write. The latch below guards against CONCURRENT delivery (React
  // StrictMode double-invocation, a re-render mid-flight), not against ever trying again — a
  // failure releases it, so the next authed mount retries.
  const prefsInFlight = useRef(false);
  useEffect(() => {
    if (prefsInFlight.current || email === "") return;
    if (!readPendingPrefs()) return;
    prefsInFlight.current = true;
    const supabase = createClient();
    void deliverPendingPrefs((data) => supabase.auth.updateUser({ data }))
      .then((outcome) => {
        if (outcome.status !== "delivered") {
          // Keep the record AND re-arm, so a later mount (or a later `email` transition) tries again.
          prefsInFlight.current = false;
          console.warn("[onboarding] preferences still pending delivery", outcome);
        }
      })
      .catch((e) => { prefsInFlight.current = false; console.warn("[onboarding] preference delivery threw:", e); });
  }, [email]);

  return (
    <OnboardingCtx.Provider value={api}>
      {children}
      {everOpened && (
        <OnboardingSheet
          mode={mode}
          visible={isOpen}
          email={email}
          initialPlan={plan}
          initialPeriod={period}
          resume={resume}
          onClose={close}
        />
      )}
    </OnboardingCtx.Provider>
  );
}
