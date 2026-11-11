import type { Metadata, Viewport } from "next";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";

/** Presentation only. The incumbent exact server opt-in controls beta identity;
 * no route, authentication, entitlement or deployment authority is added. */
export function workspaceMetadata(workspace: string, legacyTitle = `${workspace} · Mastermind Terminal`, flag: unknown = process.env.MMX_SHARED_SHELL): Metadata {
  return { title: isSharedShellEnabled(flag) ? `${workspace} · Mastermind` : legacyTitle };
}
export function applicationMetadata(flag: unknown = process.env.MMX_SHARED_SHELL): Metadata {
  return isSharedShellEnabled(flag)
    ? { title: "Mastermind", description: "Market intelligence, company research, charting and your portfolio in one workspace." }
    : { title: "Mastermind Terminal", description: "Institutional charting — proprietary confluence signals, macro regime, and an AI copilot." };
}
export function applicationViewport(flag: unknown = process.env.MMX_SHARED_SHELL): Viewport {
  void flag; // Preserve the caller contract; viewport zoom is independent of identity.
  // Ordinary web pages permit reader magnification in either identity mode.
  // NativeViewportPolicy owns the explicit shell=app / WK gesture restriction.
  return { width: "device-width", initialScale: 1, viewportFit: "cover" };
}
