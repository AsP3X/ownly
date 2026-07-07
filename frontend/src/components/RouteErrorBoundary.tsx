// Human: Recover from lazy-route or render failures without a blank screen.
// Agent: CATCHES React errors in route subtree; OFFERS reload + home navigation.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type RouteErrorBoundaryProps = {
  children: ReactNode;
};

type RouteErrorBoundaryState = {
  error: Error | null;
};

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            This page failed to load. You can reload or return home and try again.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              Reload page
            </Button>
            <Button type="button" variant="outline" onClick={() => { window.location.href = "/"; }}>
              Go home
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
