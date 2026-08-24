import { useState } from 'preact/hooks';
import { Volume2 } from 'lucide-react';

import { canUseSpeechSynthesis, playPronunciation } from '../../pronunciation';

/**
 * 44 × 44, a 1px accent ring, an 18px glyph. The old control was a bare 16px
 * icon — far under a touch target.
 *
 * When neither audio nor speech synthesis is available it renders disabled
 * with the reason in the title rather than disappearing, so the row does not
 * reflow between words.
 */
export function PronounceButton({
  word,
  audioUrl,
  onMessage,
  className = '',
}: {
  word: string;
  audioUrl?: string | null;
  /** Surfaced as a line under the row rather than an alert. */
  onMessage?: (message: string | null) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const available = Boolean(audioUrl) || canUseSpeechSynthesis();

  const handlePlay = async () => {
    if (!available || busy) return;
    setBusy(true);
    onMessage?.(null);
    try {
      const result = await playPronunciation({ text: word, audioUrl });
      if (result.status === 'unsupported') {
        onMessage?.('This device has no voice available for pronunciation.');
      } else if (result.status === 'error') {
        onMessage?.(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handlePlay}
      disabled={!available}
      aria-label={`Play pronunciation of ${word}`}
      title={available ? `Play ${word}` : 'No recording or device voice is available for this word'}
      className={`flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full border border-accent text-accent transition-colors active:bg-accent/[0.22] disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
    >
      <Volume2 size={18} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
