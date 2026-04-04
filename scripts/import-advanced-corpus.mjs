#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BATCH_SIZE = 500;
const DEFAULT_CORPUS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'advanced-vocabulary.txt'
);
const SOURCE = 'curated-advanced-v1';

function usage() {
  console.log(`
Usage: node scripts/import-advanced-corpus.mjs [wordlist.txt] [options]

Options:
  --local   Import to local D1 database (default)
  --remote  Import to remote D1 database
  --dry-run Show what would be imported without executing

Examples:
  node scripts/import-advanced-corpus.mjs --local
  node scripts/import-advanced-corpus.mjs ./my-gre-list.txt --remote
`);
  process.exit(1);
}

function filterWords(words) {
  const deduped = new Set();
  for (const word of words) {
    const cleaned = word.toLowerCase().trim();
    if (/^[a-z]{4,16}$/.test(cleaned)) {
      deduped.add(cleaned);
    }
  }
  return [...deduped].sort();
}

function buildWordInsertSql(words, now) {
  return words
    .map((word) => {
      const escaped = word.replace(/'/g, "''");
      return `('${escaped}', 1, 95, 'advanced', '${SOURCE}', '${now}')`;
    })
    .join(',\n  ');
}

function resolveApiDir() {
  const cwdApiDir = path.join(process.cwd(), 'apps', 'api');
  if (fs.existsSync(cwdApiDir)) {
    return cwdApiDir;
  }

  const scriptApiDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'apps',
    'api'
  );
  if (fs.existsSync(scriptApiDir)) {
    return scriptApiDir;
  }

  throw new Error('Could not find apps/api directory');
}

async function main() {
  const args = process.argv.slice(2);
  let filePath = DEFAULT_CORPUS;
  let isRemote = false;
  let isDryRun = false;

  for (const arg of args) {
    if (arg === '--local') {
      isRemote = false;
    } else if (arg === '--remote') {
      isRemote = true;
    } else if (arg === '--dry-run') {
      isDryRun = true;
    } else if (arg.startsWith('--')) {
      usage();
    } else {
      filePath = path.resolve(process.cwd(), arg);
    }
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Word list not found: ${filePath}`);
  }

  const rawWords = fs.readFileSync(filePath, 'utf8').split('\n');
  const words = filterWords(rawWords);
  console.log(`Corpus file: ${filePath}`);
  console.log(`Filtered words: ${words.length}`);

  if (words.length === 0 || isDryRun) {
    console.log(words.slice(0, 20).join('\n'));
    return;
  }

  const envFlag = isRemote ? '--remote' : '--local';
  const apiDir = resolveApiDir();
  const now = new Date().toISOString();

  process.chdir(apiDir);

  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE);
    const tempFile = `/tmp/advanced-corpus-${Date.now()}-${i}.sql`;
    const sql = `INSERT OR IGNORE INTO word_pool
  (word, enabled, tier, difficulty_category, source, created_at)
VALUES
  ${buildWordInsertSql(batch, now)};

INSERT OR IGNORE INTO word_details (word_pool_id, status)
SELECT id, 'pending'
FROM word_pool
WHERE source = '${SOURCE}' AND created_at = '${now}';`;

    fs.writeFileSync(tempFile, sql);
    execSync(`npx wrangler d1 execute word_of_the_day ${envFlag} --file="${tempFile}"`, {
      stdio: 'inherit',
    });
    fs.unlinkSync(tempFile);
    console.log(
      `Imported batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(words.length / BATCH_SIZE)}`
    );
  }

  console.log(`Imported ${words.length} advanced words from ${SOURCE}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
