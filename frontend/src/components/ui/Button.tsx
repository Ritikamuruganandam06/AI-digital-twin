import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
};

export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'btn-sm' : '';
  return <button className={`btn ${VARIANT_CLASS[variant]} ${sizeClass} ${className}`.trim()} {...rest} />;
}
