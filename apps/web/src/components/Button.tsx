import type { JSX } from 'preact';

/**
 * The component keeps its shape; the variants changed.
 *
 * Primary is an accent outline on transparent — never a filled block. Colour
 * is stroke in this system, and a solid gold slab would be the loudest thing
 * on any screen it appeared on. Secondary takes the divider outline, ghost is
 * for dismissals.
 */
type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const baseClasses =
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border font-display font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-accent text-accent hover:bg-accent/[0.12] active:bg-accent/[0.22]',
  secondary: 'border-ink/[0.16] text-ink hover:bg-ink/[0.07] active:bg-ink/[0.14]',
  ghost: 'border-transparent text-accent hover:bg-accent/[0.1] active:bg-accent/[0.18]',
};

/** 46px on mobile, 44px minimum everywhere. */
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-[38px] px-3 text-[13px]',
  md: 'min-h-[44px] px-4 text-[14px]',
  lg: 'min-h-[46px] px-4 text-[14px]',
};

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full-width, for the day-one invitation and the sync upsell. */
  block?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    block ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...props} />;
}
