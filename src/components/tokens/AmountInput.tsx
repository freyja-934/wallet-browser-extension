interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  balance: string;
  symbol: string;
  onMaxClick: () => void;
}

export function AmountInput({ value, onChange, balance, symbol, onMaxClick }: AmountInputProps) {
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
      />
      <div className="flex items-center justify-between">
        <button type="button" onClick={onMaxClick} className="text-xs text-brand-a hover:text-brand-b">
          Max
        </button>
        <div className="text-xs text-fg-2">{balance} available</div>
      </div>
    </div>
  );
}
