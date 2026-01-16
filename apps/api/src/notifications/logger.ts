import { DateTime } from 'luxon';

import { Env } from '../env';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'cron' | 'push' | 'subscription' | 'vapid';

export interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  userId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface StoredLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  user_id: string | null;
  message: string;
  metadata_json: string | null;
  created_at: string;
}

export async function log(env: Env, entry: LogEntry): Promise<void> {
  const timestamp = DateTime.utc().toISO();
  if (!timestamp) return;

  const logId = crypto.randomUUID();

  const consoleEntry = {
    timestamp,
    level: entry.level,
    category: entry.category,
    userId: entry.userId,
    message: entry.message,
    metadata: entry.metadata,
  };

  if (entry.level === 'error') {
    console.error(JSON.stringify(consoleEntry));
  } else if (entry.level === 'warn') {
    console.warn(JSON.stringify(consoleEntry));
  } else {
    console.log(JSON.stringify(consoleEntry));
  }

  try {
    await env.DB.prepare(
      `INSERT INTO notification_logs (id, timestamp, level, category, user_id, message, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        logId,
        timestamp,
        entry.level,
        entry.category,
        entry.userId ?? null,
        entry.message,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        timestamp
      )
      .run();
  } catch (dbError) {
    console.error('Failed to persist notification log:', dbError);
  }
}

export function logInfo(
  env: Env,
  category: LogCategory,
  message: string,
  metadata?: Record<string, unknown>,
  userId?: string
): Promise<void> {
  return log(env, { level: 'info', category, message, metadata, userId });
}

export function logWarn(
  env: Env,
  category: LogCategory,
  message: string,
  metadata?: Record<string, unknown>,
  userId?: string
): Promise<void> {
  return log(env, { level: 'warn', category, message, metadata, userId });
}

export function logError(
  env: Env,
  category: LogCategory,
  message: string,
  metadata?: Record<string, unknown>,
  userId?: string
): Promise<void> {
  return log(env, { level: 'error', category, message, metadata, userId });
}

export interface LogQueryParams {
  category?: LogCategory;
  level?: LogLevel;
  userId?: string;
  limit?: number;
  offset?: number;
}

export async function queryLogs(env: Env, params: LogQueryParams = {}): Promise<StoredLogEntry[]> {
  const { category, level, userId, limit = 100, offset = 0 } = params;

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (category) {
    conditions.push('category = ?');
    bindings.push(category);
  }
  if (level) {
    conditions.push('level = ?');
    bindings.push(level);
  }
  if (userId) {
    conditions.push('user_id = ?');
    bindings.push(userId);
  }

  let query = 'SELECT * FROM notification_logs';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  bindings.push(Math.min(limit, 500), offset);

  const result = await env.DB.prepare(query)
    .bind(...bindings)
    .all();

  return result.results as unknown as StoredLogEntry[];
}
