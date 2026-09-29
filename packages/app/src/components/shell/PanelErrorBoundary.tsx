import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  region: string;
  children: ReactNode;
  onReset?: () => void;
};

type State = {
  error: Error | null;
  resetKey: number;
};

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.region}] panel error`, error, info.componentStack);
  }

  private reload = (): void => {
    this.props.onReset?.();
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 p-4 bg-surface text-center"
          data-testid={`panel-error-${this.props.region}`}
        >
          <p className="text-meta text-text-2">Something went wrong</p>
          <button
            type="button"
            className="text-meta text-accent hover:underline"
            onClick={this.reload}
          >
            Reload panel
          </button>
        </div>
      );
    }
    return <div key={this.state.resetKey} className="flex flex-col flex-1 min-h-0 min-w-0">{this.props.children}</div>;
  }
}
