import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Caught:", error.message);
    console.error("[ErrorBoundary] Stack:", error.stack);
    console.error("[ErrorBoundary] Component stack:", info.componentStack);
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", padding: 24,
          background: "#0E1F40", color: "#fff", gap: 12, fontFamily: "'DM Sans', sans-serif"
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Something went wrong</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0, textAlign: "center", wordBreak: "break-all" }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={() => {
              this.reset();
              this.props.onReset?.();
            }}
            style={{
              marginTop: 8, padding: "10px 24px", background: "#8DD63F", color: "#0E1F40",
              border: "none", borderRadius: 100, fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
