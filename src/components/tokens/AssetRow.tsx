import React from 'react';

interface AssetRowProps {
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  value: string;
  badge?: string;
  delta?: string;
  onClick?: () => void;
}

export function AssetRow({ icon, name, subtitle, value, badge, delta, onClick }: AssetRowProps) {
  return (
    <button 
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-bg-2 border border-transparent hover:border-ui-border transition-all duration-fast"
    >
      <div className="h-9 w-9 rounded-full grid place-items-center bg-bg-2 overflow-hidden">
        {icon}
      </div>
      <div className="flex-1 text-left">
        <div className="text-[15px] text-fg-0">{name}</div>
        <div className="text-xs text-fg-2">{subtitle}</div>
      </div>
      <div className="text-right">
        <div className="text-[15px] text-fg-0">{value}</div>
        {delta && (
          <div className={`text-xs ${parseFloat(delta) >= 0 ? 'text-ui-success' : 'text-ui-danger'}`}>
            {delta}
          </div>
        )}
      </div>
      {badge && (
        <span className="ml-2 text-[11px] px-1.5 py-px2 rounded-md bg-bg-2 text-fg-2 border border-ui-border">
          {badge}
        </span>
      )}
    </button>
  );
}
