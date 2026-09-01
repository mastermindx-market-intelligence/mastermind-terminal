import type { CompanySourceContextRef } from "./companySourceContext";

/**
 * Browser bridge for the document-level Mastermind Brain singleton.
 *
 * `mm_brain.js` intentionally survives client-side route changes.  Its config
 * object is captured once, so an Analysis workspace reached from a different
 * Terminal symbol must explicitly replace the live symbol getter before asking
 * the already-mounted widget to open.
 */

export interface MastermindBrainHost {
  MMBrain?: { open?: () => void; mounted?: boolean };
  MM_BRAIN_CFG?: {
    symbol?: () => string;
    getCompanySourceSpan?: () => CompanySourceContextRef | null | undefined;
    [key: string]: unknown;
  };
  __MM_BRAIN_ACTIVE_SYMBOL__?: string;
}

function currentHost(): MastermindBrainHost | null {
  if (typeof window === "undefined") return null;
  return window as unknown as MastermindBrainHost;
}

function normalizedSymbol(symbol: string): string | null {
  const next = symbol.trim().toUpperCase();
  return next || null;
}

/**
 * Make the singleton's *current* config resolve to `symbol`, even when the
 * React owner that first mounted it has since unmounted.  The closure reads the
 * shared value on every request, so a later Terminal mount can take ownership
 * again by calling this function with its active symbol.
 */
export function handoffMastermindBrainSymbol(symbol: string, host: MastermindBrainHost | null = currentHost()): boolean {
  const next = normalizedSymbol(symbol);
  if (!host || !next) return false;
  host.__MM_BRAIN_ACTIVE_SYMBOL__ = next;
  if (host.MM_BRAIN_CFG) {
    host.MM_BRAIN_CFG.symbol = () => host.__MM_BRAIN_ACTIVE_SYMBOL__ || next;
  }
  return true;
}

/** Return true only when an in-document Brain actually opened. */
export function openMastermindBrainForSymbol(symbol: string, host: MastermindBrainHost | null = currentHost()): boolean {
  handoffMastermindBrainSymbol(symbol, host);
  if (!host?.MMBrain?.open) return false;
  host.MMBrain.open();
  return true;
}

/**
 * Bind the currently rendered source attachment to the singleton without
 * persisting it. An older panel's cleanup cannot erase a later owner's getter.
 */
export function bindMastermindBrainCompanySource(
  getCompanySourceSpan: () => CompanySourceContextRef | null,
  host: MastermindBrainHost | null = currentHost(),
  onConsume?: () => void,
): (() => void) | null {
  if (!host?.MM_BRAIN_CFG) return null;
  let consumed = false;
  const owner = () => {
    if (consumed) return undefined;
    const source = getCompanySourceSpan();
    if (!source) return undefined;
    consumed = true;
    onConsume?.();
    return source;
  };
  host.MM_BRAIN_CFG.getCompanySourceSpan = owner;
  return () => {
    if (host.MM_BRAIN_CFG?.getCompanySourceSpan === owner) {
      host.MM_BRAIN_CFG.getCompanySourceSpan = undefined;
    }
  };
}

/** Exact-source entry fails closed when the in-document reference bridge is unavailable. */
export function openMastermindBrainForCompanySource(
  symbol: string,
  host: MastermindBrainHost | null = currentHost(),
): boolean {
  if (typeof host?.MM_BRAIN_CFG?.getCompanySourceSpan !== "function") return false;
  return openMastermindBrainForSymbol(symbol, host);
}
