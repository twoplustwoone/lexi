import { ComponentChildren, JSX } from 'preact';

/**
 * The Classical building blocks the admin screens share.
 *
 * Two rules from the system drive nearly everything here:
 * colour is stroke — gold is a rule, a ring, an underline or a numeral, never
 * a fill behind small text — and muted text is ink mixed down rather than a
 * separate colour.
 */

/** Every hairline in the system: entry separators, row bottoms, table rules. */
export const DIVIDER = 'border-ink/[0.16]';

/** 10px accent kicker that opens a section or a figure. */
export function SectionLabel({
  children,
  tone = 'accent',
  className = '',
}: {
  children: ComponentChildren;
  tone?: 'accent' | 'warning' | 'muted';
  className?: string;
}) {
  const color =
    tone === 'warning'
      ? 'text-accent-strong'
      : tone === 'muted'
        ? 'text-ink/[0.52]'
        : 'text-accent';
  return (
    <div className={`text-[10px] uppercase tracking-[0.16em] ${color} ${className}`}>
      {children}
    </div>
  );
}

/**
 * A system enum — `ready`, `pending_review`, `not_found`. Set in monospace to
 * signal these are data values, not labels we chose. Warning states take
 * accent-strong; anything else stays muted.
 */
const WARNING_STATUSES = new Set(['failed', 'not_found', 'pending_review', 'rejected']);

export function StatusEnum({
  status,
  className = '',
}: {
  status: string | null;
  className?: string;
}) {
  if (!status) {
    return <span className={`font-mono text-[11px] text-ink/[0.4] ${className}`}>—</span>;
  }
  const tone = WARNING_STATUSES.has(status) ? 'text-accent-strong' : 'text-accent';
  return <span className={`font-mono text-[11px] ${tone} ${className}`}>{status}</span>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/**
 * Primary is an accent outline on transparent — never a filled block.
 * Secondary takes the divider outline, ghost is for dismissals.
 */
export function AdminButton({
  variant = 'secondary',
  className = '',
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  className?: string;
  children: ComponentChildren;
} & Omit<JSX.IntrinsicElements['button'], 'class' | 'className' | 'size'>) {
  const base =
    'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border font-display text-[14px] font-semibold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-45';
  const variants: Record<ButtonVariant, string> = {
    primary:
      'border-accent text-accent px-[16px] py-[9px] hover:bg-accent/[0.12] active:bg-accent/[0.22]',
    secondary:
      'border-ink/[0.16] text-ink px-[16px] py-[9px] hover:bg-ink/[0.07] active:bg-ink/[0.14]',
    ghost:
      'border-transparent text-accent px-[5px] py-[9px] hover:bg-accent/[0.1] active:bg-accent/[0.18]',
  };
  return (
    <button type="button" className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
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
      className={`inline-flex overflow-hidden rounded-md border ${DIVIDER}`}
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
              index > 0 ? `border-l ${DIVIDER}` : ''
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

/** Selected tags take an accent tint with accent-strong text; the rest outline. */
export function Tag({
  selected = false,
  onClick,
  children,
  className = '',
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ComponentChildren;
  className?: string;
}) {
  const tone = selected
    ? 'border-accent bg-accent/[0.18] text-accent-strong'
    : 'border-accent text-accent hover:bg-accent/[0.08]';
  const Element = onClick ? 'button' : 'span';
  return (
    <Element
      {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': selected } : {})}
      className={`inline-flex items-center rounded-[3px] border px-[10px] py-[3px] text-[11px] tracking-[0.02em] ${
        onClick ? 'cursor-pointer' : ''
      } ${tone} ${className}`}
    >
      {children}
    </Element>
  );
}

/** A bordered key cap for the review screen's keyboard hints. */
export function KeyCap({ children }: { children: ComponentChildren }) {
  return (
    <span
      className={`rounded-[3px] border ${DIVIDER} px-1.5 py-0.5 font-mono text-[11px] text-ink/[0.7]`}
    >
      {children}
    </span>
  );
}

/**
 * One Overview figure: a question, the answer as a sentence, and the chart
 * beneath as evidence. No figure is titled with a category alone.
 */
export function Figure({
  question,
  answer,
  support,
  actions,
  evidence,
  last = false,
  order = '',
}: {
  question: string;
  answer: ComponentChildren;
  support?: ComponentChildren;
  actions?: ComponentChildren;
  evidence: ComponentChildren;
  last?: boolean;
  /** Phone and desktop want these in a different order — see Overview. */
  order?: string;
}) {
  return (
    <section
      className={`grid gap-[22px] py-[26px] lg:grid-cols-[1fr_470px] lg:gap-[44px] ${order} ${
        last ? '' : `border-b ${DIVIDER}`
      }`}
    >
      <div>
        <SectionLabel className="mb-2">{question}</SectionLabel>
        <p className="m-0 mb-1.5 font-display text-[23px] font-normal leading-[1.25] text-pretty lg:text-[26px]">
          {answer}
        </p>
        {support ? (
          <p className="m-0 text-[14px] leading-[1.6] text-ink/[0.66]">{support}</p>
        ) : null}
        {actions ? <div className="mt-4 flex flex-wrap gap-2.5">{actions}</div> : null}
      </div>
      <div className="lg:pt-[20px]">{evidence}</div>
    </section>
  );
}

/** Caption under a chart — names the scale, or what the marks mean. */
export function Caption({
  children,
  className = '',
}: {
  children: ComponentChildren;
  className?: string;
}) {
  return <div className={`text-[12px] leading-[1.55] text-ink/[0.5] ${className}`}>{children}</div>;
}

/** Screen header: title, a figure or two of context, then trailing actions. */
export function ScreenHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ComponentChildren;
  actions?: ComponentChildren;
}) {
  return (
    <div
      className={`flex flex-none flex-wrap items-baseline gap-x-3.5 gap-y-2 border-b px-[22px] pb-4 pt-[22px] md:px-[34px] md:pt-[26px] ${DIVIDER}`}
    >
      <h2 className="m-0 font-display text-[27px] font-normal md:text-[30px]">{title}</h2>
      {meta ? <span className="tabular text-[13px] text-ink/[0.55]">{meta}</span> : null}
      {actions ? <div className="ml-auto flex items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

/** An underline, not a box — the hairline turns accent on focus. */
export function SearchField({
  value,
  onInput,
  placeholder,
  label,
  className = '',
}: {
  value: string;
  onInput: (next: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <label
      className={`flex flex-1 items-center gap-[9px] border-b ${DIVIDER} pb-2 text-ink/[0.5] focus-within:border-accent ${className}`}
    >
      <span className="sr-only">{label}</span>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        aria-hidden="true"
        className="flex-none"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onInput={(event) => onInput((event.target as HTMLInputElement).value)}
        className="w-full border-0 bg-transparent text-[14px] text-ink caret-accent outline-none placeholder:text-ink/[0.5]"
      />
    </label>
  );
}

/** Shown while a screen's first fetch is in flight. Structure, not a spinner. */
export function LoadingLine({ children = 'Loading.' }: { children?: ComponentChildren }) {
  return <p className="m-0 py-6 text-[15px] text-ink/[0.55]">{children}</p>;
}

/** A failed fetch renders inline, never in a bordered alert. */
export function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-6">
      <p className="m-0 text-[15px] text-accent-strong">{message}</p>
      {onRetry ? (
        <AdminButton variant="ghost" onClick={onRetry}>
          Try again
        </AdminButton>
      ) : null}
    </div>
  );
}
