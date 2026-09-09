import type { ReactNode } from 'react';

interface AssetRowProps {
  icon: ReactNode;
  name: string;
  subtitle: string;
  value: string;
  badge?: string;
  delta?: string;
  onClick?: () => void;
}

export function AssetRow({ icon, name, subtitle, value, badge, delta, onClick }: AssetRowProps) {
  const positive = delta ? parseFloat(delta) >= 0 : false;
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors duration-fast hover:bg-white/5"
    >
      <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-white/5">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] text-fg-0">{name}</div>
        <div className="text-xs text-fg-2">{subtitle}</div>
      </div>
      <div className="text-right">
        <div className="text-[15px] tabular text-fg-0">{value}</div>
        {delta && (
          <div className={`text-xs ${positive ? 'text-ui-success' : 'text-ui-danger'}`}>{delta}</div>
        )}
      </div>
      {badge && (
        <span className="ml-2 rounded-md border border-white/10 bg-white/5 px-1.5 py-px2 text-[11px] text-fg-2">
          {badge}
        </span>
      )}
    </button>
  );
}
