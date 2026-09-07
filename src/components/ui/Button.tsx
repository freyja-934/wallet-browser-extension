import React from 'react';

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`h-11 w-full rounded-lg text-[15px] font-medium shadow-press transition duration-base
                  hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus:shadow-focus
                  grad-solana text-black disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`h-11 w-full rounded-lg text-[15px] font-medium border border-ui-border
                  bg-transparent hover:bg-bg-2 transition duration-base
                  focus:outline-none focus:shadow-focus text-fg-0
                  disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}

export function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`p-2 rounded-md hover:bg-bg-2 transition-colors duration-fast
                  focus:outline-none focus:shadow-focus ${className}`}
    />
  );
}
