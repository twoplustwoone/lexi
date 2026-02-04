#!/usr/bin/env node

/**
 * SCOWL Word Import Script
 *
 * This script imports words from a SCOWL wordlist file into the word_pool table.
 *
 * Usage:
 *   node scripts/import-scowl.mjs <wordlist.txt> [--local|--remote]
 *
 * Options:
 *   --local   Import to local D1 database (default)
 *   --remote  Import to remote D1 database
 *
 * The script:
 *   1. Reads words from the file
 *   2. Filters to lowercase, alphabetic-only, 4-12 character words
 *   3. Deduplicates
 *   4. Imports in batches of 500 via wrangler d1 execute
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BATCH_SIZE = 500;
const MIN_LENGTH = 4;
const MAX_LENGTH = 12;

function usage() {
  console.log(`
Usage: node scripts/import-scowl.mjs <wordlist.txt> [options]

Options:
  --local   Import to local D1 database (default)
  --remote  Import to remote D1 database
  --dry-run Show what would be imported without executing

Example:
  node scripts/import-scowl.mjs scowl-2020.1/american-words.50 --local
`);
  process.exit(1);
}

function filterWords(words) {
  const filtered = [];
  const seen = new Set();

  for (const word of words) {
    const cleaned = word.toLowerCase().trim();

    // Skip if not purely alphabetic
    if (!/^[a-z]+$/.test(cleaned)) continue;

    // Skip if wrong length
    if (cleaned.length < MIN_LENGTH || cleaned.length > MAX_LENGTH) continue;

    // Skip duplicates
    if (seen.has(cleaned)) continue;

    seen.add(cleaned);
    filtered.push(cleaned);
  }

  return filtered;
}

function createInsertStatements(words, source) {
  const batches = [];
  const now = new Date().toISOString();

  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE);
    const values = batch
      .map((w) => `('${w.replace(/'/g, "''")}', 1, '${source}', '${now}')`)
      .join(',\n  ');

    const sql = `INSERT OR IGNORE INTO word_pool (word, enabled, source, created_at) VALUES
  ${values};`;

    batches.push(sql);
  }

  return batches;
}

function createDetailsStatements(source) {
  const now = new Date().toISOString();
  // Create pending word_details for newly imported words
  return `INSERT OR IGNORE INTO word_details (word_pool_id, status)
SELECT id, 'pending' FROM word_pool WHERE source = '${source}' AND created_at >= '${now.slice(0, 19)}';`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    usage();
  }

  let filePath = null;
  let isRemote = false;
  let isDryRun = false;

  for (const arg of args) {
    if (arg === '--local') {
      isRemote = false;
    } else if (arg === '--remote') {
      isRemote = true;
    } else if (arg === '--dry-run') {
      isDryRun = true;
    } else if (!arg.startsWith('--')) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error('Error: No wordlist file specified');
    usage();
  }

  // Resolve path relative to cwd
  const resolvedPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`Reading words from: ${resolvedPath}`);
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  console.log(`Total lines in file: ${lines.length}`);

  const filtered = filterWords(lines);
  console.log(`Words after filtering (${MIN_LENGTH}-${MAX_LENGTH} chars, alphabetic): ${filtered.length}`);

  if (filtered.length === 0) {
    console.log('No words to import after filtering.');
    process.exit(0);
  }

  const source = path.basename(filePath, path.extname(filePath)).slice(0, 50);
  const batches = createInsertStatements(filtered, source);

  console.log(`Created ${batches.length} batch(es) of up to ${BATCH_SIZE} words each`);
  console.log(`Source tag: ${source}`);

  if (isDryRun) {
    console.log('\n--- DRY RUN ---');
    console.log(`Would import ${filtered.length} words in ${batches.length} batches`);
    console.log('\nFirst 10 words:');
    filtered.slice(0, 10).forEach((w) => console.log(`  ${w}`));
    if (filtered.length > 10) {
      console.log('  ...');
    }
    process.exit(0);
  }

  const envFlag = isRemote ? '--remote' : '--local';
  console.log(`\nImporting to ${isRemote ? 'REMOTE' : 'LOCAL'} database...`);

  // Change to the api directory for wrangler commands
  const apiDir = path.join(process.cwd(), 'apps', 'api');

  if (!fs.existsSync(apiDir)) {
    // Try from root of monorepo
    const rootApiDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'apps', 'api');
    if (fs.existsSync(rootApiDir)) {
      process.chdir(rootApiDir);
    } else {
      console.error('Error: Could not find apps/api directory');
      process.exit(1);
    }
  } else {
    process.chdir(apiDir);
  }

  let totalInserted = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    const batchWordCount = Math.min(BATCH_SIZE, filtered.length - i * BATCH_SIZE);

    console.log(`  Batch ${batchNum}/${batches.length} (${batchWordCount} words)...`);

    try {
      // Write batch to temp file to avoid command line length limits
      const tempFile = `/tmp/scowl-batch-${Date.now()}.sql`;
      fs.writeFileSync(tempFile, batch);

      execSync(`npx wrangler d1 execute word_of_the_day ${envFlag} --file="${tempFile}"`, {
        stdio: 'inherit',
      });

      fs.unlinkSync(tempFile);
      totalInserted += batchWordCount;
    } catch (error) {
      console.error(`Error in batch ${batchNum}:`, error.message);
      // Continue with next batch
    }
  }

  // Create word_details entries for new words
  console.log('\nCreating word_details entries...');
  const detailsSql = createDetailsStatements(source);
  const detailsTempFile = `/tmp/scowl-details-${Date.now()}.sql`;
  fs.writeFileSync(detailsTempFile, detailsSql);

  try {
    execSync(`npx wrangler d1 execute word_of_the_day ${envFlag} --file="${detailsTempFile}"`, {
      stdio: 'inherit',
    });
    fs.unlinkSync(detailsTempFile);
  } catch (error) {
    console.error('Error creating word_details:', error.message);
  }

  console.log(`\nImport complete! Processed ${totalInserted} words.`);
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
