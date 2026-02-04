import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES } from '@word-of-the-day/shared';

import worker from '../src/index';
import { createTestEnv } from './helpers';

function nowIso() {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

function createExecutionContext(): ExecutionContext {
  return {
    props: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as ExecutionContext;
}

describe('settings routes', () => {
  it('returns audio_url in history entries when word details include it', async () => {
    const { env, cleanup } = await createTestEnv();
    const userId = crypto.randomUUID();
    const deliveredAt = nowIso();

    try {
      await env.DB.prepare(
        'INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(userId, deliveredAt, 1, 'UTC', JSON.stringify(DEFAULT_PREFERENCES))
        .run();

      await env.DB.prepare(
        'INSERT INTO word_pool (id, word, enabled, tier, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(999, 'resonance', 1, null, 'test', deliveredAt)
        .run();

      await env.DB.prepare(
        `INSERT INTO word_details (word_pool_id, status, normalized_json, fetched_at)
         VALUES (?, ?, ?, ?)`
      )
        .bind(
          999,
          'ready',
          JSON.stringify({
            word: 'resonance',
            phonetics: 'REZ-uh-nuhns',
            audioUrl: 'https://cdn.example.com/resonance.mp3',
            meanings: [
              {
                partOfSpeech: 'noun',
                definitions: ['The quality of being resonant.'],
                examples: ['The resonance of the hall improved the performance.'],
              },
            ],
            etymology: null,
          }),
          deliveredAt
        )
        .run();

      await env.DB.prepare(
        'INSERT INTO user_words (user_id, word_id, delivered_at, delivered_on) VALUES (?, ?, ?, ?)'
      )
        .bind(userId, 999, deliveredAt, '2024-01-01')
        .run();

      const response = await worker.fetch(
        new Request('http://localhost/api/history', {
          method: 'GET',
          headers: {
            'x-anon-id': userId,
          },
        }),
        env,
        createExecutionContext()
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        history: Array<{ word_id: number; audio_url: string | null }>;
      };
      expect(payload.history).toHaveLength(1);
      expect(payload.history[0].word_id).toBe(999);
      expect(payload.history[0].audio_url).toBe('https://cdn.example.com/resonance.mp3');
    } finally {
      await cleanup();
    }
  });
});
