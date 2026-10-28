import React from "react";
import { Button } from "@/components/ui/button";

type State = { error: Error | null };

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void fetch("/api/monitoring/error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error.message || "Unknown browser error",
        stack: `${error.stack || ""}\n${info.componentStack || ""}`.slice(0, 12_000),
        route: typeof window === "undefined" ? null : window.location.pathname,
        context: { userAgent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 300) },
      }),
      keepalive: true,
    }).catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-8 text-center shadow-xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-danger">Unexpected error</p>
          <h1 className="mt-2 text-2xl font-bold">This screen could not be loaded</h1>
          <p className="mt-3 text-sm text-muted-foreground">The incident was recorded for the operations team. Your wallet and bet data were not changed by this screen error.</p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => this.setState({ error: null })}>Try again</Button>
            <Button variant="outline" onClick={() => window.location.assign("/")}>Go home</Button>
          </div>
        </div>
      </main>
    );
  }
}
