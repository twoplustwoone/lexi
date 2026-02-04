import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  calculateBackoffMinutes,
  EnrichmentService,
} from '../src/enrichment/service';
import {
  normalizeApiResponse,
  DictionaryApiProvider,
} from '../src/enrichment/dictionaryapi';
import { createTestEnv } from './helpers';
import type { Env } from '../src/env';

describe('calculateBackoffMinutes', () => {
  it('returns 5 minutes for first retry', () => {
    expect(calculateBackoffMinutes(1)).toBe(5);
  });

  it('returns 15 minutes for second retry', () => {
    expect(calculateBackoffMinutes(2)).toBe(15);
  });

  it('returns 45 minutes for third retry', () => {
    expect(calculateBackoffMinutes(3)).toBe(45);
  });

  it('returns 135 minutes for fourth retry', () => {
    expect(calculateBackoffMinutes(4)).toBe(135);
  });

  it('caps at 1440 minutes (24 hours)', () => {
    expect(calculateBackoffMinutes(10)).toBe(1440);
    expect(calculateBackoffMinutes(20)).toBe(1440);
  });

  it('handles zero and negative values', () => {
    expect(calculateBackoffMinutes(0)).toBe(5);
    expect(calculateBackoffMinutes(-1)).toBe(5);
  });
});

describe('normalizeApiResponse', () => {
  it('normalizes a basic DictionaryAPI response', () => {
    const response = [
      {
        word: 'serendipity',
        phonetic: '/ˌsɛɹ.ənˈdɪp.ɪ.ti/',
        phonetics: [
          { text: '/ˌsɛɹ.ənˈdɪp.ɪ.ti/', audio: 'https://example.com/audio.mp3' },
        ],
        meanings: [
          {
            partOfSpeech: 'noun',
            definitions: [
              {
                definition: 'An unsought, unintended, or unexpected but fortunate discovery.',
                example: 'It was pure serendipity that we met.',
              },
            ],
            synonyms: ['luck', 'fortune'],
            antonyms: [],
          },
        ],
        origin: 'Coined by Horace Walpole.',
        sourceUrls: ['https://en.wiktionary.org/wiki/serendipity'],
      },
    ];

    const result = normalizeApiResponse(response);

    expect(result.word).toBe('serendipity');
    expect(result.phonetics).toBe('/ˌsɛɹ.ənˈdɪp.ɪ.ti/');
    expect(result.audioUrl).toBe('https://example.com/audio.mp3');
    expect(result.etymology).toBe('Coined by Horace Walpole.');
    expect(result.sourceUrl).toBe('https://en.wiktionary.org/wiki/serendipity');
    expect(result.meanings).toHaveLength(1);
    expect(result.meanings[0].partOfSpeech).toBe('noun');
    expect(result.meanings[0].definitions).toContain(
      'An unsought, unintended, or unexpected but fortunate discovery.'
    );
    expect(result.meanings[0].examples).toContain('It was pure serendipity that we met.');
    expect(result.meanings[0].synonyms).toContain('luck');
  });

  it('handles missing optional fields', () => {
    const response = [
      {
        word: 'test',
        meanings: [
          {
            partOfSpeech: 'verb',
            definitions: [{ definition: 'To examine.' }],
          },
        ],
      },
    ];

    const result = normalizeApiResponse(response);

    expect(result.word).toBe('test');
    expect(result.phonetics).toBeNull();
    expect(result.audioUrl).toBeNull();
    expect(result.etymology).toBeNull();
    expect(result.meanings[0].examples).toEqual([]);
    expect(result.meanings[0].synonyms).toEqual([]);
  });

  it('prefers phonetics with audio over text-only', () => {
    const response = [
      {
        word: 'hello',
        phonetic: '/həˈloʊ/',
        phonetics: [
          { text: '/həˈləʊ/' }, // no audio
          { text: '/həˈloʊ/', audio: 'https://example.com/hello.mp3' },
        ],
        meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A greeting.' }] }],
      },
    ];

    const result = normalizeApiResponse(response);

    expect(result.phonetics).toBe('/həˈloʊ/');
    expect(result.audioUrl).toBe('https://example.com/hello.mp3');
  });

  it('deduplicates synonyms and antonyms', () => {
    const response = [
      {
        word: 'happy',
        meanings: [
          {
            partOfSpeech: 'adjective',
            definitions: [
              { definition: 'Experiencing pleasure.', synonyms: ['glad', 'joyful'] },
              { definition: 'Content.', synonyms: ['glad', 'content'] },
            ],
            synonyms: ['joyful', 'pleased'],
            antonyms: ['sad'],
          },
        ],
      },
    ];

    const result = normalizeApiResponse(response);

    // Should dedupe: joyful, pleased, glad, content
    expect(result.meanings[0].synonyms).toContain('glad');
    expect(result.meanings[0].synonyms).toContain('joyful');
    expect(result.meanings[0].synonyms).toContain('content');
    expect(result.meanings[0].synonyms).toContain('pleased');
    // No duplicates
    const synonyms = result.meanings[0].synonyms || [];
    expect(new Set(synonyms).size).toBe(synonyms.length);
  });
});

describe('DictionaryApiProvider', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns success with normalized data on valid response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          word: 'test',
          meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A trial.' }] }],
        },
      ],
    });

    const provider = new DictionaryApiProvider();
    const result = await provider.fetchDefinition('test');

    expect(result.success).toBe(true);
    expect(result.normalized?.word).toBe('test');
    expect(result.rawPayload).toBeDefined();
  });

  it('returns notFound on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const provider = new DictionaryApiProvider();
    const result = await provider.fetchDefinition('xyznotaword');

    expect(result.success).toBe(false);
    expect(result.notFound).toBe(true);
  });

  it('returns error on server error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const provider = new DictionaryApiProvider();
    const result = await provider.fetchDefinition('test');

    expect(result.success).toBe(false);
    expect(result.notFound).toBeUndefined();
    expect(result.error).toContain('500');
  });

  it('returns error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const provider = new DictionaryApiProvider();
    const result = await provider.fetchDefinition('test');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

describe('EnrichmentService', () => {
  let env: Env;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestEnv();
    env = testEnv.env;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('creates pending word_details entry', async () => {
    // Insert a word into pool with a unique ID that won't conflict with seeded data
    const uniqueId = 99999;
    await env.DB.prepare(
      "INSERT INTO word_pool (id, word, enabled, source, created_at) VALUES (?, 'testunique', 1, 'test', ?)"
    )
      .bind(uniqueId, new Date().toISOString())
      .run();

    const service = new EnrichmentService();
    await service.ensureWordDetails(env, uniqueId);

    const details = await service.getWordDetails(env, uniqueId);
    expect(details).not.toBeNull();
    expect(details?.status).toBe('pending');
  });

  it('parses normalized JSON correctly', () => {
    const service = new EnrichmentService();

    const details = {
      word_pool_id: 1,
      status: 'ready' as const,
      provider: 'test',
      payload_json: null,
      normalized_json: JSON.stringify({
        word: 'test',
        phonetics: '/test/',
        audioUrl: null,
        meanings: [],
        etymology: null,
      }),
      fetched_at: new Date().toISOString(),
      next_retry_at: null,
      retry_count: 0,
      error: null,
    };

    const parsed = service.parseNormalizedJson(details);
    expect(parsed?.word).toBe('test');
    expect(parsed?.phonetics).toBe('/test/');
  });

  it('returns null for invalid JSON', () => {
    const service = new EnrichmentService();

    const details = {
      word_pool_id: 1,
      status: 'ready' as const,
      provider: 'test',
      payload_json: null,
      normalized_json: 'not valid json',
      fetched_at: new Date().toISOString(),
      next_retry_at: null,
      retry_count: 0,
      error: null,
    };

    const parsed = service.parseNormalizedJson(details);
    expect(parsed).toBeNull();
  });

  it('returns null for null details', () => {
    const service = new EnrichmentService();
    const parsed = service.parseNormalizedJson(null);
    expect(parsed).toBeNull();
  });
});
