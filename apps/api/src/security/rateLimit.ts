import { Env } from '../env';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number | null;
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const MIN_KV_EXPIRATION_TTL_SECONDS = 60;

export function getClientIp(request: Request): string | null {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) {
    return cfIp;
  }
  const forwarded = request.headers.get('X-Forwarded-For');
  if (!forwarded) {
    return null;
  }
  return forwarded.split(',')[0]?.trim() || null;
}

export async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const existing = (await env.KV.get(key, { type: 'json' })) as RateLimitRecord | null;

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSeconds;
    const record: RateLimitRecord = { count: 1, resetAt };
    await env.KV.put(key, JSON.stringify(record), {
      expirationTtl: Math.max(windowSeconds, MIN_KV_EXPIRATION_TTL_SECONDS),
    });
    return {
      allowed: true,
      limit,
      remaining: Math.max(limit - 1, 0),
      resetAt,
      retryAfter: null,
    };
  }

  const count = existing.count + 1;
  const resetAt = existing.resetAt;
  const ttl = Math.max(resetAt - now, 1);
  await env.KV.put(key, JSON.stringify({ count, resetAt }), {
    expirationTtl: Math.max(ttl, MIN_KV_EXPIRATION_TTL_SECONDS),
  });

  const allowed = count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(limit - count, 0),
    resetAt,
    retryAfter: allowed ? null : ttl,
  };
}
