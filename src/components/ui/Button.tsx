import type { ButtonHTMLAttributes } from 'react';

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const base =
  'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-full text-[14px] font-medium tracking-tight transition duration-base focus:outline-none focus:shadow-focus disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100';

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(
        base,
        'bg-brand-b text-[#010000] shadow-press hover:bg-brand-a hover:scale-[1.01] active:scale-[0.99]',
        className,
      )}
    />
  );
}

export function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(
        base,
        'border border-white/15 bg-white/5 text-fg-0 hover:bg-white/10',
        className,
      )}
    />
  );
}

export function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(base, 'bg-transparent text-fg-1 hover:text-fg-0 hover:bg-white/5', className)}
    />
  );
}

export function DangerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(base, 'bg-ui-danger/15 text-ui-danger hover:bg-ui-danger/25', className)}
    />
  );
}

export function IconButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(
        'grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-fg-1 transition-colors duration-fast hover:bg-white/10 hover:text-fg-0 focus:outline-none focus:shadow-focus',
        className,
      )}
    />
  );
}
