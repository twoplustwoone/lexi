import type { WordCard } from '@word-of-the-day/shared';

/**
 * Result from an enrichment provider
 */
export interface EnrichmentResult {
  success: boolean;
  notFound?: boolean;
  rawPayload?: unknown;
  normalized?: WordCard;
  error?: string;
}

/**
 * Interface for word enrichment providers
 */
export interface EnrichmentProvider {
  name: string;
  fetchDefinition(word: string): Promise<EnrichmentResult>;
}
