"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertIcon } from "./ui/icons";
import { buttonStyles } from "./ui/styles";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  /** Changing the key remounts the children with fresh state. */
  attempt: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("AccessPilot crashed while rendering", error, info.componentStack);
  }

  private readonly retry = () => {
    this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }));
  };

  override render() {
    if (this.state.failed) {
      return (
        <div className="flex min-h-dvh items-center justify-center p-4">
          <div
            role="alert"
            className="w-full max-w-md space-y-4 rounded-card border border-border bg-elevated p-6 shadow-elevated"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger">
              <AlertIcon className="size-5" />
            </span>
            <h2 className="text-lg font-semibold tracking-tight">
              Something went wrong in AccessPilot
            </h2>
            <p className="text-sm text-muted">
              The assistant screen stopped working. If a task was running, it may still be open in
              the browser window. Reload the assistant to continue.
            </p>
            <button type="button" onClick={this.retry} className={buttonStyles.primary}>
              Reload the assistant
            </button>
          </div>
        </div>
      );
    }
    return (
      <div key={this.state.attempt} className="contents">
        {this.props.children}
      </div>
    );
  }
}
