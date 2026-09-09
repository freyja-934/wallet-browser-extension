import type { ReactNode, SVGProps } from 'react';

const paths: Record<string, ReactNode> = {
  lock: (
    <>
      <path d="M8 11V8a4 4 0 118 0v3" />
      <rect x="6" y="11" width="12" height="9" rx="2" />
    </>
  ),
  send: <path d="M5 12h14M13 6l6 6-6 6" />,
  receive: <path d="M12 4v12M6 12l6 6 6-6" />,
  copy: (
    <>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15V7a2 2 0 012-2h8" />
    </>
  ),
  check: <path d="M5 12l4 4 10-10" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  back: <path d="M15 6l-6 6 6 6" />,
  eye: (
    <>
      <path d="M2.5 12S6.5 6 12 6s9.5 6 9.5 6-4 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18M9.9 9.9A3 3 0 0012 15a3 3 0 002.1-.9M6.1 6.6C4 8.1 2.5 12 2.5 12S6.5 18 12 18c1.7 0 3.2-.5 4.5-1.2M14.1 6.3C13.4 6.1 12.7 6 12 6c-5.5 0-9.5 6-9.5 6" />
    </>
  ),
  refresh: <path d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.5 6.5M4 15a8 8 0 0013.5 2.5" />,
  warning: (
    <>
      <path d="M12 4l9 16H3L12 4z" />
      <path d="M12 10v4M12 16h.01" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  list: <path d="M7 7h13M7 12h13M7 17h13M4 7h.01M4 12h.01M4 17h.01" />,
  home: <path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-9z" />,
  nft: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 15l4-3 3 2 4-5 5 6" />
    </>
  ),
  activity: <path d="M4 14l4-4 3 3 5-6 4 4" />,
  chevron: <path d="M9 6l6 6-6 6" />,
};

export type IconName = keyof typeof paths;

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

export function Icon({ name, className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
