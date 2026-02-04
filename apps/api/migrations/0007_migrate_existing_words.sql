-- Migrate existing words from 'words' table to 'word_pool' and 'word_details'
-- These words are already enriched, so we set status='ready'

-- Insert words into word_pool
INSERT INTO word_pool (id, word, enabled, tier, source, created_at)
SELECT id, word, 1, 1, 'seed', created_at
FROM words;

-- Insert enrichment details (already have full data from seed)
INSERT INTO word_details (word_pool_id, status, provider, normalized_json, fetched_at)
SELECT
  w.id,
  'ready',
  'seed',
  json_object(
    'word', w.word,
    'phonetics', w.pronunciation,
    'audioUrl', NULL,
    'meanings', json_array(
      json_object(
        'partOfSpeech', 'noun',
        'definitions', json_array(w.definition),
        'examples', json(w.examples_json),
        'synonyms', json_array(),
        'antonyms', json_array()
      )
    ),
    'etymology', w.etymology,
    'sourceUrl', NULL
  ),
  w.created_at
FROM words w;
