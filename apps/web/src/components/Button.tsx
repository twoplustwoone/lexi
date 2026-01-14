import type { JSX } from 'preact';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg' | 'link';
type ButtonRadius = 'full' | 'xl' | 'none';

const baseClasses =
  'inline-flex cursor-pointer items-center justify-center font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  secondary: 'bg-accent/10 text-accent-strong hover:bg-accent/20',
  outline: 'border border-[rgba(30,27,22,0.12)] text-muted hover:text-ink',
  ghost: 'text-accent-strong hover:text-accent-strong/80',
  link: 'text-accent-strong hover:text-accent-strong/80',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-4 py-2 text-base',
  link: 'p-0 text-sm',
};

const radiusClasses: Record<ButtonRadius, string> = {
  full: 'rounded-full',
  xl: 'rounded-xl',
  none: '',
};

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  radius?: ButtonRadius;
};

export function Button({
  variant = 'primary',
  size = 'md',
  radius = 'xl',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    radiusClasses[radius],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...props} />;
}
