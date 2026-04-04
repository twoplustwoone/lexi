import { z } from 'zod';
import {
  wordDifficultySchema,
  wordReviewStatusSchema,
  wordSelectionFallbackReasonSchema,
} from './schemas';

/**
 * Normalized word details format for display
 */
export const wordMeaningSchema = z.object({
  partOfSpeech: z.string(),
  definitions: z.array(z.string()),
  examples: z.array(z.string()),
  synonyms: z.array(z.string()).optional(),
  antonyms: z.array(z.string()).optional(),
});

export const wordCardSchema = z.object({
  word: z.string(),
  phonetics: z.string().nullable(),
  audioUrl: z.string().url().nullable(),
  meanings: z.array(wordMeaningSchema),
  etymology: z.string().nullable(),
  sourceUrl: z.string().url().nullable().optional(),
});

export type WordMeaning = z.infer<typeof wordMeaningSchema>;
export type WordCard = z.infer<typeof wordCardSchema>;

/**
 * Status of word enrichment
 */
export const wordDetailsStatusSchema = z.enum(['pending', 'ready', 'failed', 'not_found']);
export type WordDetailsStatus = z.infer<typeof wordDetailsStatusSchema>;

/**
 * Response from /api/word/today endpoint
 */
export const dailyWordResponseSchema = z.object({
  day: z.string(), // YYYY-MM-DD
  word: z.string(),
  wordPoolId: z.number(),
  detailsStatus: wordDetailsStatusSchema,
  details: wordCardSchema.nullable(),
  selection: z
    .object({
      requestedDifficulty: wordDifficultySchema.nullable(),
      effectiveDifficulty: wordDifficultySchema.nullable(),
      usedFallback: z.boolean(),
      fallbackReason: wordSelectionFallbackReasonSchema.nullable(),
    })
    .optional(),
});

export type DailyWordResponse = z.infer<typeof dailyWordResponseSchema>;

/**
 * Response from /api/word/:id endpoint
 */
export const wordResponseSchema = z.object({
  word: z.string(),
  wordPoolId: z.number(),
  enabled: z.boolean(),
  detailsStatus: wordDetailsStatusSchema,
  details: wordCardSchema.nullable(),
});

export type WordResponse = z.infer<typeof wordResponseSchema>;

/**
 * Word pool entry for admin endpoints
 */
export const wordPoolEntrySchema = z.object({
  id: z.number(),
  word: z.string(),
  enabled: z.boolean(),
  tier: z.number().nullable(),
  difficultyCategory: wordDifficultySchema,
  source: z.string(),
  createdAt: z.string(),
  detailsStatus: wordDetailsStatusSchema.nullable(),
  reviewStatus: wordReviewStatusSchema.nullable(),
  reviewedAt: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewNote: z.string().nullable(),
});

export type WordPoolEntry = z.infer<typeof wordPoolEntrySchema>;

/**
 * Enrichment stats for admin dashboard
 */
export const enrichmentStatsSchema = z.object({
  total: z.number(),
  pending: z.number(),
  ready: z.number(),
  failed: z.number(),
  notFound: z.number(),
  enabledWords: z.number(),
  disabledWords: z.number(),
  currentCycle: z.number(),
  wordsUsedThisCycle: z.number(),
});

export type EnrichmentStats = z.infer<typeof enrichmentStatsSchema>;

export const wordPoolHealthSchema = z.object({
  minimumAdvancedReadyWords: z.number(),
  advancedHealthy: z.boolean(),
  byDifficulty: z.record(
    wordDifficultySchema,
    z.object({
      total: z.number(),
      enabled: z.number(),
      ready: z.number(),
      pending: z.number(),
      failed: z.number(),
      notFound: z.number(),
    })
  ),
  bySource: z.array(
    z.object({
      source: z.string(),
      difficultyCategory: wordDifficultySchema,
      total: z.number(),
      ready: z.number(),
    })
  ),
  upcomingPreview: z.record(
    wordDifficultySchema,
    z.array(
      z.object({
        id: z.number(),
        word: z.string(),
        tier: z.number().nullable(),
        source: z.string(),
        detailsStatus: wordDetailsStatusSchema.nullable(),
      })
    )
  ),
});

export type WordPoolHealth = z.infer<typeof wordPoolHealthSchema>;
