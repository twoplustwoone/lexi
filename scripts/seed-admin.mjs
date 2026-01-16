import { execSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_PREFERENCES = {
  version: 1,
  notification_enabled: false,
  delivery_time: '09:00',
};

function loadEnvFromDevVars() {
  const path = new URL('../apps/api/.dev.vars', import.meta.url);
  if (!existsSync(path)) {
    return;
  }
  const contents = readFileSync(path, 'utf-8');
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const [key, ...rest] = line.split('=');
    if (!key || process.env[key]) {
      continue;
    }
    process.env[key] = rest.join('=').trim();
  }
}

function getWranglerCommand() {
  const localPath = './apps/api/node_modules/.bin/wrangler';
  if (existsSync(localPath)) {
    return localPath;
  }
  return 'npx wrangler';
}

function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hashPassword(password, salt = randomBytes(16)) {
  const saltBuffer = Buffer.from(salt);
  const hash = scryptSync(password, saltBuffer, 32, { N: 16384, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, base64UrlEncode(saltBuffer), base64UrlEncode(hash)].join('$');
}

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

function isTruthyEnv(value) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

loadEnvFromDevVars();

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const modeFlag = isRemote ? '--remote' : '--local';

// Support --env flag for production deployments (e.g., --env production)
const envIndex = args.indexOf('--env');
const envValue = envIndex !== -1 && args[envIndex + 1] ? args[envIndex + 1] : null;
const envFlag = envValue ? `--env ${envValue}` : '';

const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
const forceSeed = isTruthyEnv(process.env.ADMIN_FORCE_SEED);
if (!username || !password) {
  console.log('Skipping admin seed: ADMIN_USERNAME or ADMIN_PASSWORD not set.');
  process.exit(0);
}

const userId = randomUUID();
const now = new Date().toISOString();
const passwordHash = hashPassword(password);
const usernameEscaped = escapeSql(username);
const passwordEscaped = escapeSql(passwordHash);
const preferencesEscaped = escapeSql(JSON.stringify(DEFAULT_PREFERENCES));

const sql = forceSeed
  ? `
WITH candidate_users AS (
  SELECT id AS user_id, 1 AS priority FROM users WHERE username = '${usernameEscaped}'
  UNION ALL
  SELECT user_id, 2 AS priority FROM auth_email_password WHERE email = '${usernameEscaped}'
),
resolved_user AS (
  SELECT COALESCE((SELECT user_id FROM candidate_users ORDER BY priority LIMIT 1), '${userId}') AS user_id
)
INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json, username, is_admin)
SELECT (SELECT user_id FROM resolved_user), '${now}', 0, 'UTC', '${preferencesEscaped}', '${usernameEscaped}', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = (SELECT user_id FROM resolved_user));

UPDATE users
SET is_admin = 1,
    is_anonymous = 0,
    username = '${usernameEscaped}'
WHERE id = (SELECT user_id FROM resolved_user);

INSERT OR REPLACE INTO auth_email_password (user_id, email, password_hash, created_at, password_set)
VALUES ((SELECT user_id FROM resolved_user), '${usernameEscaped}', '${passwordEscaped}', '${now}', 1);
`
  : `
INSERT INTO users (id, created_at, is_anonymous, timezone, preferences_json, username, is_admin)
SELECT '${userId}', '${now}', 0, 'UTC', '${preferencesEscaped}', '${usernameEscaped}', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = '${usernameEscaped}')
  AND NOT EXISTS (SELECT 1 FROM auth_email_password WHERE email = '${usernameEscaped}');

INSERT INTO auth_email_password (user_id, email, password_hash, created_at)
SELECT '${userId}', '${usernameEscaped}', '${passwordEscaped}', '${now}'
WHERE EXISTS (SELECT 1 FROM users WHERE id = '${userId}')
  AND NOT EXISTS (SELECT 1 FROM auth_email_password WHERE email = '${usernameEscaped}');
`;

const tempPath = path.join(os.tmpdir(), `wotd-admin-seed-${Date.now()}.sql`);
writeFileSync(tempPath, sql);

const wrangler = getWranglerCommand();

try {
  execSync(`${wrangler} d1 migrations apply word_of_the_day ${modeFlag} ${envFlag} --cwd apps/api`, {
    stdio: 'inherit',
  });
  execSync(`${wrangler} d1 execute word_of_the_day --file ${tempPath} ${modeFlag} ${envFlag} --cwd apps/api`, {
    stdio: 'inherit',
  });
} finally {
  unlinkSync(tempPath);
}
