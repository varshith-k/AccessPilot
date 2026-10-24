"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { buttonStyles, panelStyles } from "./ui/styles";

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
        <div role="alert" className={`${panelStyles} m-4 space-y-3 border-2 border-danger`}>
          <h2 className="text-xl font-bold">Something went wrong in AccessPilot</h2>
          <p>
            The assistant screen stopped working. If a task was running, it may still be open in the
            browser window. Reload the assistant to continue.
          </p>
          <button type="button" onClick={this.retry} className={buttonStyles.primary}>
            Reload the assistant
          </button>
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
