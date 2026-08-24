import { ComponentChildren } from 'preact';
import { ChevronRight } from 'lucide-react';

/** 10px accent label, 22px above and 4px below. */
export function SectionLabel({
  children,
  className = '',
}: {
  children: ComponentChildren;
  className?: string;
}) {
  return (
    <div className={`text-[10px] uppercase tracking-[0.16em] text-accent ${className}`}>
      {children}
    </div>
  );
}

/**
 * Three control types only: segmented, value + chevron, chevron alone.
 *
 * No toggles — a segmented control states both options, which reads better
 * than a switch whose off-state is ambiguous.
 */
export function SettingRow({
  label,
  children,
  onClick,
  value,
  chevron = false,
}: {
  label: string;
  /** A segmented control, for a two- or three-way choice. */
  children?: ComponentChildren;
  /** Present when the row navigates or opens a sheet. */
  onClick?: () => void;
  /** Shown before the chevron, e.g. a delivery time. */
  value?: string;
  chevron?: boolean;
}) {
  const body = (
    <>
      <span className="text-[16px]">{label}</span>
      {children ? (
        <span className="ml-auto">{children}</span>
      ) : (
        <span className="tabular ml-auto flex items-center gap-2 text-[16px] text-accent">
          {value}
          {chevron ? <ChevronRight size={15} strokeWidth={1.4} aria-hidden="true" /> : null}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[52px] w-full cursor-pointer items-center border-b border-ink/[0.16] text-left"
      >
        {body}
      </button>
    );
  }

  return <div className="flex min-h-[52px] items-center border-b border-ink/[0.16]">{body}</div>;
}

/** Two- or three-way choice. The active option is ringed, never filled. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-ink/[0.16]"
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`cursor-pointer px-3 py-[7px] text-[13px] transition-colors ${
              index > 0 ? 'border-l border-ink/[0.16]' : ''
            } ${
              active
                ? 'text-accent shadow-[inset_0_0_0_1px_var(--color-accent)]'
                : 'text-ink hover:bg-ink/[0.07]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** An outline tag — recent words, synonyms, search suggestions. */
export function Tag({ children, onClick }: { children: ComponentChildren; onClick?: () => void }) {
  const className =
    'inline-flex items-center rounded-[3px] border border-accent px-2.5 py-1 text-[11px] tracking-[0.02em] text-accent';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`cursor-pointer ${className}`}>
        {children}
      </button>
    );
  }
  return <span className={className}>{children}</span>;
}
