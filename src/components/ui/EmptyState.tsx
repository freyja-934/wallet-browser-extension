import type { ReactNode } from 'react';
import { showSettings } from '../../store/slices/uiSlice';
import { useAppDispatch } from '../../store/store';
import { IconButton, PrimaryButton, SecondaryButton } from './Button';
import { Icon, type IconName } from './Icon';

/**
 * A failed read, said plainly: what could not load, why, and a Retry. Never a
 * zero or an empty list standing in for an error.
 */
export function ErrorCard({
  title,
  body,
  onRetry,
  action,
  testId = 'error-card',
}: {
  title: string;
  body: ReactNode;
  onRetry?: () => void;
  action?: { label: string; onClick: () => void };
  testId?: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-col items-center rounded-2xl border border-ui-danger/30 bg-ui-danger/10 px-4 py-5 text-center"
    >
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-ui-danger/15 text-ui-danger">
        <Icon name="warning" className="h-4 w-4" />
      </div>
      <h3 className="text-sm font-medium text-fg-0">{title}</h3>
      <p className="mt-1 max-w-[260px] break-words text-xs leading-relaxed text-fg-2">{body}</p>
      {(onRetry || action) && (
        <div className="mt-4 flex items-center gap-2">
          {onRetry && (
            <SecondaryButton type="button" className="h-8 px-4 text-xs" onClick={onRetry}>
              Retry
            </SecondaryButton>
          )}
          {action && (
            <PrimaryButton type="button" className="h-8 px-4 text-xs" onClick={action.onClick}>
              {action.label}
            </PrimaryButton>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline "Settings" link for the "add an RPC endpoint" guidance; opens the Settings panel. */
export function SettingsLink({ children = 'Settings' }: { children?: ReactNode }) {
  const dispatch = useAppDispatch();
  return (
    <button
      type="button"
      onClick={() => dispatch(showSettings())}
      className="text-fg-0 underline decoration-white/30 underline-offset-2 hover:text-brand-a"
      data-testid="open-settings-link"
    >
      {children}
    </button>
  );
}

/** The one sentence every "no reachable endpoint" state shows. */
export function EndpointsUnreachableBody() {
  return (
    <>
      No RPC endpoint reachable from this network. Add one in <SettingsLink />.
    </>
  );
}

export function EmptyState({
  icon = 'nft',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/5 text-fg-2">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-medium text-fg-0">{title}</h3>
      <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-fg-2">{body}</p>
      {action && (
        <PrimaryButton className="mt-4 h-9 px-5 text-xs" onClick={action.onClick}>
          {action.label}
        </PrimaryButton>
      )}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/8 ${className}`} />;
}

export function Banner({
  tone = 'warning',
  children,
}: {
  tone?: 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  const tones = {
    warning: 'border-brand-b/30 bg-brand-b/10 text-brand-a',
    danger: 'border-ui-danger/30 bg-ui-danger/10 text-ui-danger',
    info: 'border-white/10 bg-white/5 text-fg-1',
  };
  return (
    <div className={`flex gap-2 rounded-2xl border px-3 py-2.5 text-xs leading-relaxed ${tones[tone]}`}>
      <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function AddressText({
  address,
  truncate = true,
}: {
  address: string;
  truncate?: boolean;
}) {
  const label = truncate ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
  return (
    <span className="font-mono text-xs tracking-tight text-fg-1 break-all">{label}</span>
  );
}

export function StepHeader({
  title,
  subtitle,
  step,
  total,
  onBack,
}: {
  title: string;
  subtitle?: string;
  step?: number;
  total?: number;
  onBack?: () => void;
}) {
  return (
    <div className="mb-4">
      <div className="mb-4 flex items-center justify-between">
        {onBack ? (
          <IconButton type="button" onClick={onBack} aria-label="Back">
            <Icon name="back" className="h-4 w-4" />
          </IconButton>
        ) : (
          <span />
        )}
        {step && total ? (
          <span className="text-[11px] uppercase tracking-[0.16em] text-fg-2">
            {step} / {total}
          </span>
        ) : null}
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-fg-0">{title}</h2>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-fg-2">{subtitle}</p>}
    </div>
  );
}

export function StepScreen({
  children,
  footer,
}: {
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-5">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="mt-4 flex shrink-0 items-center justify-between">{footer}</div>
    </div>
  );
}
