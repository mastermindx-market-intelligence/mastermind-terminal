"use client";
// Chart-origin portfolio position entry — the OWNER-BOUND controller around the shared PositionModal.
//
// ── Why this component exists ───────────────────────────────────────────────────────────────────
//
// The chart's "Add to → Portfolio" form is opened by an account, and the create it eventually
// sends must belong to THAT account. PositionModal is a form: it owns the draft, the create-intent
// UUID and the visible markup, and it hands the finished draft to whoever mounted it. It does not
// know who opened it, so the caller must name the owner — and the caller used to name nobody.
//
// `POST /api/portfolio` ALREADY refuses a supplied `expectedOwnerId` that differs from its
// session, before any mutation (409 "owner mismatch"; `app/api/portfolio/route.ts`). That
// precondition is comparison-only and its omission is legacy behaviour for every other caller, so
// it cannot fire for a request that does not carry the field. Without the field, a form opened by
// A and submitted after the session moved to B is a perfectly valid create — for B. That is the
// defect this controller closes: it is the CLIENT leg of the precondition the server already
// enforces, and it names the owner that OPENED the form.
//
// ── The scope model ───────────────────────────────────────────────────────────────────────────
//
// This is the same triple already proven twice in this codebase — `components/PortfolioView.tsx`
// (OwnerScope) and `components/settings/SectionPortfolioTargets.tsx`: the owner key, a generation
// that advances on every COMMITTED owner transition, and an effect-lifetime token.
//
// The generation is not decoration. A key derived from the owner STRING alone cannot see A→B→A:
// the string returns to its original value, so the original A intent would look valid again. The
// generation keeps advancing, so the original A scope never matches again. A scope captured under
// a revoked lifetime token can never revive either.
//
// Same-owner email and locale changes are NOT identity changes: the owner key is derived from the
// immutable uuid only (`ownerKeyFor`), never from the address. A changed address keeps every live
// same-owner operation running.
//
// ── What this component does NOT claim ─────────────────────────────────────────────────────────
//
// The client cannot observe an auth transition it was never told about. A cookie change that
// lands before the server-rendered owner props refresh is invisible here — and that is exactly
// why the captured owner is SENT to the server, which diffs it against its own session. The client
// fence covers OBSERVED transitions; the server precondition covers the rest.

import { useCallback, useLayoutEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { isAccountOwner, ownerKeyFor } from "@/lib/accountIdentity";
import { decodePositionRead } from "@/lib/portfolioWorkspace";
import { mutationPostcondition, positionMutationFailure, type MutationReceipt } from "@/lib/portfolioMutation";
import type { PositionDraft } from "@/components/PositionModal";

// Keep this controller mounted to observe every account transition while the form chunk loads.
const PositionModal = dynamic(() => import("@/components/PositionModal"), { ssr: false });

/**
 * What the chart opens: the symbol, and the immutable owner that opened it.
 *
 * `ownerId` is captured AT OPEN and is never re-read. It is the wire value the server compares
 * against its session; `expectedOwnerId` must never be the owner at submit time.
 *
 * `nonce` identifies THIS opening. A replaced intent remounts the form, so it gets a fresh draft
 * and a fresh create-intent UUID instead of inheriting the previous opening's identity.
 */
export type ChartPositionIntent = {
  nonce: number;
  symbol: string;
  /** The immutable account uuid captured at open. "" for a guest, which may not write. */
  ownerId: string;
};

/**
 * The scope one operation was created under: the owner key, the committed account-transition
 * generation, and the effect-lifetime token of the instance that captured it. A→B retires A's
 * scope; A→B→A never matches the original A because the generation keeps advancing; an
 * unmounted instance's token stays revoked forever.
 *
 * `dispatched` records that an attempt under this scope already reached the network. It is what
 * keeps a later refusal honest: once a write may have committed, a refusal can no longer claim
 * the change "was not applied" — it can only say the outcome could not be confirmed.
 *
 * Mirrors `OwnerScope` in `components/PortfolioView.tsx`. Declared here rather than imported so
 * this controller carries no dependency on the Portfolio workspace it deliberately does not use.
 */
type OwnerScope = { owner: string; generation: number; lifetime: { revoked: boolean }; dispatched: boolean };

export default function ChartPositionEntry({
  intent,
  observedOwner,
  onDismiss,
  onCommitted,
}: {
  /** The open intent, or null when the chart has no position form open. */
  intent: ChartPositionIntent | null;
  /** The owner key the shell currently observes: `ownerKeyFor(userId)`. Changes on an account
   *  transition; a same-owner email change does not move it. */
  observedOwner: string;
  /** Close the form. It receives the intent it belongs to, so a stale callback cannot close a
   *  newer opening. */
  onDismiss: (intent: ChartPositionIntent) => void;
  /** Refresh the rail after a CONFIRMED create. */
  onCommitted: () => void;
}) {
  // ── the observed owner, its generation, and this instance's lifetime ───────────────────────
  // The owner is CURRENT here; the scope a form captured is the owner it was opened under.
  // Every ref is declared before the effects that read it.
  const ownerRef = useRef(observedOwner);
  const generationRef = useRef(0);
  // The initial token is already revoked: a scope captured before the effect below ran must never
  // be dispatchable.
  const lifetimeRef = useRef({ revoked: true });
  // The scope captured WITH the intent. Captured when an intent ARRIVES, never re-read at submit
  // time: a submit is judged against the owner the form was opened under. A replaced intent
  // captures a fresh scope, so the previous opening's callbacks can never act on the new one.
  const capturedRef = useRef<{ intent: ChartPositionIntent | null; scope: OwnerScope | null }>({
    intent: null, scope: null,
  });

  const scopeValid = useCallback((scope: OwnerScope): boolean =>
    !scope.lifetime.revoked && scope.lifetime === lifetimeRef.current
    && ownerRef.current === scope.owner
    && generationRef.current === scope.generation, []);

  // Layout effect, not passive: the token must exist before any scope is captured. A fresh setup
  // token lets a StrictMode replacement work without reviving a prior setup's queued intent, and
  // cleanup permanently revokes that token.
  useLayoutEffect(() => {
    const token = { revoked: false };
    lifetimeRef.current = token;
    return () => { token.revoked = true; };
  }, []);

  // Layout effect, not passive: the owner must be retired BEFORE any async continuation can read
  // the generation. Abandoned renders never commit, so they never advance it.
  useLayoutEffect(() => {
    if (ownerRef.current === observedOwner) return;
    ownerRef.current = observedOwner;
    generationRef.current += 1;
    // A committed account transition RETIRES the open intent. It does not close the form, and it
    // never opens one for the new account: the draft belongs to the account that opened it, so
    // every operation under it is refused rather than silently performed for somebody else.
    //
    // Closing the form here instead would be worse in two ways. It would swallow the honest
    // outcome of an operation that was ALREADY in flight (that write may have committed for its
    // own owner, and the user deserves to be told it could not be confirmed), and it would make
    // the pre-dispatch fence below unreachable — a retired scope could never even be offered a
    // form to submit from.
  }, [observedOwner]);

  useLayoutEffect(() => {
    const captured = capturedRef.current;
    if (captured.intent === intent) {
      if (!intent) return;
      if (captured.scope?.lifetime === lifetimeRef.current) return;
      // The lifetime token was replaced (a StrictMode replacement setup). Re-capture under the
      // CURRENT token, keeping the CAPTURED generation: replacing a token must never revive a
      // scope that an owner transition already retired.
      const scope = captured.scope;
      if (!scope) return;
      capturedRef.current = { intent, scope: { ...scope, lifetime: lifetimeRef.current } };
      return;
    }
    capturedRef.current = {
      intent,
      scope: intent
        ? {
          owner: ownerKeyFor(intent.ownerId),
          generation: generationRef.current,
          lifetime: lifetimeRef.current,
          dispatched: false,
        }
        : null,
    };
  });

  const submit = useCallback(async (draft: PositionDraft) => {
    // A form with no opening cannot be submitted: there is no owner to name.
    if (!intent) return { ok: false as const, reason: null, retired: "never-dispatched" as const };
    const captured = capturedRef.current;
    const scope = captured.scope;
    // 1. BEFORE DISPATCH. A retired scope — an observed owner transition, an unmount, or a
    //    replaced intent — never reaches the network. Nothing was sent, so nothing is claimed.
    if (!scope || captured.intent !== intent || !scopeValid(scope) || !isAccountOwner(scope.owner)) {
      // An observed account change is a precise reason, and an honest one: nothing was sent, so
      // nothing was applied. Any other retirement (an unmount, a replaced opening) has no such
      // cause to name, and says only that the save could not be confirmed.
      // "The account changed… so it was not applied" is only true while NOTHING has been sent
      // for this opening. Once an attempt reached the network it may have committed for its own
      // owner, and the only honest answer is that the outcome could not be confirmed.
      const accountChanged = !!scope && !scope.dispatched
        && (ownerRef.current !== scope.owner || generationRef.current !== scope.generation);
      return {
        ok: false as const,
        reason: accountChanged ? ("ownerChanged" as const) : null,
        retired: "never-dispatched" as const,
      };
    }
    // The owner that OPENED the form, carried with the intent. Never the owner at submit time.
    const expectedOwnerId = intent.ownerId;
    // The request is about to leave. From here the outcome may be a commit nobody can confirm.
    scope.dispatched = true;
    let response: Response;
    try {
      response = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", ...draft, expectedOwnerId }),
      });
    } catch {
      return { ok: false as const, reason: null };
    }
    // 2. AFTER THE REQUEST RESOLVED. The request WAS sent: it may have committed for its own
    //    owner. Retirement rejects the caller without a replay and without a rollback claim.
    if (!scopeValid(scope) || capturedRef.current.intent !== intent) {
      return { ok: false as const, reason: null, retired: "sent-uncertain" as const };
    }
    const receipt = await response.json().catch(() => null) as MutationReceipt | null;
    // 3. AFTER THE BODY WAS READ.
    if (!scopeValid(scope) || capturedRef.current.intent !== intent) {
      return { ok: false as const, reason: null, retired: "sent-uncertain" as const };
    }
    if (!response.ok) return positionMutationFailure(response.status, receipt);
    if (!receipt) return { ok: false as const, reason: null };
    let reread: Response;
    try {
      reread = await fetch("/api/portfolio?view=positions", { cache: "no-store" });
    } catch {
      return { ok: false as const, reason: null };
    }
    // 4. AFTER THE CANONICAL READ RESOLVED.
    if (!scopeValid(scope) || capturedRef.current.intent !== intent) {
      return { ok: false as const, reason: null, retired: "sent-uncertain" as const };
    }
    const canonical = reread.ok ? decodePositionRead(await reread.json().catch(() => null)) : null;
    // 5. AFTER THE CANONICAL READ WAS DECODED.
    if (!scopeValid(scope) || capturedRef.current.intent !== intent) {
      return { ok: false as const, reason: null, retired: "sent-uncertain" as const };
    }
    // A receipt is not a confirmation: the canonical reread must show the record.
    if (!canonical || !mutationPostcondition({ action: "create", ...draft }, receipt, canonical.positions)) {
      return { ok: false as const, reason: null };
    }
    // 6. BEFORE SUCCESS — and therefore before the dismissal and the rail refresh it implies. A
    //    retired scope must not close a newer form and must not refresh a rail it no longer owns.
    if (!scopeValid(scope) || capturedRef.current.intent !== intent) {
      return { ok: false as const, reason: null, retired: "sent-uncertain" as const };
    }
    onDismiss(intent);
    onCommitted();
    return { ok: true as const };
  }, [intent, onDismiss, onCommitted, scopeValid]);

  if (!intent) return null;
  // A local const, so the narrowing survives into the callbacks below.
  const opened = intent;
  return (
    <PositionModal
      // A replaced opening is a different form: a fresh draft and a fresh create-intent UUID.
      key={opened.nonce}
      mode="add"
      position={null}
      initialTicker={opened.symbol}
      onCancel={() => onDismiss(opened)}
      onSubmit={submit}
    />
  );
}
