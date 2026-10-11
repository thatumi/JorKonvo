import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

/**
 * Last-resort catch for a render-time crash anywhere in the tree. Without it,
 * one thrown error blanks the whole page to white - unrecoverable on mobile,
 * where there's no console to look at. React needs a class component for this;
 * `t` is the non-reactive lookup so it works even if the i18n provider itself
 * was in the subtree that threw.
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-bg-darkest p-6 text-center">
        <svg viewBox="0 0 24 24" className="h-12 w-12 text-dnd" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
        <div>
          <p className="text-lg font-semibold text-header">{t("common.error")}</p>
          <p className="mt-1 max-w-sm text-sm text-muted">{t("errorBoundary.body")}</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          {t("errorBoundary.reload")}
        </button>
        {import.meta.env.DEV && (
          <pre className="mt-2 max-h-48 max-w-lg overflow-auto rounded bg-bg-primary p-3 text-left text-xs text-muted">
            {this.state.error.stack ?? String(this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}
