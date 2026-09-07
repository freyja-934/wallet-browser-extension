import React from 'react';

export const LoadingScreen: React.FC = () => {
  return (
    <div className="popup-container bg-bg-0 flex items-center justify-center">
      <div className="text-center animate-fadeIn">
        <div className="relative w-16 h-16 mx-auto">
          <div className="absolute inset-0 rounded-full grad-solana animate-spin opacity-20"></div>
          <div className="absolute inset-2 bg-bg-0 rounded-full"></div>
          <div className="absolute inset-0 rounded-full grad-solana animate-ping"></div>
        </div>
        <p className="mt-6 text-fg-1 text-sm font-medium">Loading wallet...</p>
      </div>
    </div>
  );
};