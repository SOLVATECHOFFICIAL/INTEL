import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let displayMessage = 'An unexpected application error occurred.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string };
      if (parsed && typeof parsed.error === 'string' && parsed.error) {
        displayMessage = parsed.error;
      }
    } catch {
      if (error.message) {
        displayMessage = error.message;
      }
    }
    return {
      hasError: true,
      message: displayMessage,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled boundary error:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, message: '' });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-[#0B1A2E]"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-bold text-[#0B1A2E]">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-slate-600">{this.state.message}</p>
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-5 inline-flex items-center rounded-lg bg-[#1E88E5] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1976D2]"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
