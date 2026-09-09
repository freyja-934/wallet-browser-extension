import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <section className={`glass-panel rounded-xl shadow-card ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({ children, className = '' }: CardProps) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 border-b border-white/8 ${className}`}>
      {children}
    </div>
  );
}

export function CardContent({ children, className = '' }: CardProps) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
