import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Miniflare } from 'miniflare';

import { Env, NotificationJob } from '../src/env';

export async function createTestEnv(): Promise<{
  env: Env;
  queueMessages: NotificationJob[];
  cleanup: () => Promise<void>;
}> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {}',
    d1Databases: {
      DB: 'test-db',
    },
    kvNamespaces: ['KV'],
  });

  const db = await mf.getD1Database('DB');
  const kv = (await mf.getKVNamespace('KV')) as unknown as KVNamespace;

  await applyMigrations(db);

  const queueMessages: NotificationJob[] = [];
  const env: Env = {
    DB: db,
    KV: kv,
    NOTIFICATION_QUEUE: {
      async send(message: NotificationJob) {
        queueMessages.push(message);
      },
    } as any,
    APP_ENV: 'test',
    CORS_ALLOW_ORIGIN: 'http://localhost',
    SESSION_TTL_DAYS: '30',
    SESSION_SECRET: 'test-secret',
    SESSION_COOKIE_SAMESITE: 'Lax',
    COOKIE_SECURE: 'false',
    VAPID_PUBLIC_KEY: 'test',
    VAPID_PRIVATE_KEY: 'test',
    VAPID_SUBJECT: 'mailto:test@example.com',
    GOOGLE_CLIENT_ID: 'test',
    RESEND_API_KEY: 'test',
    RESEND_FROM: 'test@example.com',
    TWILIO_ACCOUNT_SID: 'test',
    TWILIO_AUTH_TOKEN: 'test',
    TWILIO_FROM: '+15555555555',
  };

  return {
    env,
    queueMessages,
    cleanup: async () => {
      await mf.dispose();
    },
  };
}

async function applyMigrations(db: any): Promise<void> {
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
    const statements = sql
      .split(/;\s*(?:\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  }
}
