import { Component, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import ErrorPage from "@/app/error";
import { LangProvider } from "@/lib/i18n";
import { GUEST_IDENTITY } from "@/lib/accountIdentity";
import { SharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";

declare global { interface Window { fixture: { retries: number; observations: { phase: string; theme?: string; marker?: string }[] }; } }
window.fixture = { retries: 0, observations: [] };
const failure = Object.assign(new Error("Controlled source-component error"), { digest: "LOCAL-SOURCE-FIXTURE" });
function snapshot(phase: string) { window.fixture.observations.push({ phase, theme: document.documentElement.dataset.theme, marker: document.documentElement.dataset.mmxSharedShell }); }
function Fallback({ retry }: { retry: () => void }) { snapshot("fallback-render"); return <ErrorPage error={failure} unstable_retry={retry} />; }
class Boundary extends Component<{ children: ReactNode; retry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Fallback retry={this.props.retry} /> : this.props.children; }
}
function Subject({ failed, fail }: { failed: boolean; fail: () => void }) {
  if (failed) throw failure;
  return <main style={{ padding: 24 }}><h1>Controlled source component</h1><button className="btn btn-primary" id="show-error" onClick={() => { snapshot("before-failure"); fail(); }}>Show controlled error</button></main>;
}
function Fixture() {
  const [failed, setFailed] = useState(false), [generation, setGeneration] = useState(0);
  const retry = () => { window.fixture.retries++; setFailed(false); setGeneration(n => n + 1); };
  return <LangProvider><Boundary key={generation} retry={retry}><SharedShellPresentation enabled identity={GUEST_IDENTITY}><Subject failed={failed} fail={() => setFailed(true)} /></SharedShellPresentation></Boundary></LangProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
