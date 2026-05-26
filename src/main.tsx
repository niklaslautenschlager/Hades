import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#09090b",
            color: "#f87171",
            padding: "32px",
            fontFamily: "monospace",
            fontSize: "13px",
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          <strong style={{ fontSize: "16px" }}>React Error</strong>
          {"\n\n"}
          {err.message}
          {"\n\n"}
          {err.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
