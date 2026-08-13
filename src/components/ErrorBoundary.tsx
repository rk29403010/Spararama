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
      <div className="m-4 max-w-xl mx-auto rounded-3xl border border-red-200 bg-red-50 p-6 text-red-950">
        <h2 className="text-xl font-black">{this.props.title ?? 'This section hit a problem'}</h2>
        <p className="mt-2 text-sm text-red-800">
          The rest of Spararama is still available. You can switch tabs, or retry this section.
        </p>
        <details className="mt-3 text-xs text-red-700">
          <summary className="cursor-pointer font-bold">Technical detail</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
        </details>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-4 min-h-11 rounded-xl bg-red-900 px-4 font-extrabold text-white"
        >
          Retry section
        </button>
      </div>
    );
  }
}
