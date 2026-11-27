import type { WordCard } from '@word-of-the-day/shared';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { EnrichmentService } from '../src/enrichment/service';
import type { EnrichmentProvider, EnrichmentResult } from '../src/enrichment/provider';
import type { Env } from '../src/env';
import {
  autoApproveReviewQueue,
  bulkApproveWordReviews,
  bulkRejectWordReviews,
} from '../src/words/review';
import { getAvailableWordCount, getCurrentCycle, selectWordForDate } from '../src/words/selection';
import { createTestEnv } from './helpers';

function nowIso(): string {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

function card(word: string, definition: string): WordCard {
  return {
    word,
    phonetics: null,
    audioUrl: null,
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [definition],
        examples: [],
        synonyms: [],
        antonyms: [],
      },
    ],
    etymology: null,
  };
}

class StubProvider implements EnrichmentProvider {
  name = 'stub-provider';

  constructor(private readonly result: EnrichmentResult) {}

  async fetchDefinition(): Promise<EnrichmentResult> {
    return this.result;
  }
}

async function insertPoolWord(env: Env, id: number, word: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO word_pool (id, word, enabled, tier, difficulty_category, source, created_at)
     VALUES (?, ?, 1, 50, 'balanced', 'test', ?)`
  )
    .bind(id, word, nowIso())
    .run();
}

async function insertPendingReviewWord(
  env: Env,
  id: number,
  word: string,
  definition: string
): Promise<void> {
  await insertPoolWord(env, id, word);
  await env.DB.prepare(
    `INSERT INTO word_details
       (word_pool_id, status, review_status, provider, normalized_json, fetched_at)
     VALUES (?, 'ready', 'pending_review', 'stub-provider', ?, ?)`
  )
    .bind(id, JSON.stringify(card(word, definition)), nowIso())
    .run();
}

async function getReviewStatus(env: Env, id: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT review_status FROM word_details WHERE word_pool_id = ?')
    .bind(id)
    .first();
  return (row as { review_status: string } | null)?.review_status ?? null;
}

describe('enrichment auto-approval', () => {
  it('makes a freshly enriched word servable without any manual approval', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      // Clear the grandfathered seed pool so only our word can be selected.
      await env.DB.prepare('UPDATE word_pool SET enabled = 0').run();
      await insertPoolWord(env, 70001, 'perspicacious');

      const service = new EnrichmentService(
        new StubProvider({
          success: true,
          rawPayload: { stub: true },
          normalized: card('perspicacious', 'Having keen insight or discernment.'),
        })
      );

      const enriched = await service.enrichWord(env, 70001);
      expect(enriched).toBe(true);
      expect(await getReviewStatus(env, 70001)).toBe('approved');

      // The real proof: the selection query will now serve it.
      const cycle = await getCurrentCycle(env);
      expect(await getAvailableWordCount(env, cycle)).toBe(1);
      const selected = await selectWordForDate(env, '2026-08-18', cycle);
      expect(selected?.wordPoolId).toBe(70001);
    } finally {
      await cleanup();
    }
  });

  it('holds a low-quality enrichment back for manual review', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      await insertPoolWord(env, 70002, 'abrogated');

      const service = new EnrichmentService(
        new StubProvider({
          success: true,
          rawPayload: { stub: true },
          normalized: card('abrogated', 'past tense of abrogate'),
        })
      );

      await service.enrichWord(env, 70002);
      expect(await getReviewStatus(env, 70002)).toBe('pending_review');

      const row = await env.DB.prepare(
        'SELECT review_note FROM word_details WHERE word_pool_id = ?'
      )
        .bind(70002)
        .first();
      expect((row as { review_note: string }).review_note).toContain('cross-reference');
    } finally {
      await cleanup();
    }
  });

  it('respects ENRICHMENT_AUTO_APPROVE=false', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      await insertPoolWord(env, 70003, 'ineffable');

      const service = new EnrichmentService(
        new StubProvider({
          success: true,
          rawPayload: { stub: true },
          normalized: card('ineffable', 'Too great to be expressed in words.'),
        })
      );

      await service.enrichWord({ ...env, ENRICHMENT_AUTO_APPROVE: 'false' }, 70003);
      expect(await getReviewStatus(env, 70003)).toBe('pending_review');
    } finally {
      await cleanup();
    }
  });
});

describe('autoApproveReviewQueue', () => {
  it('drains a backlog of good words and flags the bad ones', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      await insertPendingReviewWord(env, 71001, 'lambent', 'Glowing with soft radiance.');
      await insertPendingReviewWord(env, 71002, 'obdurate', 'Stubbornly refusing to change.');
      await insertPendingReviewWord(env, 71003, 'mice', 'plural of mouse');

      const result = await autoApproveReviewQueue(env);

      expect(result.scanned).toBe(3);
      expect(result.approved).toBe(2);
      expect(result.flagged).toBe(1);

      expect(await getReviewStatus(env, 71001)).toBe('approved');
      expect(await getReviewStatus(env, 71002)).toBe('approved');
      expect(await getReviewStatus(env, 71003)).toBe('pending_review');
    } finally {
      await cleanup();
    }
  });

  it('records why a flagged word was held back', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      await insertPendingReviewWord(env, 71004, 'oxen', 'plural of ox');
      await autoApproveReviewQueue(env);

      const row = await env.DB.prepare(
        'SELECT review_note FROM word_details WHERE word_pool_id = ?'
      )
        .bind(71004)
        .first();
      expect((row as { review_note: string }).review_note).toContain('cross-reference');
    } finally {
      await cleanup();
    }
  });

  it('honours the batch limit', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      await insertPendingReviewWord(env, 71005, 'susurrus', 'A whispering or rustling sound.');
      await insertPendingReviewWord(env, 71006, 'petrichor', 'The smell of rain on dry earth.');

      const result = await autoApproveReviewQueue(env, 1);
      expect(result.scanned).toBe(1);
      expect(result.approved).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('leaves already-approved words untouched', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      const before = await autoApproveReviewQueue(env);
      expect(before.scanned).toBe(0);
    } finally {
      await cleanup();
    }
  });
});

describe('bulk review', () => {
  it('approves many words in one call', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      await insertPendingReviewWord(env, 72001, 'halcyon', 'Denoting a period of idyllic calm.');
      await insertPendingReviewWord(env, 72002, 'quiescent', 'In a state of inactivity.');

      const result = await bulkApproveWordReviews(env, [72001, 72002], 'admin-1', 'Looks good');

      expect(result.requested).toBe(2);
      expect(result.updated).toBe(2);
      expect(await getReviewStatus(env, 72001)).toBe('approved');
      expect(await getReviewStatus(env, 72002)).toBe('approved');
    } finally {
      await cleanup();
    }
  });

  it('rejects many words and disables each one', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      await insertPendingReviewWord(env, 72003, 'slur', 'An offensive term.');
      await insertPendingReviewWord(env, 72004, 'nonce', 'An unsuitable term.');

      await bulkRejectWordReviews(env, [72003, 72004], 'admin-1', 'Not appropriate');

      expect(await getReviewStatus(env, 72003)).toBe('rejected');
      expect(await getReviewStatus(env, 72004)).toBe('rejected');

      const enabled = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM word_pool WHERE id IN (72003, 72004) AND enabled = 1'
      ).first();
      expect(Number((enabled as { count: number }).count)).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('is a no-op for an empty id list', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      const result = await bulkApproveWordReviews(env, [], 'admin-1');
      expect(result).toEqual({ updated: 0, requested: 0 });
    } finally {
      await cleanup();
    }
  });
});
