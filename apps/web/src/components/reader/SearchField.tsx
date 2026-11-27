import { Search } from 'lucide-react';
import { ComponentChildren } from 'preact';

/**
 * An underline, not a box — a hairline that turns accent on focus.
 */
export function SearchField({
  value,
  onInput,
  onCancel,
  autoFocus = false,
}: {
  value: string;
  onInput: (next: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="flex flex-1 items-center gap-2.5 border-b border-ink/[0.16] pb-2 focus-within:border-accent">
        <span className="sr-only">Search your words</span>
        <Search size={17} strokeWidth={1.4} aria-hidden="true" className="flex-none text-accent" />
        <input
          type="search"
          value={value}
          autoFocus={autoFocus}
          placeholder="Search your words"
          onInput={(event) => onInput((event.target as HTMLInputElement).value)}
          className="w-full border-0 bg-transparent text-[16px] text-ink caret-accent outline-none placeholder:text-ink/[0.45]"
        />
      </label>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-[44px] cursor-pointer items-center font-display text-[14px] text-accent"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}

/**
 * Underlines the matched substring in accent rather than highlighting it in a
 * block — matching the rule that colour is stroke. Matches inside a word, so
 * `quie` finds `acquiesce`.
 */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;

  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, index)}
      <span className="border-b border-accent">{text.slice(index, index + trimmed.length)}</span>
      {text.slice(index + trimmed.length)}
    </>
  );
}

/** Date in a 46px gutter, the word at 24px, one line of definition. */
export function ResultRow({
  kicker,
  word,
  definition,
  query,
  onClick,
}: {
  kicker: string;
  word: string;
  definition: string | null;
  query: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer gap-4 border-b border-ink/[0.16] py-[15px] text-left"
    >
      <span className="tabular w-[46px] flex-none text-[11px] uppercase leading-[1.9] tracking-[0.08em] text-ink/[0.45]">
        {kicker}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[24px] leading-[1.15]">
          <HighlightMatch text={word} query={query} />
        </span>
        {definition ? (
          <span className="mt-0.5 block text-[14px] leading-[1.5] text-ink/[0.62]">
            {definition}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Wraps the result list so the count kicker sits above its hairline. */
export function ResultCount({ children }: { children: ComponentChildren }) {
  return (
    <div className="tabular border-b border-ink/[0.16] pb-2.5 text-[10px] uppercase tracking-[0.16em] text-ink/[0.5]">
      {children}
    </div>
  );
}
