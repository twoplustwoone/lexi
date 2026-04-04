import type { WordCard, WordMeaning } from '@word-of-the-day/shared';
import type { EnrichmentProvider, EnrichmentResult } from './provider';

const BASE_URL = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json';
const AUDIO_BASE_URL = 'https://media.merriam-webster.com/audio/prons/en/us/mp3';
const TIMEOUT_MS = 5000;

interface MerriamWebsterPronunciation {
  mw?: string;
  sound?: {
    audio?: string;
  };
}

interface MerriamWebsterHeadword {
  prs?: MerriamWebsterPronunciation[];
}

interface MerriamWebsterDefinitionSense {
  dt?: Array<[string, unknown]>;
}

interface MerriamWebsterVerbalIllustration {
  t?: string;
}

type MerriamWebsterSenseSequence = Array<
  Array<[string, MerriamWebsterDefinitionSense | { sense?: MerriamWebsterDefinitionSense }]>
>;

interface MerriamWebsterEntry {
  meta?: {
    id?: string;
  };
  hwi?: MerriamWebsterHeadword;
  fl?: string;
  shortdef?: string[];
  def?: Array<{
    sseq?: MerriamWebsterSenseSequence;
  }>;
  et?: Array<[string, string]>;
}

type MerriamWebsterResponse = Array<MerriamWebsterEntry | string>;

function isEntry(value: MerriamWebsterEntry | string): value is MerriamWebsterEntry {
  return typeof value !== 'string' && typeof value === 'object' && value !== null;
}

function buildAudioUrl(audio: string): string {
  const subdirectory = audio.startsWith('bix')
    ? 'bix'
    : audio.startsWith('gg')
      ? 'gg'
      : /^[0-9_,!]/.test(audio)
        ? 'number'
        : audio[0];
  return `${AUDIO_BASE_URL}/${subdirectory}/${audio}.mp3`;
}

function cleanDefinitionText(text: string): string {
  return text
    .replace(/\{bc\}/g, ': ')
    .replace(/\{sx\|([^|}]+)\|[^}]*\}/g, '$1')
    .replace(/\{d_link\|([^|}]+)\|[^}]*\}/g, '$1')
    .replace(/\{et_link\|([^|}]+)\|[^}]*\}/g, '$1')
    .replace(/\{a_link\|([^|}]+)\}/g, '$1')
    .replace(/\{wi\}([^{}]+)\{\/wi\}/g, '$1')
    .replace(/\{it\}([^{}]+)\{\/it\}/g, '$1')
    .replace(/\{sc\}([^{}]+)\{\/sc\}/g, '$1')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/:\s*:\s*/g, ' : ')
    .replace(/\s+/g, ' ')
    .replace(/^:\s*/, '')
    .trim();
}

function getSensePayload(
  payload: MerriamWebsterDefinitionSense | { sense?: MerriamWebsterDefinitionSense }
): MerriamWebsterDefinitionSense | undefined {
  const wrapped = payload as { sense?: MerriamWebsterDefinitionSense };
  return wrapped.sense ?? (payload as MerriamWebsterDefinitionSense);
}

function extractMeaningDataFromSseq(sseq?: MerriamWebsterSenseSequence): {
  definitions: string[];
  examples: string[];
} {
  const definitions: string[] = [];
  const examples: string[] = [];

  for (const sequence of sseq ?? []) {
    for (const [, payload] of sequence) {
      const sense = getSensePayload(payload);
      for (const [type, value] of sense?.dt ?? []) {
        if (type === 'text' && typeof value === 'string') {
          const cleaned = cleanDefinitionText(value);
          if (cleaned) {
            definitions.push(cleaned);
          }
        }
        if (type === 'vis' && Array.isArray(value)) {
          for (const item of value as MerriamWebsterVerbalIllustration[]) {
            if (typeof item?.t !== 'string') {
              continue;
            }
            const cleanedExample = cleanDefinitionText(item.t);
            if (cleanedExample) {
              examples.push(cleanedExample);
            }
          }
        }
      }
    }
  }

  return {
    definitions: Array.from(new Set(definitions)),
    examples: Array.from(new Set(examples)),
  };
}

function normalizeEntry(entry: MerriamWebsterEntry, requestedWord: string): WordCard | null {
  const meaningData = extractMeaningDataFromSseq(entry.def?.[0]?.sseq);
  const normalizedDefinitions = meaningData.definitions.length
    ? meaningData.definitions
    : (entry.shortdef ?? []).map(cleanDefinitionText).filter(Boolean);
  if (!normalizedDefinitions.length) {
    return null;
  }

  const pronunciation = entry.hwi?.prs?.find((item) => item.mw)?.mw ?? null;
  const audio = entry.hwi?.prs?.find((item) => item.sound?.audio)?.sound?.audio ?? null;
  const sourceWord = entry.meta?.id?.split(':')[0] || requestedWord;
  const etymology = entry.et?.find(([type, value]) => type === 'text' && value)?.[1] ?? null;

  const meanings: WordMeaning[] = [
    {
      partOfSpeech: entry.fl ?? 'unknown',
      definitions: normalizedDefinitions,
      examples: meaningData.examples.slice(0, 5),
      synonyms: [],
      antonyms: [],
    },
  ];

  if (!meanings[0].definitions.length) {
    return null;
  }

  return {
    word: sourceWord,
    phonetics: pronunciation,
    audioUrl: audio ? buildAudioUrl(audio) : null,
    meanings,
    etymology: etymology ? cleanDefinitionText(etymology) : null,
    sourceUrl: `https://www.merriam-webster.com/dictionary/${encodeURIComponent(requestedWord)}`,
  };
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export class MerriamWebsterProvider implements EnrichmentProvider {
  name = 'merriam-webster-collegiate';

  constructor(
    private readonly apiKey: string,
    private readonly fallbackProvider?: EnrichmentProvider
  ) {}

  async fetchDefinition(word: string): Promise<EnrichmentResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(
        `${BASE_URL}/${encodeURIComponent(word)}?key=${encodeURIComponent(this.apiKey)}`,
        {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (this.fallbackProvider && isTransientStatus(response.status)) {
          const fallback = await this.fallbackProvider.fetchDefinition(word);
          if (fallback.success || fallback.notFound) {
            return {
              ...fallback,
              rawPayload: {
                merriamWebsterErrorStatus: response.status,
                fallback: fallback.rawPayload,
              },
            };
          }
        }
        return {
          success: false,
          error: `Merriam-Webster API returned status ${response.status}`,
        };
      }

      const data = (await response.json()) as MerriamWebsterResponse;
      const entry = data.find(isEntry);
      const normalized = entry ? normalizeEntry(entry, word) : null;
      if (normalized) {
        return {
          success: true,
          rawPayload: data,
          normalized,
        };
      }

      if (this.fallbackProvider) {
        const fallback = await this.fallbackProvider.fetchDefinition(word);
        if (fallback.success || fallback.notFound) {
          return {
            ...fallback,
            rawPayload: { merriamWebster: data, fallback: fallback.rawPayload },
          };
        }
      }

      return {
        success: false,
        notFound: true,
        rawPayload: data,
        error: 'Word not found in Merriam-Webster Collegiate Dictionary',
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (this.fallbackProvider) {
        const fallback = await this.fallbackProvider.fetchDefinition(word);
        if (fallback.success || fallback.notFound) {
          return {
            ...fallback,
            rawPayload: {
              merriamWebsterError: error instanceof Error ? error.message : String(error),
              fallback: fallback.rawPayload,
            },
          };
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown Merriam-Webster error',
      };
    }
  }
}
