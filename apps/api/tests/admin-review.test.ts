import { DEFAULT_PREFERENCES } from '@word-of-the-day/shared';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { createSession } from '../src/auth/sessions';
import type { Env } from '../src/env';
import worker from '../src/index';
import { createTestEnv } from './helpers';

function createExecutionContext(): ExecutionContext {
  return {
    props: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as ExecutionContext;
}

function nowIso(): string {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

async function seedAdminSession(env: Env): Promise<string> {
  const adminId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users
       (id, created_at, is_anonymous, is_admin, timezone, preferences_json)
     VALUES (?, ?, 0, 1, 'UTC', ?)`
  )
    .bind(adminId, nowIso(), JSON.stringify(DEFAULT_PREFERENCES))
    .run();

  const session = await createSession(env, adminId);
  return `session=${session.token}`;
}

async function seedReviewWord(env: Env): Promise<void> {
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO word_pool
       (id, word, enabled, tier, difficulty_category, source, created_at)
     VALUES (33001, 'recondite', 1, 95, 'advanced', 'curated-advanced-v1', ?)`
  )
    .bind(createdAt)
    .run();

  await env.DB.prepare(
    `INSERT INTO word_details
       (word_pool_id, status, review_status, provider, payload_json, normalized_json, fetched_at)
     VALUES (?, 'ready', 'pending_review', ?, ?, ?, ?)`
  )
    .bind(
      33001,
      'merriam-webster-collegiate',
      JSON.stringify([{ meta: { id: 'recondite' }, shortdef: ['hard to understand'] }]),
      JSON.stringify({
        word: 'recondite',
        phonetics: 'REK-un-dyte',
        audioUrl: null,
        meanings: [
          {
            partOfSpeech: 'adjective',
            definitions: ['Hidden from sight.'],
            examples: [],
            synonyms: [],
            antonyms: [],
          },
        ],
        etymology: null,
        sourceUrl: 'https://www.merriam-webster.com/dictionary/recondite',
      }),
      createdAt
    )
    .run();
}

describe('admin word review routes', () => {
  it('lists pending review words with normalized and raw payloads', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      const cookie = await seedAdminSession(env);
      await seedReviewWord(env);

      const response = await worker.fetch(
        new Request('http://localhost/api/admin/word-pool/review?reviewStatus=pending_review', {
          headers: { cookie },
        }),
        env,
        createExecutionContext()
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        words: Array<{
          id: number;
          word: string;
          reviewStatus: string;
          details: { word: string } | null;
          rawPayload: unknown;
        }>;
      };

      expect(payload.words).toHaveLength(1);
      expect(payload.words[0].id).toBe(33001);
      expect(payload.words[0].word).toBe('recondite');
      expect(payload.words[0].reviewStatus).toBe('pending_review');
      expect(payload.words[0].details?.word).toBe('recondite');
      expect(payload.words[0].rawPayload).toEqual([
        { meta: { id: 'recondite' }, shortdef: ['hard to understand'] },
      ]);
    } finally {
      await cleanup();
    }
  });

  it('approves a reviewed word with edited normalized details', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      const cookie = await seedAdminSession(env);
      await seedReviewWord(env);

      const response = await worker.fetch(
        new Request('http://localhost/api/admin/word/33001/approve', {
          method: 'POST',
          headers: {
            cookie,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            reviewNote: 'Edited definition for clarity',
            details: {
              word: 'recondite',
              phonetics: 'REK-un-dyte',
              audioUrl: null,
              meanings: [
                {
                  partOfSpeech: 'adjective',
                  definitions: ['Little known and difficult to understand.'],
                  examples: ['The manuscript contained several recondite references.'],
                  synonyms: [],
                  antonyms: [],
                },
              ],
              etymology: null,
              sourceUrl: 'https://www.merriam-webster.com/dictionary/recondite',
            },
          }),
        }),
        env,
        createExecutionContext()
      );

      expect(response.status).toBe(200);

      const details = (await env.DB.prepare(
        `SELECT review_status, review_note, reviewed_by, normalized_json
         FROM word_details
         WHERE word_pool_id = 33001`
      ).first()) as {
        review_status: string;
        review_note: string | null;
        reviewed_by: string | null;
        normalized_json: string;
      } | null;

      expect(details?.review_status).toBe('approved');
      expect(details?.review_note).toBe('Edited definition for clarity');
      expect(details?.reviewed_by).toBeTruthy();
      const normalized = JSON.parse(details?.normalized_json ?? '{}') as {
        meanings?: Array<{ definitions?: string[] }>;
      };
      expect(normalized.meanings?.[0]?.definitions?.[0]).toBe(
        'Little known and difficult to understand.'
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects a word, records the review note, and disables the word', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      const cookie = await seedAdminSession(env);
      await seedReviewWord(env);

      const response = await worker.fetch(
        new Request('http://localhost/api/admin/word/33001/reject', {
          method: 'POST',
          headers: {
            cookie,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            reviewNote: 'Definition is too obscure and unsuitable.',
          }),
        }),
        env,
        createExecutionContext()
      );

      expect(response.status).toBe(200);

      const row = (await env.DB.prepare(
        `SELECT wp.enabled, wd.review_status, wd.review_note
         FROM word_pool wp
         JOIN word_details wd ON wp.id = wd.word_pool_id
         WHERE wp.id = 33001`
      ).first()) as {
        enabled: number;
        review_status: string;
        review_note: string | null;
      } | null;

      expect(row?.enabled).toBe(0);
      expect(row?.review_status).toBe('rejected');
      expect(row?.review_note).toBe('Definition is too obscure and unsuitable.');
    } finally {
      await cleanup();
    }
  });

  it('requeues a word for enrichment retry and resets review metadata', async () => {
    const { env, cleanup } = await createTestEnv();

    try {
      const cookie = await seedAdminSession(env);
      await seedReviewWord(env);
      await env.DB.prepare(
        `UPDATE word_details
         SET review_status = 'rejected',
             reviewed_by = 'old-admin',
             reviewed_at = ?,
             review_note = 'Needs another pass',
             status = 'failed',
             error = 'Temporary failure'
         WHERE word_pool_id = 33001`
      )
        .bind(nowIso())
        .run();

      const response = await worker.fetch(
        new Request('http://localhost/api/admin/word/33001/retry', {
          method: 'POST',
          headers: { cookie },
        }),
        env,
        createExecutionContext()
      );

      expect(response.status).toBe(200);

      const row = (await env.DB.prepare(
        `SELECT status, review_status, reviewed_at, reviewed_by, review_note, error
         FROM word_details
         WHERE word_pool_id = 33001`
      ).first()) as {
        status: string;
        review_status: string;
        reviewed_at: string | null;
        reviewed_by: string | null;
        review_note: string | null;
        error: string | null;
      } | null;

      expect(row?.status).toBe('pending');
      expect(row?.review_status).toBe('pending_review');
      expect(row?.reviewed_at).toBeNull();
      expect(row?.reviewed_by).toBeNull();
      expect(row?.review_note).toBeNull();
      expect(row?.error).toBeNull();
    } finally {
      await cleanup();
    }
  });
});
