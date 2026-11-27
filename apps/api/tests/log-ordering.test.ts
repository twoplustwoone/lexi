import { describe, expect, it } from 'vitest';

import { queryLogs } from '../src/notifications/logger';
import { createTestEnv } from './helpers';

/**
 * Reproduction: rows sharing a timestamp have no defined order.
 *
 * `queryLogs` sorts on `timestamp` alone, which is an ISO string at
 * millisecond resolution. Two rows written inside the same millisecond
 * compare equal, so the sort is not total and SQLite may return them in
 * either order — and with LIMIT/OFFSET, a page boundary landing inside the
 * tie can repeat or skip a row.
 */
describe('log ordering under identical timestamps', () => {
  it('returns ties in insertion order, and pages over them without loss', async () => {
    const { env, cleanup } = await createTestEnv();
    try {
      const stamp = '2026-09-05T12:00:00.000Z';
      for (const message of ['First', 'Second', 'Third']) {
        await env.DB.prepare(
          `INSERT INTO notification_logs
             (id, timestamp, level, category, user_id, message, metadata_json, created_at)
           VALUES (?, ?, 'info', 'cron', NULL, ?, NULL, ?)`
        )
          .bind(crypto.randomUUID(), stamp, message, stamp)
          .run();
      }

      const all = await queryLogs(env);
      expect(all.map((row) => row.message)).toEqual(['Third', 'Second', 'First']);

      // Paging must not repeat or drop a row just because the boundary fell
      // inside the tie.
      const firstPage = await queryLogs(env, { limit: 2, offset: 0 });
      const secondPage = await queryLogs(env, { limit: 2, offset: 2 });
      expect([...firstPage, ...secondPage].map((row) => row.message)).toEqual([
        'Third',
        'Second',
        'First',
      ]);
    } finally {
      await cleanup();
    }
  });
});
