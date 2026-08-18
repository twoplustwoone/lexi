import type { WordCard } from '@word-of-the-day/shared';

/**
 * Minimum length for a definition to be considered a usable word-of-the-day entry.
 * Shorter definitions are almost always stubs like "a bird" or "to go".
 */
const MIN_DEFINITION_LENGTH = 12;

/**
 * Definitions that only point at another word make poor daily words: the reader
 * learns "abrogated" is the past tense of "abrogate" and nothing else.
 */
const CROSS_REFERENCE_PATTERN =
  /^(past tense|past participle|present participle|present tense|plural|singular|comparative|superlative|third[-\s]person|variant|variants?\s+of|alternative (spelling|form)s? of|archaic (spelling|form) of|abbreviation|acronym|initialism|see\b|chiefly\b)/i;

export interface QualityVerdict {
  /** True when the card is good enough to serve without a human looking at it. */
  autoApprove: boolean;
  /** Human-readable reason the card was held back, or null when approved. */
  reason: string | null;
}

function isCrossReference(definition: string): boolean {
  return CROSS_REFERENCE_PATTERN.test(definition.trim());
}

function usableDefinitions(card: WordCard): string[] {
  return card.meanings
    .flatMap((meaning) => meaning.definitions)
    .map((definition) => definition.trim())
    .filter((definition) => definition.length > 0);
}

/**
 * Decide whether an enriched word card can be served without manual review.
 *
 * The review queue exists to keep bad dictionary payloads off the home screen,
 * not to make a human retype what the provider already got right. Anything that
 * fails these checks stays in the queue with a reason attached.
 */
export function evaluateWordCardQuality(card: WordCard | null): QualityVerdict {
  if (!card) {
    return { autoApprove: false, reason: 'No normalized definition payload' };
  }

  if (card.meanings.length === 0) {
    return { autoApprove: false, reason: 'Provider returned no meanings' };
  }

  const definitions = usableDefinitions(card);
  if (definitions.length === 0) {
    return { autoApprove: false, reason: 'Provider returned no non-empty definitions' };
  }

  const substantive = definitions.filter(
    (definition) => !isCrossReference(definition) && definition.length >= MIN_DEFINITION_LENGTH
  );

  if (substantive.length === 0) {
    const allCrossReferences = definitions.every(isCrossReference);
    return {
      autoApprove: false,
      reason: allCrossReferences
        ? 'Definitions only cross-reference another word form'
        : `No definition reached ${MIN_DEFINITION_LENGTH} characters`,
    };
  }

  return { autoApprove: true, reason: null };
}

/**
 * Auto-approval is on by default: the whole point is that the pool grows without
 * anyone clicking. Set ENRICHMENT_AUTO_APPROVE="false" to force every enriched
 * word through the manual queue instead.
 */
export function isAutoApproveEnabled(flag: string | undefined): boolean {
  return (flag ?? 'true').toLowerCase() !== 'false';
}
