import { useState } from 'preact/hooks';

import { Button } from '../Button';
import { Sheet, SheetRadioRow } from './Sheet';
import { useSchedule } from '../../useSchedule';

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
  userId = null,
}: {
  open: boolean;
  onClose: () => void;
  userId?: string | null;
}) {
  const schedule = useSchedule(userId);
  const [choice, setChoice] = useState<string>(schedule.deliveryTime);
  const [custom, setCustom] = useState(schedule.deliveryTime);

  const isPreset = PRESETS.some((preset) => preset.time === choice);
  const chosenTime = isPreset ? choice : custom;

  const handleConfirm = async () => {
    await schedule.setDeliveryTime(chosenTime);
    // Turning it on is the point of this sheet; the time alone does nothing
    // if notifications are off.
    if (!schedule.enabled) {
      await schedule.setEnabled(true);
    }
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
