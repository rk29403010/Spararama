import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string | number;
  title?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Spararama UI section crashed', error, info);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="m-4 max-w-xl mx-auto rounded-3xl border border-red-200 bg-red-50 p-6 text-red-950">
        <h2 className="text-2xl font-black">{this.props.title ?? 'This section failed'}</h2>
        <button type="button" onClick={() => this.setState({ error: null })} className="mt-5 min-h-14 rounded-xl bg-red-900 px-5 text-base font-black text-white">
          Try again
        </button>
        <details className="mt-4 text-sm text-red-800">
          <summary className="min-h-11 cursor-pointer flex items-center font-bold">Technical details</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
        </details>
      </div>
    );
  }
}
