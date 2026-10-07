"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  /** Optional label for support / logs */
  area?: string;
};

type State = {
  error: Error | null;
};

/**
 * Catches render/runtime errors in the subtree and shows a recoverable Persian UI
 * instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep console for operators; avoid leaking stack into the UI.
    console.error(`[ErrorBoundary${this.props.area ? `:${this.props.area}` : ""}]`, error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <p className="text-lg font-bold text-foreground">مشکلی در نمایش این بخش پیش آمد</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          صفحه را یک‌بار تازه کنید. اگر ادامه داشت، کمی بعد دوباره تلاش کنید.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={this.reset}>
            تلاش دوباره
          </Button>
          <Button type="button" variant="outline" onClick={() => window.location.assign("/")}>
            بازگشت به خانه
          </Button>
        </div>
      </div>
    );
  }
}
