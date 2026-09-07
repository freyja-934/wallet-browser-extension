import { Select } from '../ui/Input';

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  balance: string;
  symbol: string;
  onMaxClick: () => void;
  usdMode: boolean;
  onModeToggle: () => void;
}

export function AmountInput({ 
  value, 
  onChange, 
  balance, 
  symbol, 
  onMaxClick, 
  usdMode, 
  onModeToggle 
}: AmountInputProps) {
  return (
    <div className="rounded-xl bg-bg-1 border border-ui-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-fg-2">Amount</div>
        <div className="flex gap-1 rounded-md bg-bg-2 p-1">
          <button 
            onClick={() => onModeToggle()} 
            className={`px-2 h-7 rounded-sm text-xs transition-colors ${!usdMode ? 'bg-bg-1 text-fg-0' : 'hover:bg-bg-1 text-fg-2'}`}
          >
            {symbol}
          </button>
          <button 
            onClick={() => onModeToggle()} 
            className={`px-2 h-7 rounded-sm text-xs transition-colors ${usdMode ? 'bg-bg-1 text-fg-0' : 'hover:bg-bg-1 text-fg-2'}`}
          >
            USD
          </button>
        </div>
      </div>
      <div className="flex items-end gap-2">
        <input 
          inputMode="decimal" 
          placeholder="0.00" 
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-transparent outline-none text-3xl w-full text-fg-0 placeholder:text-fg-3" 
        />
        <div className="text-fg-2 text-sm whitespace-nowrap">{balance} available</div>
      </div>
      <div className="flex items-center justify-between">
        <button 
          onClick={onMaxClick}
          className="text-xs text-fg-1 underline underline-offset-4 hover:text-fg-0 transition-colors"
        >
          Max
        </button>
        <Select className="h-9 text-sm px-2" defaultValue="normal">
          <option value="normal">Normal fee</option>
          <option value="fast">Fast fee</option>
          <option value="turbo">Turbo fee</option>
        </Select>
      </div>
    </div>
  );
}
