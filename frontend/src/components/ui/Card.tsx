import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card card--padded ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

/** A responsive auto-fit grid of cards -- used for summary metrics and topology node layouts that don't need SVG positioning. */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="card-grid">{children}</div>;
}
