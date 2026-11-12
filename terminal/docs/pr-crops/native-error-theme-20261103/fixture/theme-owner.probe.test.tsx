import { Component, useLayoutEffect, useState, type ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import { LangProvider } from "@/lib/i18n";
import { SharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";
import { GUEST_IDENTITY } from "@/lib/accountIdentity";
import { writeFileSync } from "node:fs";

vi.mock("@/lib/useMarketPrefs", () => ({ useAccountPrefs: () => ({ metaPrefs: { theme: "light" } }) }));
const observations: { phase: string; theme?: string; owner?: string }[] = [];
const snapshot = (phase: string) => observations.push({ phase, theme: document.documentElement.dataset.theme, owner: document.documentElement.dataset.mmxSharedShell });
const failure = new Error("Controlled component failure; no route/provider/network effect");
function Fallback() {
  snapshot("fallback-render");
  useLayoutEffect(() => { snapshot("fallback-layout-effect"); }, []);
  return <ErrorPage error={failure} unstable_retry={() => {}} />;
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Fallback /> : this.props.children; }
}
function Subject({ failed }: { failed: boolean }) { if (failed) throw failure; return <p>Owned route content</p>; }
function Fixture() {
  const [failed, fail] = useState(false);
  return <LangProvider><button id="fail" onClick={() => fail(true)}>Fail owned route</button><Boundary><SharedShellPresentation enabled identity={GUEST_IDENTITY}><Subject failed={failed} /></SharedShellPresentation></Boundary></LangProvider>;
}

it("observes the actual presentation owner lifetime at an error replacement", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  document.documentElement.dataset.theme = "dark";
  window.history.replaceState(null, "", "/terminal?ret=" + encodeURIComponent("https://beta.mastermind-x.com/portfolio?book=owned#holding-AAPL"));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(<Fixture />); });
  snapshot("healthy-light");
  expect(document.documentElement.dataset.theme).toBe("light");
  await act(async () => { host.querySelector<HTMLButtonElement>("#fail")!.click(); });
  snapshot("after-fallback");
  expect(document.documentElement.dataset.theme).toBe("dark");
  writeFileSync("/Volumes/Mastermind/evidence/native-error-theme-p12t21s2-20261103/theme-owner-probe.json", JSON.stringify({ source: "protected3eb, actual SharedShellPresentation + ErrorPage, mocked preference value only; ReactDOM component lifetime, not Next/inShell proof", observations }, null, 2));
  console.log(JSON.stringify(observations));
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks();
});
