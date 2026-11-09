"use client";
import { Component, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/lib/i18n";
import { tryChunkReload } from "@/lib/navigationRecovery";

type Props = {
  children: ReactNode;
  visible: boolean;
  onClose: () => void;
  onRetry: () => void;
};

const LEX = {
  title: ["Account settings couldn't open", "账户设置暂时无法打开"],
  message: ["Your chart is still available. Try opening settings again, or close this dialog.", "终端仍可正常使用。您可以重试打开设置，或关闭此窗口。"],
  retry: ["Try again", "重试"],
  close: ["Close", "关闭"],
} as const;

function FailedSettings({ visible, onClose, onRetry }: Omit<Props, "children">) {
  const { lang } = useLang();
  if (!visible) return null;
  const pick = (key: keyof typeof LEX) => LEX[key][lang === "zh" ? 1 : 0];
  return createPortal(
    <div className="acs-overlay open" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <div className="acs-card" role="alertdialog" aria-modal="true" aria-labelledby="acs-recovery-title">
        <div className="acs-card-surface" style={{ padding: 28, display: "grid", gap: 16, alignContent: "center" }}>
          <h2 id="acs-recovery-title">{pick("title")}</h2>
          <p>{pick("message")}</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="acs-btn primary" onClick={onRetry}>{pick("retry")}</button>
            <button type="button" className="acs-btn ghost" onClick={onClose}>{pick("close")}</button>
          </div>
        </div>
      </div>
    </div>, document.body,
  );
}

/** A failure inside the optional settings subtree must never tear down the chart or shared shell. */
export default class SettingsPanelBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Do not serialize profile data or exception payloads to a remote endpoint.
    console.error("[SettingsPanelBoundary] Settings render/load failed", error);
    // A stale lazy-loaded chunk can heal with the app's existing guarded,
    // one-shot reload. Programming errors stay contained in this panel.
    tryChunkReload(error);
  }

  render() {
    if (this.state.failed) {
      return <FailedSettings visible={this.props.visible} onClose={this.props.onClose} onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}
