import { useEffect, useState } from 'preact/hooks';

import { Button } from '../Button';
import { Sheet, SheetRadioRow } from './Sheet';
import type { ScheduleController } from '../../useSchedule';

/**
 * Presets rather than a time wheel — faster on a phone, and "Another time"
 * covers the rest. The schedule only accepts 30-minute increments, which the
 * presets all satisfy.
 */
const PRESETS = [
  { time: '07:00', qualifier: 'with coffee' },
  { time: '09:00', qualifier: 'default' },
  { time: '13:00', qualifier: 'at lunch' },
  { time: '21:00', qualifier: 'before bed' },
];

export function DeliveryTimeSheet({
  open,
  onClose,
  schedule,
}: {
  open: boolean;
  onClose: () => void;
  /** Owned by the screen, so the sheet and the rows it sits over agree. */
  schedule: ScheduleController;
}) {
  const [choice, setChoice] = useState<string>(schedule.deliveryTime);
  const [custom, setCustom] = useState(schedule.deliveryTime);

  // Settings arrive after the first paint, so a draft seeded once at mount
  // would sit on the 09:00 fallback and quietly overwrite a real schedule on
  // confirm. Re-seed whenever the sheet opens or the saved time changes.
  useEffect(() => {
    if (!open) return;
    setChoice(schedule.deliveryTime);
    setCustom(schedule.deliveryTime);
  }, [open, schedule.deliveryTime]);

  const isPreset = PRESETS.some((preset) => preset.time === choice);
  const chosenTime = isPreset ? choice : custom;

  const handleConfirm = async () => {
    // One write. Saving the time and then enabling separately meant the second
    // call re-sent the delivery time this render had captured — the old one.
    await schedule.save({ deliveryTime: chosenTime, enabled: true });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Your daily word">
      <p className="m-0 mb-[18px] text-[14px] leading-[1.55] text-ink/[0.65]">
        Arrives once a day in your local time. Change it whenever — it applies from tomorrow.
      </p>

      <div>
        {PRESETS.map((preset) => (
          <SheetRadioRow
            key={preset.time}
            name="delivery-time"
            label={preset.time}
            qualifier={preset.qualifier}
            checked={choice === preset.time}
            onSelect={() => setChoice(preset.time)}
          />
        ))}
        <SheetRadioRow
          name="delivery-time"
          label="Another time"
          checked={!isPreset}
          onSelect={() => setChoice(custom)}
        />
      </div>

      {!isPreset ? (
        <label className="mt-3 flex items-center justify-between border-b border-ink/[0.16] pb-2">
          <span className="text-[14px] text-ink/[0.65]">Time</span>
          <input
            type="time"
            step={1800}
            value={custom}
            onInput={(event) => {
              const next = (event.target as HTMLInputElement).value;
              setCustom(next);
              setChoice(next);
            }}
            className="tabular border-0 bg-transparent text-right text-[16px] text-ink outline-none"
          />
        </label>
      ) : null}

      {schedule.message ? (
        <p className="m-0 mt-3 text-[14px] text-accent-strong">{schedule.message}</p>
      ) : null}

      {/* A pair at the foot: secondary dismiss, primary confirm, equal width. */}
      <div className="mt-5 flex gap-2.5">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
          Not now
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          disabled={schedule.busy}
          onClick={handleConfirm}
        >
          {schedule.busy ? 'Saving…' : 'Turn on'}
        </Button>
      </div>
    </Sheet>
  );
}
