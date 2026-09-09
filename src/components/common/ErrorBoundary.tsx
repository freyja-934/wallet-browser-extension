import { Component, type ErrorInfo, type ReactNode } from 'react';
import { PrimaryButton } from '../ui/Button';
import { GlowMark } from '../ui/GlowMark';
import { PopupFrame } from '../ui/Atmosphere';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <PopupFrame atmosphere="still" heavy>
          <div className="flex h-full min-h-0 flex-col items-center justify-center px-8 text-center">
            <GlowMark size={64} />
            <h2 className="mt-6 text-xl font-semibold tracking-tight text-fg-0">Something went wrong</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-2">
              Your funds are safe. Reload the popup to continue.
            </p>
            {this.state.error && (
              <pre className="mt-4 max-h-24 w-full overflow-auto rounded-2xl bg-white/5 p-3 text-left font-mono text-[10px] text-fg-3">
                {this.state.error.toString()}
              </pre>
            )}
            <PrimaryButton className="mt-6 w-full" onClick={this.handleReset}>
              Reload
            </PrimaryButton>
          </div>
        </PopupFrame>
      );
    }

    return this.props.children;
  }
}
