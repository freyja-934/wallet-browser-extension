import React from 'react';

export function TextField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full h-11 rounded-lg bg-bg-2 border border-ui-border px-3 text-[15px] placeholder:text-fg-3
                  focus:outline-none focus:shadow-focus transition duration-fast
                  disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`w-full rounded-lg bg-bg-2 border border-ui-border px-3 py-2 text-[15px] placeholder:text-fg-3
                  focus:outline-none focus:shadow-focus transition duration-fast
                  disabled:opacity-50 disabled:cursor-not-allowed resize-none ${className}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      {...rest}
      className={`w-full h-11 rounded-lg bg-bg-2 border border-ui-border px-3 text-[15px]
                  focus:outline-none focus:shadow-focus transition duration-fast
                  disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}
