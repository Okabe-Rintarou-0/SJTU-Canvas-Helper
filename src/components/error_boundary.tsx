import { Component, type ErrorInfo, type ReactNode } from "react";
import { logDiagnostic } from "../lib/diagnostics";
import { LOG_LEVEL_ERROR } from "../lib/model";
import LogModal from "./log_modal";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; showLog: boolean }> {
  state = { failed: false, showLog: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logDiagnostic(LOG_LEVEL_ERROR, "frontend.react.render", error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main style={{ maxWidth: 640, margin: "64px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1>页面出现错误</h1>
        <p>请先保存日志以便反馈问题，再尝试重新加载页面。</p>
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" onClick={() => this.setState({ showLog: true })}>查看日志与反馈</button>
          <button type="button" onClick={() => window.location.reload()}>重新加载页面</button>
        </div>
        {this.state.showLog && <LogModal onClose={() => this.setState({ showLog: false })} />}
      </main>
    );
  }
}
