import { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

/**
 * The only elevated surface in the app. Everything else sits on the ground,
 * divided by hairlines.
 *
 * `surface` ground, 7px top corners, ink-900 scrim at 42%, and a 38 × 3
 * grabber. Carries the delivery time, sign-in, and any future confirmation.
 */
export function Sheet({
  open,
  onClose,
  title,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  labelledBy?: string;
  children: ComponentChildren;
}) {
  // Escape closes, and the body locks while it is open.
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim tap dismisses, same as the secondary action. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-neutral-900/[0.42]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-lg border-t border-ink/[0.16] bg-surface px-7 pb-8 pt-6 shadow-lg"
      >
        <div className="mx-auto mb-5 h-[3px] w-[38px] rounded-[2px] bg-neutral-400" />
        {title ? <h3 className="m-0 mb-1 font-display text-[25px] font-normal">{title}</h3> : null}
        {children}
      </div>
    </div>
  );
}

/** A 48px radio row. Choices in a sheet are separated by hairlines. */
export function SheetRadioRow({
  label,
  qualifier,
  checked,
  onSelect,
  name,
}: {
  label: string;
  qualifier?: string;
  checked: boolean;
  onSelect: () => void;
  name: string;
}) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between border-t border-ink/[0.16] first:border-t-0">
      <span className="tabular text-[16px]">
        {label}
        {qualifier ? <span className="text-[13px] text-ink/[0.5]"> · {qualifier}</span> : null}
      </span>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {/* The checked dot's inner ring uses `surface`, not `bg` — it sits on a
          sheet. */}
      <span
        aria-hidden="true"
        className={`h-[18px] w-[18px] flex-none rounded-full border ${
          checked
            ? 'border-accent bg-accent shadow-[inset_0_0_0_4px_var(--color-surface)]'
            : 'border-ink/[0.3]'
        }`}
      />
    </label>
  );
}
