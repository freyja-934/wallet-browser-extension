interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Exact balance line, e.g. `1.5 SOL`; `—` while it is unknown. */
  balance: string;
  symbol: string;
  onMaxClick: () => void;
  /** Max needs a known balance; disabled until there is one. */
  maxDisabled?: boolean;
  /** What is wrong with `value`, shown under the field. */
  error?: string;
}

export function AmountInput({ value, onChange, balance, symbol, onMaxClick, maxDisabled = false, error }: AmountInputProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.14em] text-fg-2">Amount</div>
        <span className="text-xs text-fg-3">{symbol}</span>
      </div>
      <input
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent text-3xl tracking-tight text-fg-0 outline-none placeholder:text-fg-3"
        data-testid="send-amount"
        aria-invalid={Boolean(error)}
      />
      {error && (
        <p className="text-xs text-ui-danger" data-testid="send-amount-error">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onMaxClick}
          disabled={maxDisabled}
          className="text-xs text-brand-a hover:text-brand-b disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="send-max"
        >
          Max
        </button>
        <div className="text-xs text-fg-2">
          <span data-testid="send-available">{balance}</span> available
        </div>
      </div>
    </div>
  );
}
