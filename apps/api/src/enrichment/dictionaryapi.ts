import type { WordCard, WordMeaning } from '@word-of-the-day/shared';
import type { EnrichmentProvider, EnrichmentResult } from './provider';

const BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const TIMEOUT_MS = 5000;

/**
 * Raw response structure from dictionaryapi.dev
 */
interface DictionaryApiPhonetic {
  text?: string;
  audio?: string;
  sourceUrl?: string;
}

interface DictionaryApiDefinition {
  definition: string;
  example?: string;
  synonyms?: string[];
  antonyms?: string[];
}

interface DictionaryApiMeaning {
  partOfSpeech: string;
  definitions: DictionaryApiDefinition[];
  synonyms?: string[];
  antonyms?: string[];
}

interface DictionaryApiEntry {
  word: string;
  phonetic?: string;
  phonetics?: DictionaryApiPhonetic[];
  meanings: DictionaryApiMeaning[];
  origin?: string;
  sourceUrls?: string[];
}

type DictionaryApiResponse = DictionaryApiEntry[];

const DOMAIN_OR_ARCHAIC_PATTERNS = [
  /\barchaic\b/i,
  /\bobsolete\b/i,
  /\bchiefly\b.*\blaw\b/i,
  /\b(in|of)\s+(heraldry|medicine|botany|zoology|sports?|football|cricket|nautical|phonetics)\b/i,
  /\bline of scrimmage\b/i,
  /\bto wind round;?\s*to entwine\b/i,
];

const GENERAL_PARTS_OF_SPEECH = ['adjective', 'noun', 'verb', 'adverb'];

function scoreDefinition(definition: DictionaryApiDefinition): number {
  let score = 0;
  const text = definition.definition.trim();

  if (definition.example) {
    score += 4;
  }

  if (text.length >= 20 && text.length <= 220) {
    score += 2;
  }

  if (DOMAIN_OR_ARCHAIC_PATTERNS.some((pattern) => pattern.test(text))) {
    score -= 10;
  }

  if (/^to\s+[a-z]/i.test(text)) {
    score += 1;
  }

  return score;
}

function scoreMeaning(meaning: DictionaryApiMeaning): number {
  const definitionScore = meaning.definitions[0] ? scoreDefinition(meaning.definitions[0]) : -10;
  const posBonus = GENERAL_PARTS_OF_SPEECH.includes(meaning.partOfSpeech.toLowerCase()) ? 2 : 0;
  return definitionScore + posBonus;
}

function prioritizeMeanings(meanings: DictionaryApiMeaning[]): DictionaryApiMeaning[] {
  return meanings
    .map((meaning, index) => ({
      meaning: {
        ...meaning,
        definitions: [...meaning.definitions].sort(
          (a, b) => scoreDefinition(b) - scoreDefinition(a)
        ),
      },
      index,
    }))
    .sort((a, b) => scoreMeaning(b.meaning) - scoreMeaning(a.meaning) || a.index - b.index)
    .map(({ meaning }) => meaning);
}

/**
 * Normalize DictionaryAPI response to WordCard format
 */
export function normalizeApiResponse(entries: DictionaryApiResponse): WordCard {
  const entry = entries[0];

  // Extract phonetics - prefer one with audio, fallback to text-only
  let phonetics: string | null = null;
  let audioUrl: string | null = null;

  if (entry.phonetics && entry.phonetics.length > 0) {
    const withAudio = entry.phonetics.find((p) => p.audio && p.audio.length > 0);
    if (withAudio) {
      phonetics = withAudio.text ?? null;
      audioUrl = withAudio.audio ?? null;
    } else {
      const withText = entry.phonetics.find((p) => p.text);
      phonetics = withText?.text ?? entry.phonetic ?? null;
    }
  } else if (entry.phonetic) {
    phonetics = entry.phonetic;
  }

  // Normalize meanings
  const meanings: WordMeaning[] = prioritizeMeanings(entry.meanings).map((m) => ({
    partOfSpeech: m.partOfSpeech,
    definitions: m.definitions.map((d) => d.definition),
    examples: m.definitions.filter((d) => d.example).map((d) => d.example as string),
    synonyms: [...(m.synonyms ?? []), ...m.definitions.flatMap((d) => d.synonyms ?? [])].filter(
      (v, i, arr) => arr.indexOf(v) === i
    ), // dedupe
    antonyms: [...(m.antonyms ?? []), ...m.definitions.flatMap((d) => d.antonyms ?? [])].filter(
      (v, i, arr) => arr.indexOf(v) === i
    ), // dedupe
  }));

  return {
    word: entry.word,
    phonetics,
    audioUrl,
    meanings,
    etymology: entry.origin ?? null,
    sourceUrl: entry.sourceUrls?.[0] ?? null,
  };
}

/**
 * DictionaryAPI.dev provider implementation
 */
export class DictionaryApiProvider implements EnrichmentProvider {
  name = 'dictionaryapi';

  async fetchDefinition(word: string): Promise<EnrichmentResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE_URL}/${encodeURIComponent(word)}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      clearTimeout(timeoutId);

      // 404 means word not found in dictionary
      if (response.status === 404) {
        return {
          success: false,
          notFound: true,
          error: 'Word not found in dictionary',
        };
      }

      // Any non-200 status is treated as a transient error
      if (!response.ok) {
        return {
          success: false,
          error: `API returned status ${response.status}`,
        };
      }

      const data = (await response.json()) as DictionaryApiResponse;

      if (!Array.isArray(data) || data.length === 0) {
        return {
          success: false,
          notFound: true,
          error: 'Empty response from dictionary API',
        };
      }

      const normalized = normalizeApiResponse(data);

      return {
        success: true,
        rawPayload: data,
        normalized,
      };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return {
            success: false,
            error: 'Request timed out',
          };
        }
        return {
          success: false,
          error: err.message,
        };
      }

      return {
        success: false,
        error: 'Unknown error occurred',
      };
    }
  }
}
