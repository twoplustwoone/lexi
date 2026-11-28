-- The starter words in 0002 were seeded with tier 1 as an ordering, not a difficulty,
-- so 0010's tier backfill labelled every one of them easy.
UPDATE word_pool
SET difficulty_category = 'advanced'
WHERE source = 'seed'
  AND word IN (
    'ephemeral', 'taciturn', 'verdant', 'mellifluous', 'quintessential',
    'equanimity', 'catharsis', 'ardent', 'sonder'
  );

UPDATE word_pool
SET difficulty_category = 'balanced'
WHERE source = 'seed'
  AND word IN (
    'serendipity', 'luminous', 'resilience', 'candor', 'nostalgia', 'lucid',
    'innate', 'eloquent', 'solace', 'ambivalent', 'tenacious'
  );
