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

loadEnvFromDevVars();

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const modeFlag = isRemote ? '--remote' : '--local';

const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
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

const sql = `
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
  execSync(`${wrangler} d1 migrations apply word_of_the_day ${modeFlag} --cwd apps/api`, {
    stdio: 'inherit',
  });
  execSync(`${wrangler} d1 execute word_of_the_day --file ${tempPath} ${modeFlag} --cwd apps/api`, {
    stdio: 'inherit',
  });
} finally {
  unlinkSync(tempPath);
}
