import type { WordCard } from '@word-of-the-day/shared';
import { describe, expect, it } from 'vitest';

import { evaluateWordCardQuality, isAutoApproveEnabled } from '../src/words/quality';

function makeCard(definitions: string[]): WordCard {
  return {
    word: 'recondite',
    phonetics: 'REK-un-dyte',
    audioUrl: null,
    meanings: [
      {
        partOfSpeech: 'adjective',
        definitions,
        examples: [],
        synonyms: [],
        antonyms: [],
      },
    ],
    etymology: null,
  };
}

describe('evaluateWordCardQuality', () => {
  it('auto-approves a card with a substantive definition', () => {
    const verdict = evaluateWordCardQuality(makeCard(['Hidden from sight or difficult to grasp.']));
    expect(verdict.autoApprove).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it('flags a missing payload', () => {
    const verdict = evaluateWordCardQuality(null);
    expect(verdict.autoApprove).toBe(false);
    expect(verdict.reason).toContain('No normalized definition payload');
  });

  it('flags a card with no meanings', () => {
    const card = makeCard(['anything']);
    card.meanings = [];
    const verdict = evaluateWordCardQuality(card);
    expect(verdict.autoApprove).toBe(false);
    expect(verdict.reason).toContain('no meanings');
  });

  it('flags a card whose definitions are all empty', () => {
    const verdict = evaluateWordCardQuality(makeCard(['', '   ']));
    expect(verdict.autoApprove).toBe(false);
    expect(verdict.reason).toContain('no non-empty definitions');
  });

  it('flags definitions that only cross-reference another word form', () => {
    const verdict = evaluateWordCardQuality(makeCard(['past tense of abrogate']));
    expect(verdict.autoApprove).toBe(false);
    expect(verdict.reason).toContain('cross-reference');
  });

  it('flags plural and variant stubs', () => {
    expect(evaluateWordCardQuality(makeCard(['plural of axis'])).autoApprove).toBe(false);
    expect(evaluateWordCardQuality(makeCard(['variant of colour'])).autoApprove).toBe(false);
    expect(evaluateWordCardQuality(makeCard(['see also entropy'])).autoApprove).toBe(false);
  });

  it('flags definitions that are too short to be useful', () => {
    const verdict = evaluateWordCardQuality(makeCard(['a bird']));
    expect(verdict.autoApprove).toBe(false);
    expect(verdict.reason).toContain('characters');
  });

  it('approves when at least one definition is substantive', () => {
    const verdict = evaluateWordCardQuality(
      makeCard(['plural of thing', 'A matter under consideration or discussion.'])
    );
    expect(verdict.autoApprove).toBe(true);
  });
});

describe('isAutoApproveEnabled', () => {
  it('defaults to enabled when unset', () => {
    expect(isAutoApproveEnabled(undefined)).toBe(true);
  });

  it('is disabled only by an explicit false', () => {
    expect(isAutoApproveEnabled('false')).toBe(false);
    expect(isAutoApproveEnabled('FALSE')).toBe(false);
    expect(isAutoApproveEnabled('true')).toBe(true);
    expect(isAutoApproveEnabled('')).toBe(true);
  });
});
