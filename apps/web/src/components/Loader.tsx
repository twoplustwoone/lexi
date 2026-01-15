interface LoaderProps {
  label?: string;
  className?: string;
  tone?: 'muted' | 'light';
}

export function Loader({ label = 'Loading...', className, tone = 'muted' }: LoaderProps) {
  const wrapperClasses = [
    'inline-flex items-center gap-3 text-sm',
    tone === 'light' ? 'text-white' : 'text-muted',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const spinnerClasses = [
    'h-4 w-4 animate-spin rounded-full border-2 motion-reduce:animate-none',
    tone === 'light' ? 'border-white/40 border-t-white' : 'border-[rgba(30,27,22,0.18)] border-t-accent',
  ].join(' ');

  return (
    <span className={wrapperClasses}>
      <span className={spinnerClasses} />
      <span>{label}</span>
    </span>
  );
}
