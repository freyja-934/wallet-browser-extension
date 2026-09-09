import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const field =
  'w-full h-11 rounded-full bg-white/5 border border-white/12 px-4 text-[15px] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:shadow-focus transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed';

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ className = '', ...rest }, ref) {
    return <input ref={ref} {...rest} className={cx(field, className)} />;
  },
);

export function PasswordField({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={cx(field, 'pr-12', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-2 hover:text-fg-0"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cx(
        'w-full rounded-2xl bg-white/5 border border-white/12 px-4 py-3 text-[15px] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:shadow-focus transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed resize-none',
        className,
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props;
  return (
    <select
      {...rest}
      className={cx(field, 'appearance-none pr-8', className)}
    />
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-fg-2">{children}</label>;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="flex rounded-full bg-white/5 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cx(
            'h-8 flex-1 rounded-full text-xs font-medium transition-colors',
            value === option.value ? 'bg-brand-b text-[#010000]' : 'text-fg-2 hover:text-fg-0',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
