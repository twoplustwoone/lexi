-- Remove legacy pronunciation customization keys from preferences_json.
-- Voice customization is no longer supported; Lexi uses Samantha (en-US) only.
UPDATE users
SET preferences_json = json_remove(preferences_json, '$.pronunciation')
WHERE json_valid(preferences_json) = 1
  AND json_type(preferences_json, '$.pronunciation') IS NOT NULL;
