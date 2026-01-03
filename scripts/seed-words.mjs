import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function getWranglerCommand() {
  const localPath = './apps/api/node_modules/.bin/wrangler';
  if (existsSync(localPath)) {
    return localPath;
  }
  return 'npx wrangler';
}

const wrangler = getWranglerCommand();

execSync(
  `${wrangler} d1 execute word_of_the_day --file migrations/0002_seed_words.sql --local --cwd apps/api`,
  {
    stdio: 'inherit',
  }
);

execSync('node scripts/seed-admin.mjs --local', { stdio: 'inherit' });
