import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';

interface Props {
  children: ReactNode;
  /**
   * Something that changes when the reader has moved on — the path, normally.
   *
   * A boundary with no way of forgetting turns one broken page into a broken
   * application: the error state survives every navigation, and the only way
   * out is a reload nobody was told to do.
   */
  resetKey?: string;
}

interface State {
  error: Error | null;
  /** Where it happened, which the error itself does not say. */
  stack: string | null;
}

/**
 * Catches what a page throws while rendering, so it costs the page and not the
 * application.
 *
 * React unmounts the whole tree on an uncaught render error. Without a boundary
 * that means a **white screen with nothing in it** — no message, no navigation,
 * no clue — for a fault as small as one field a response did not carry. What is
 * shown instead says as much as it can: something broke here, the reader is not
 * at fault, and here is the text to report.
 *
 * A class, which is the only way to catch it: hooks cannot.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    // React writes the error to the console itself. The component stack is the
    // half that says *where*, and the half worth pasting into a ticket.
    this.setState({ stack: info.componentStack ?? null });
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.reset();
  }

  reset = () => this.setState({ error: null, stack: null });

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return <Crashed error={error} stack={stack} onRetry={this.reset} />;
  }
}

/**
 * What is shown in place of the page.
 *
 * The detail is folded away and not hidden: a reader who cannot act on a stack
 * trace should not be handed one, and the person they forward it to needs
 * exactly that. A component function rather than markup in the class above,
 * because it is the only way to reach the catalogue.
 */
function Crashed({
  error,
  stack,
  onRetry,
}: {
  error: Error;
  stack: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const detail = [error.message, stack].filter(Boolean).join('\n');

  return (
    <div className="empty crashed">
      <h2>{t('crash.title')}</h2>
      <p>{t('crash.text')}</p>
      <div className="form-actions">
        {/* Worth offering before a reload: a render that failed on a value
            already replaced succeeds on the second try, and a reload costs the
            session's whole state to find that out. */}
        <button type="button" className="btn" onClick={onRetry}>
          {t('crash.retry')}
        </button>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          {t('crash.reload')}
        </button>
      </div>
      <details className="crash-detail">
        <summary>{t('crash.detail')}</summary>
        <pre>{detail}</pre>
        <CopyButton text={detail} />
      </details>
    </div>
  );
}
