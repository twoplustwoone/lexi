import { useState } from 'preact/hooks';
import type { WordCard, WordDetailsStatus } from '@word-of-the-day/shared';

import { PronounceButton } from './PronounceButton';

/** Cap senses at three — matching what the app has always shown. */
const MAX_SENSES = 3;

export interface WordEntryData {
  word: string;
  detailsStatus: WordDetailsStatus;
  details: WordCard | null;
}

/** Flattens meanings into the numbered sense list the entry reads from. */
function senses(details: WordCard | null): Array<{ text: string; partOfSpeech: string }> {
  if (!details) return [];
  const flat: Array<{ text: string; partOfSpeech: string }> = [];
  for (const meaning of details.meanings) {
    for (const definition of meaning.definitions) {
      flat.push({ text: definition, partOfSpeech: meaning.partOfSpeech });
      if (flat.length >= MAX_SENSES) return flat;
    }
  }
  return flat;
}

function firstExample(details: WordCard | null): string | null {
  if (!details) return null;
  for (const meaning of details.meanings) {
    if (meaning.examples.length > 0) return meaning.examples[0];
  }
  return null;
}

/**
 * The full entry, in fixed order: word → pronunciation row → first sense →
 * further senses → example → etymology.
 *
 * The word is always shown, even while enrichment is still running or has
 * failed — it is the thing the reader came for, and it exists before its card
 * does. The pronounce button holds its position through a flex spacer so it
 * does not jump across the row when enrichment resolves.
 */
export function WordEntryFull({
  entry,
  size = 'full',
}: {
  entry: WordEntryData;
  /** Search results and the archive open at the same size as today's word. */
  size?: 'full';
}) {
  const [message, setMessage] = useState<string | null>(null);
  const list = senses(entry.details);
  const example = firstExample(entry.details);
  const partOfSpeech = list[0]?.partOfSpeech ?? null;
  const phonetics = entry.details?.phonetics ?? null;

  const pending = entry.detailsStatus === 'pending';
  const unavailable = entry.detailsStatus === 'failed' || entry.detailsStatus === 'not_found';

  return (
    <article>
      <h1
        className={`m-0 mt-4 font-display text-[58px] font-normal leading-none tracking-[-0.02em] ${
          size === 'full' ? '' : ''
        }`}
      >
        {entry.word}
      </h1>

      <div className="mt-3 flex items-center gap-3.5">
        {phonetics || partOfSpeech ? (
          <span className="text-[15px] italic text-ink/[0.6]">
            {phonetics}
            {phonetics && partOfSpeech ? ' · ' : ''}
            {partOfSpeech}
          </span>
        ) : null}
        <PronounceButton
          word={entry.word}
          audioUrl={entry.details?.audioUrl}
          onMessage={setMessage}
          className="ml-auto"
        />
      </div>

      {message ? <p className="m-0 mt-2 text-[13px] text-accent-strong">{message}</p> : null}

      {pending ? (
        <p className="m-0 mt-5 text-[16px] leading-[1.6] text-ink/[0.68]">
          Looking up the definition.
        </p>
      ) : unavailable ? (
        <p className="m-0 mt-5 text-[16px] italic leading-[1.6] text-ink/[0.68]">
          No definition came back for this one. Tomorrow&apos;s word is unaffected.
        </p>
      ) : (
        <>
          {list[0] ? (
            <p className="prose-justify m-0 mt-5 text-[17px] leading-[1.62] text-pretty">
              {list[0].text}
            </p>
          ) : null}

          {/* Later senses drop to 16px at ink 78%, numbered in accent. */}
          {list.slice(1).map((sense, index) => (
            <div key={`${sense.text}-${index}`} className="mt-3 flex gap-3">
              <span className="tabular flex-none font-display text-[15px] leading-[1.7] text-accent">
                {index + 2}
              </span>
              <p className="prose-justify m-0 text-[16px] leading-[1.6] text-ink/[0.78]">
                {sense.text}
              </p>
            </div>
          ))}

          {example ? (
            <p className="m-0 mt-4 border-l border-accent pl-4 text-[16px] italic leading-[1.55] text-ink/[0.72]">
              {example}
            </p>
          ) : null}

          {entry.details?.etymology ? (
            <p className="prose-justify m-0 mt-[18px] text-[14px] leading-[1.6] text-ink/[0.68]">
              {entry.details.etymology}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

/**
 * The archive unit: date kicker, the word at 34px, and the first sense
 * truncated to one sentence. Tapping expands it to the full entry in place —
 * the old accordion chrome and its duplicated definition both go away.
 */
export function WordEntryCompact({
  entry,
  kicker,
  last = false,
  dimmed = false,
}: {
  entry: WordEntryData;
  kicker: string;
  /** The last entry of a month group carries no hairline. */
  last?: boolean;
  /** The previous day peeking below today's entry — the scroll affordance. */
  dimmed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = senses(entry.details);
  const preview = list[0]?.text ?? null;

  if (expanded) {
    return (
      <div className={`py-5 ${last ? '' : 'border-b border-ink/[0.16]'}`}>
        <div className="tabular text-[10px] uppercase tracking-[0.18em] text-ink/[0.5]">
          {kicker}
        </div>
        <WordEntryFull entry={entry} />
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-4 min-h-[44px] cursor-pointer text-[13px] uppercase tracking-[0.12em] text-accent"
        >
          Collapse
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      aria-expanded={false}
      className={`block w-full cursor-pointer py-5 text-left ${
        last ? '' : 'border-b border-ink/[0.16]'
      } ${dimmed ? 'opacity-50' : ''}`}
    >
      <div className="tabular text-[10px] uppercase tracking-[0.18em] text-ink/[0.5]">{kicker}</div>
      <div className="mt-1.5 font-display text-[34px] leading-[1.05]">{entry.word}</div>
      {preview && !dimmed ? (
        <p className="m-0 mt-1.5 text-[15px] leading-[1.55] text-ink/[0.66]">{preview}</p>
      ) : null}
    </button>
  );
}
