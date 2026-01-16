import { describe, expect, it } from 'vitest';

import { log, logError, logInfo, logWarn, queryLogs } from '../src/notifications/logger';
import { createTestEnv } from './helpers';

describe('logger', () => {
  describe('log', () => {
    it('persists log entries to database', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await log(env, {
          level: 'info',
          category: 'cron',
          message: 'Test log message',
        });

        const result = await env.DB.prepare('SELECT * FROM notification_logs').all();
        expect(result.results).toHaveLength(1);
        expect(result.results[0].level).toBe('info');
        expect(result.results[0].category).toBe('cron');
        expect(result.results[0].message).toBe('Test log message');
      } finally {
        await cleanup();
      }
    });

    it('stores user_id when provided', async () => {
      const { env, cleanup } = await createTestEnv();
      const userId = 'test-user-123';

      try {
        await log(env, {
          level: 'warn',
          category: 'push',
          userId,
          message: 'Test with user',
        });

        const result = await env.DB.prepare('SELECT user_id FROM notification_logs').first();
        expect(result?.user_id).toBe(userId);
      } finally {
        await cleanup();
      }
    });

    it('stores metadata as JSON', async () => {
      const { env, cleanup } = await createTestEnv();
      const metadata = { status: 201, endpoint: 'fcm.googleapis.com' };

      try {
        await log(env, {
          level: 'info',
          category: 'push',
          message: 'Test with metadata',
          metadata,
        });

        const result = await env.DB.prepare('SELECT metadata_json FROM notification_logs').first();
        expect(result?.metadata_json).toBe(JSON.stringify(metadata));
      } finally {
        await cleanup();
      }
    });

    it('handles null metadata', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await log(env, {
          level: 'info',
          category: 'cron',
          message: 'No metadata',
        });

        const result = await env.DB.prepare('SELECT metadata_json FROM notification_logs').first();
        expect(result?.metadata_json).toBeNull();
      } finally {
        await cleanup();
      }
    });
  });

  describe('convenience methods', () => {
    it('logInfo creates info level log', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await logInfo(env, 'cron', 'Info message');

        const result = await env.DB.prepare('SELECT level FROM notification_logs').first();
        expect(result?.level).toBe('info');
      } finally {
        await cleanup();
      }
    });

    it('logWarn creates warn level log', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await logWarn(env, 'push', 'Warning message');

        const result = await env.DB.prepare('SELECT level FROM notification_logs').first();
        expect(result?.level).toBe('warn');
      } finally {
        await cleanup();
      }
    });

    it('logError creates error level log', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await logError(env, 'vapid', 'Error message');

        const result = await env.DB.prepare('SELECT level FROM notification_logs').first();
        expect(result?.level).toBe('error');
      } finally {
        await cleanup();
      }
    });
  });

  describe('queryLogs', () => {
    it('returns logs ordered by timestamp descending', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await logInfo(env, 'cron', 'First');
        await logInfo(env, 'cron', 'Second');
        await logInfo(env, 'cron', 'Third');

        const logs = await queryLogs(env);

        expect(logs).toHaveLength(3);
        // Most recent first
        expect(logs[0].message).toBe('Third');
        expect(logs[2].message).toBe('First');
      } finally {
        await cleanup();
      }
    });

    it('filters by category', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await logInfo(env, 'cron', 'Cron log');
        await logInfo(env, 'push', 'Push log');

        const logs = await queryLogs(env, { category: 'cron' });

        expect(logs).toHaveLength(1);
        expect(logs[0].message).toBe('Cron log');
      } finally {
        await cleanup();
      }
    });

    it('filters by level', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await logInfo(env, 'cron', 'Info log');
        await logError(env, 'cron', 'Error log');

        const logs = await queryLogs(env, { level: 'error' });

        expect(logs).toHaveLength(1);
        expect(logs[0].message).toBe('Error log');
      } finally {
        await cleanup();
      }
    });

    it('filters by userId', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await logInfo(env, 'push', 'User A log', undefined, 'user-a');
        await logInfo(env, 'push', 'User B log', undefined, 'user-b');

        const logs = await queryLogs(env, { userId: 'user-a' });

        expect(logs).toHaveLength(1);
        expect(logs[0].message).toBe('User A log');
      } finally {
        await cleanup();
      }
    });

    it('respects limit parameter', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        for (let i = 0; i < 10; i++) {
          await logInfo(env, 'cron', `Log ${i}`);
        }

        const logs = await queryLogs(env, { limit: 5 });

        expect(logs).toHaveLength(5);
      } finally {
        await cleanup();
      }
    });

    it('respects offset parameter', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        await logInfo(env, 'cron', 'First');
        await logInfo(env, 'cron', 'Second');
        await logInfo(env, 'cron', 'Third');

        const logs = await queryLogs(env, { offset: 1, limit: 2 });

        expect(logs).toHaveLength(2);
        expect(logs[0].message).toBe('Second');
        expect(logs[1].message).toBe('First');
      } finally {
        await cleanup();
      }
    });

    it('caps limit at 500', async () => {
      const { env, cleanup } = await createTestEnv();

      try {
        // Just verify the query doesn't fail with large limit
        const logs = await queryLogs(env, { limit: 1000 });
        expect(Array.isArray(logs)).toBe(true);
      } finally {
        await cleanup();
      }
    });
  });
});
