import { DateTime } from 'luxon';
import { Hono } from 'hono';
import { ZodError, z } from 'zod';

import {
  DEFAULT_PREFERENCES,
  deliverySettingsSchema,
  emailSchema,
  eventSchema,
  normalizePreferences,
  passwordSchema,
  pushSubscriptionSchema,
  timeZoneSchema,
  uuidSchema,
} from '@word-of-the-day/shared';

import { buildServerEvent, recordEvent } from './analytics';
import { sendEmailCode } from './auth/email';
import { verifyGoogleIdToken } from './auth/google';
import { resolveAnonymousId, resolveUserId } from './auth/identity';
import { mergeAnonymousIntoUser } from './auth/merge';
import { buildExpiry, createCodeHash, generateNumericCode } from './auth/otp';
import {
  buildSessionCookie,
  clearSession,
  createSession,
  getSessionUserId,
  parseCookies,
} from './auth/sessions';
import { Env } from './env';
import {
  createAnonymousUser,
  getNotificationSchedule,
  getUserById,
  updateUserPreferences,
  updateUserTimezone,
  upsertNotificationSchedule,
} from './db';
import { LogCategory, LogLevel, queryLogs } from './notifications/logger';
import { sendWebPushNotification } from './notifications/push';
import { processDueSchedules } from './notifications/scheduler';
import { base64UrlDecode } from './utils/base64';
import { hashCode, hashPassword, verifyPassword } from './utils/crypto';
import { ensureDailyWordForUser, getWordById } from './words';

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof ZodError) {
    const message = err.issues.map((issue) => issue.message).join(', ');
    return c.json({ error: message || 'Invalid request' }, 400);
  }
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal server error' }, 500);
});

app.use('*', async (c, next) => {
  const origin = c.req.header('origin');
  const allowed = c.env.CORS_ALLOW_ORIGIN?.split(',').map((value) => value.trim());
  if (origin && allowed?.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
  } else if (allowed?.length) {
    c.header('Access-Control-Allow-Origin', allowed[0]);
  }
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Anon-Id, X-Timezone');
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/identity/anonymous', async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    id: uuidSchema,
    timezone: timeZoneSchema,
  });
  const parsed = schema.parse(body);
  const existing = await getUserById(c.env, parsed.id);
  if (!existing) {
    await createAnonymousUser(c.env, parsed.id, parsed.timezone, DEFAULT_PREFERENCES);
  } else if (existing.is_anonymous !== 1) {
    return c.json({ error: 'User already exists' }, 409);
  } else if (!existing.merged_into_user_id && existing.timezone !== parsed.timezone) {
    await updateUserTimezone(c.env, parsed.id, parsed.timezone);
  }

  if (existing?.merged_into_user_id) {
    return c.json({
      ok: true,
      user_id: parsed.id,
      merged_into_user_id: existing.merged_into_user_id,
    });
  }

  const schedule = await getNotificationSchedule(c.env, parsed.id);
  if (!schedule) {
    const nextDeliveryAt = computeInitialDelivery(
      parsed.timezone,
      DEFAULT_PREFERENCES.delivery_time
    );
    await upsertNotificationSchedule(c.env, {
      userId: parsed.id,
      deliveryTime: DEFAULT_PREFERENCES.delivery_time,
      timezone: parsed.timezone,
      enabled: false,
      nextDeliveryAt,
    });
  }

  return c.json({
    ok: true,
    user_id: parsed.id,
    merged_into_user_id: existing?.merged_into_user_id,
  });
});

app.get('/api/me', async (c) => {
  const cookieHeader = c.req.header('cookie');
  const cookies = parseCookies(cookieHeader ?? null);
  const token = cookies.session ?? null;
  let userId: string | null = null;
  if (token) {
    userId = await getSessionUserId(c.env, token);
  }
  if (userId) {
    const user = await getUserById(c.env, userId);
    return c.json({
      user_id: userId,
      is_authenticated: true,
      is_anonymous: user?.is_anonymous === 1,
      is_admin: user?.is_admin === 1,
    });
  }
  const anonId = await resolveAnonymousId(c.env, c.req.raw);
  return c.json({
    user_id: anonId ?? null,
    is_authenticated: false,
    is_anonymous: true,
    is_admin: false,
  });
});

app.get('/api/word/today', async (c) => {
  const userId = await resolveUserId(c.env, c.req.raw);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const { word, delivered, dateKey } = await ensureDailyWordForUser(c.env, {
    userId,
    timezone: user.timezone,
  });

  if (delivered) {
    await recordEvent(
      c.env,
      buildServerEvent({ name: 'word_delivered', userId, metadata: { source: 'app' } })
    );
  }

  return c.json({
    date: dateKey,
    word: { ...word, examples: JSON.parse(word.examples_json) },
  });
});

app.post('/api/word/view', async (c) => {
  const userId = await resolveUserId(c.env, c.req.raw);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json();
  const parsed = z.object({ word_id: z.number() }).parse(body);
  const now = DateTime.utc().toISO();
  const result = await c.env.DB.prepare(
    'UPDATE user_words SET viewed_at = ? WHERE user_id = ? AND word_id = ? AND viewed_at IS NULL'
  )
    .bind(now, userId, parsed.word_id)
    .run();
  const changes = result.meta?.changes ?? 0;
  if (changes > 0) {
    await recordEvent(c.env, buildServerEvent({ name: 'word_viewed', userId }));
  }
  return c.json({ ok: true });
});

app.get('/api/history', async (c) => {
  const userId = await resolveUserId(c.env, c.req.raw);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const result = await c.env.DB.prepare(
    `SELECT uw.word_id, uw.delivered_at, uw.viewed_at, w.word, w.definition, w.etymology, w.pronunciation, w.examples_json
     FROM user_words uw
     JOIN words w ON uw.word_id = w.id
     WHERE uw.user_id = ?
     ORDER BY uw.delivered_at DESC`
  )
    .bind(userId)
    .all();

  const history = result.results.map((row) => ({
    word_id: row.word_id,
    delivered_at: row.delivered_at,
    viewed_at: row.viewed_at,
    word: row.word,
    definition: row.definition,
    etymology: row.etymology,
    pronunciation: row.pronunciation,
    examples: JSON.parse(row.examples_json as string),
  }));

  return c.json({ history });
});

app.get('/api/settings', async (c) => {
  const userId = await resolveUserId(c.env, c.req.raw);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  let schedule = await getNotificationSchedule(c.env, userId);
  if (!schedule) {
    const nextDeliveryAt = computeInitialDelivery(user.timezone, DEFAULT_PREFERENCES.delivery_time);
    await upsertNotificationSchedule(c.env, {
      userId,
      deliveryTime: DEFAULT_PREFERENCES.delivery_time,
      timezone: user.timezone,
      enabled: false,
      nextDeliveryAt,
    });
    schedule = await getNotificationSchedule(c.env, userId);
  }
  let preferences = DEFAULT_PREFERENCES;
  try {
    preferences = normalizePreferences(JSON.parse(user.preferences_json));
  } catch {
    preferences = DEFAULT_PREFERENCES;
  }
  return c.json({
    schedule: {
      enabled: schedule?.enabled === 1,
      delivery_time: schedule?.delivery_time,
      timezone: schedule?.timezone,
    },
    preferences,
  });
});

app.put('/api/settings', async (c) => {
  const userId = await resolveUserId(c.env, c.req.raw);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json();
  const parsed = deliverySettingsSchema.parse(body);

  await updateUserTimezone(c.env, userId, parsed.timezone);
  const user = await getUserById(c.env, userId);
  let currentPreferences = DEFAULT_PREFERENCES;
  if (user?.preferences_json) {
    try {
      currentPreferences = normalizePreferences(JSON.parse(user.preferences_json));
    } catch {
      currentPreferences = DEFAULT_PREFERENCES;
    }
  }
  const updatedPreferences = {
    ...currentPreferences,
    notification_enabled: parsed.enabled,
    delivery_time: parsed.delivery_time,
  };
  await updateUserPreferences(c.env, userId, updatedPreferences);

  const nextDeliveryAt = parsed.enabled
    ? computeNextDeliveryFromTomorrow(parsed.timezone, parsed.delivery_time)
    : computeInitialDelivery(parsed.timezone, parsed.delivery_time);

  await upsertNotificationSchedule(c.env, {
    userId,
    deliveryTime: parsed.delivery_time,
    timezone: parsed.timezone,
    enabled: parsed.enabled,
    nextDeliveryAt,
  });

  if (!parsed.enabled) {
    await recordEvent(c.env, buildServerEvent({ name: 'notification_disabled', userId }));
  }

  return c.json({ ok: true });
});

app.get('/api/notifications/vapid', (c) => {
  const publicKey = c.env.VAPID_PUBLIC_KEY;
  if (!publicKey || publicKey.startsWith('replace-')) {
    return c.json({ error: 'VAPID public key not configured' }, 503);
  }
  return c.json({ publicKey });
});

app.post('/api/notifications/subscribe', async (c) => {
  const userId = await resolveUserId(c.env, c.req.raw);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json();
  const parsed = pushSubscriptionSchema.parse(body);
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, expiration_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      userId,
      parsed.endpoint,
      parsed.keys.p256dh,
      parsed.keys.auth,
      parsed.expirationTime ?? null,
      DateTime.utc().toISO()
    )
    .run();

  return c.json({ ok: true });
});

app.post('/api/notifications/unsubscribe', async (c) => {
  const userId = await resolveUserId(c.env, c.req.raw);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json();
  const parsed = z.object({ endpoint: z.string().url() }).parse(body);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(parsed.endpoint, userId)
    .run();
  return c.json({ ok: true });
});

app.post('/api/events', async (c) => {
  const userId = await resolveUserId(c.env, c.req.raw);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json();
  const parsed = eventSchema.parse(body);
  if (parsed.user_id !== userId) {
    const mergedRecord = await c.env.DB.prepare(
      'SELECT merged_into_user_id FROM users WHERE id = ?'
    )
      .bind(parsed.user_id)
      .first();
    if (!mergedRecord || mergedRecord.merged_into_user_id !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }
  await recordEvent(c.env, parsed);
  return c.json({ ok: true });
});

app.post('/api/auth/methods', async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ email: emailSchema }).parse(body);

  const passwordRecord = await c.env.DB.prepare(
    'SELECT password_set FROM auth_email_password WHERE email = ?'
  )
    .bind(parsed.email)
    .first();

  const googleRecord = await c.env.DB.prepare(
    'SELECT user_id FROM auth_oauth WHERE provider = ? AND email = ?'
  )
    .bind('google', parsed.email)
    .first();

  const passwordSet = passwordRecord ? Number(passwordRecord.password_set) === 1 : false;
  const accountExists = Boolean(passwordRecord || googleRecord);

  return c.json({
    account_exists: accountExists,
    methods: {
      password: passwordSet,
      email_code: true,
      google: Boolean(googleRecord),
    },
  });
});

app.post('/api/auth/signup', async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ email: emailSchema, password: passwordSchema }).parse(body);
  const existing = await c.env.DB.prepare('SELECT user_id FROM auth_email_password WHERE email = ?')
    .bind(parsed.email)
    .first();
  if (existing) {
    return c.json({ error: 'Email already in use' }, 409);
  }
  const oauthExisting = await c.env.DB.prepare(
    'SELECT user_id FROM auth_oauth WHERE provider = ? AND email = ?'
  )
    .bind('google', parsed.email)
    .first();
  if (oauthExisting) {
    return c.json({ error: 'Email already in use' }, 409);
  }

  const anonId = await resolveAnonymousId(c.env, c.req.raw);
  let userId = anonId;
  if (!userId) {
    const timezone = c.req.header('x-timezone') ?? 'UTC';
    timeZoneSchema.parse(timezone);
    userId = crypto.randomUUID();
    await createAnonymousUser(c.env, userId, timezone, DEFAULT_PREFERENCES);
    await ensureDefaultSchedule(c.env, userId, timezone);
  } else {
    const timezone = c.req.header('x-timezone') ?? 'UTC';
    await ensureAnonymousRecord(c.env, userId, timezone);
  }

  await c.env.DB.prepare('UPDATE users SET is_anonymous = 0 WHERE id = ?').bind(userId).run();
  const passwordHash = hashPassword(parsed.password);
  await c.env.DB.prepare(
    'INSERT INTO auth_email_password (user_id, email, password_hash, password_set, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(userId, parsed.email, passwordHash, 1, DateTime.utc().toISO())
    .run();

  const session = await createSession(c.env, userId);
  c.header('Set-Cookie', buildSessionCookie(c.env, session.token));

  await recordEvent(
    c.env,
    buildServerEvent({ name: 'account_created', userId, metadata: { method: 'email_password' } })
  );
  await recordEvent(
    c.env,
    buildServerEvent({ name: 'auth_method_used', userId, metadata: { method: 'email_password' } })
  );

  return c.json({ ok: true, user_id: userId });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json();
  const parsed = z
    .object({
      email: emailSchema.optional(),
      identifier: z.string().min(3).optional(),
      password: z.string().min(1),
    })
    .refine((data) => data.email || data.identifier, { message: 'Missing identifier' })
    .parse(body);

  const identifier = parsed.email ?? parsed.identifier ?? '';
  let record = await c.env.DB.prepare(
    'SELECT user_id, password_hash FROM auth_email_password WHERE email = ?'
  )
    .bind(identifier)
    .first();

  if (!record) {
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
      .bind(identifier)
      .first();
    if (user) {
      record = await c.env.DB.prepare(
        'SELECT user_id, password_hash FROM auth_email_password WHERE user_id = ?'
      )
        .bind(user.id)
        .first();
    }
  }

  if (!record) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  const ok = verifyPassword(parsed.password, record.password_hash as string);
  if (!ok) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  const anonId = await resolveAnonymousId(c.env, c.req.raw);
  if (anonId) {
    await mergeAnonymousIntoUser(c.env, anonId, record.user_id as string);
  }
  const session = await createSession(c.env, record.user_id as string);
  c.header('Set-Cookie', buildSessionCookie(c.env, session.token));

  await recordEvent(
    c.env,
    buildServerEvent({
      name: 'auth_method_used',
      userId: record.user_id as string,
      metadata: { method: 'email_password' },
    })
  );

  return c.json({ ok: true, user_id: record.user_id });
});

app.post('/api/auth/email/code/request', async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ email: emailSchema }).parse(body);
  const code = generateNumericCode();
  const { hash, salt } = createCodeHash(code);
  await c.env.DB.prepare(
    'INSERT INTO auth_codes (id, target, code_hash, salt, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      parsed.email,
      hash,
      salt,
      'email_code',
      buildExpiry(10),
      DateTime.utc().toISO()
    )
    .run();

  await sendEmailCode(c.env, parsed.email, code);

  return c.json({ ok: true });
});

app.post('/api/auth/email/code/verify', async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ email: emailSchema, code: z.string().min(4) }).parse(body);
  const record = await c.env.DB.prepare(
    `SELECT * FROM auth_codes WHERE target = ? AND purpose = 'email_code' AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(parsed.email)
    .first();
  if (!record) {
    return c.json({ error: 'Code not found' }, 404);
  }
  if ((record.expires_at as string) <= DateTime.utc().toISO()) {
    return c.json({ error: 'Code expired' }, 410);
  }
  const expectedHash = hashCode(parsed.code, record.salt as string);
  if (expectedHash !== record.code_hash) {
    return c.json({ error: 'Invalid code' }, 401);
  }

  await c.env.DB.prepare('UPDATE auth_codes SET consumed_at = ? WHERE id = ?')
    .bind(DateTime.utc().toISO(), record.id)
    .run();

  let userId: string | null = null;
  let hasPasswordRecord = false;
  let createdAccount = false;
  const authUser = await c.env.DB.prepare('SELECT user_id FROM auth_email_password WHERE email = ?')
    .bind(parsed.email)
    .first();
  if (authUser) {
    userId = authUser.user_id as string;
    hasPasswordRecord = true;
  } else {
    const oauthUser = await c.env.DB.prepare(
      'SELECT user_id FROM auth_oauth WHERE provider = ? AND email = ?'
    )
      .bind('google', parsed.email)
      .first();
    if (oauthUser) {
      userId = oauthUser.user_id as string;
    } else {
      const anonId = await resolveAnonymousId(c.env, c.req.raw);
      if (anonId) {
        userId = anonId;
        const timezone = c.req.header('x-timezone') ?? 'UTC';
        await ensureAnonymousRecord(c.env, userId, timezone);
        await c.env.DB.prepare('UPDATE users SET is_anonymous = 0 WHERE id = ?').bind(userId).run();
        createdAccount = true;
      } else {
        const timezone = c.req.header('x-timezone') ?? 'UTC';
        timeZoneSchema.parse(timezone);
        userId = crypto.randomUUID();
        await createAnonymousUser(c.env, userId, timezone, DEFAULT_PREFERENCES);
        await ensureDefaultSchedule(c.env, userId, timezone);
        await c.env.DB.prepare('UPDATE users SET is_anonymous = 0 WHERE id = ?').bind(userId).run();
        createdAccount = true;
      }
    }
  }

  if (!userId) {
    return c.json({ error: 'Unable to complete login' }, 500);
  }

  if (!hasPasswordRecord) {
    await c.env.DB.prepare(
      'INSERT INTO auth_email_password (user_id, email, password_hash, password_set, created_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(userId, parsed.email, hashPassword(crypto.randomUUID()), 0, DateTime.utc().toISO())
      .run();
  }

  const anonId = await resolveAnonymousId(c.env, c.req.raw);
  if (anonId && anonId !== userId) {
    await mergeAnonymousIntoUser(c.env, anonId, userId);
  }

  const session = await createSession(c.env, userId);
  c.header('Set-Cookie', buildSessionCookie(c.env, session.token));

  if (createdAccount) {
    await recordEvent(
      c.env,
      buildServerEvent({ name: 'account_created', userId, metadata: { method: 'email_code' } })
    );
  }
  await recordEvent(
    c.env,
    buildServerEvent({ name: 'auth_method_used', userId, metadata: { method: 'email_code' } })
  );

  return c.json({ ok: true, user_id: userId });
});

app.post('/api/auth/google', async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ id_token: z.string().min(10) }).parse(body);
  const profile = await verifyGoogleIdToken(c.env, parsed.id_token);

  const account = await c.env.DB.prepare(
    'SELECT user_id FROM auth_oauth WHERE provider = ? AND provider_user_id = ?'
  )
    .bind('google', profile.sub)
    .first();
  let userId = account?.user_id as string | undefined;

  let createdAccount = false;
  if (!userId) {
    const anonId = await resolveAnonymousId(c.env, c.req.raw);
    if (anonId) {
      userId = anonId;
      const timezone = c.req.header('x-timezone') ?? 'UTC';
      await ensureAnonymousRecord(c.env, userId, timezone);
      await c.env.DB.prepare('UPDATE users SET is_anonymous = 0 WHERE id = ?').bind(userId).run();
      createdAccount = true;
    } else {
      const timezone = c.req.header('x-timezone') ?? 'UTC';
      timeZoneSchema.parse(timezone);
      userId = crypto.randomUUID();
      await createAnonymousUser(c.env, userId, timezone, DEFAULT_PREFERENCES);
      await ensureDefaultSchedule(c.env, userId, timezone);
      await c.env.DB.prepare('UPDATE users SET is_anonymous = 0 WHERE id = ?').bind(userId).run();
      createdAccount = true;
    }
    await c.env.DB.prepare(
      'INSERT INTO auth_oauth (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(
        crypto.randomUUID(),
        userId,
        'google',
        profile.sub,
        profile.email,
        DateTime.utc().toISO()
      )
      .run();
  }

  const anonId = await resolveAnonymousId(c.env, c.req.raw);
  if (anonId && anonId !== userId) {
    await mergeAnonymousIntoUser(c.env, anonId, userId);
  }

  const session = await createSession(c.env, userId);
  c.header('Set-Cookie', buildSessionCookie(c.env, session.token));

  if (createdAccount) {
    await recordEvent(
      c.env,
      buildServerEvent({ name: 'account_created', userId, metadata: { method: 'google' } })
    );
  }
  await recordEvent(
    c.env,
    buildServerEvent({ name: 'auth_method_used', userId, metadata: { method: 'google' } })
  );

  return c.json({ ok: true, user_id: userId });
});

app.post('/api/auth/logout', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies.session ?? null;
  await clearSession(c.env, token);
  c.header('Set-Cookie', buildSessionCookie(c.env, '', { clear: true }));
  return c.json({ ok: true });
});

app.post('/api/admin/notify', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies.session ?? null;
  const userId = await getSessionUserId(c.env, token);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user || user.is_admin !== 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (
    !c.env.VAPID_PUBLIC_KEY ||
    c.env.VAPID_PUBLIC_KEY.startsWith('replace-') ||
    !c.env.VAPID_PRIVATE_KEY ||
    c.env.VAPID_PRIVATE_KEY.startsWith('replace-')
  ) {
    return c.json({ error: 'VAPID keys not configured' }, 503);
  }

  const subscriptions = await c.env.DB.prepare(
    'SELECT endpoint FROM push_subscriptions WHERE user_id = ?'
  )
    .bind(userId)
    .all();
  if (subscriptions.results.length === 0) {
    return c.json({ error: 'No push subscription available' }, 400);
  }

  // Ensure a daily word is ready for the user (side effect only)
  await ensureDailyWordForUser(c.env, {
    userId,
    timezone: user.timezone,
  });

  // Send push notifications directly with detailed response
  const results: Array<{
    endpointDomain: string;
    status: number;
    ok: boolean;
    body?: string;
    error?: string;
  }> = [];

  for (const sub of subscriptions.results as Array<{ endpoint: string }>) {
    const endpointDomain = new URL(sub.endpoint).host;
    try {
      const response = await sendWebPushNotification({
        endpoint: sub.endpoint,
        publicKey: c.env.VAPID_PUBLIC_KEY,
        privateKey: c.env.VAPID_PRIVATE_KEY,
        subject: c.env.VAPID_SUBJECT,
      });

      const body = await response.text().catch(() => null);

      results.push({
        endpointDomain,
        status: response.status,
        ok: response.ok,
        body: body?.slice(0, 500) ?? undefined,
      });

      if (response.status === 404 || response.status === 410) {
        await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
          .bind(sub.endpoint)
          .run();
      }
    } catch (error) {
      results.push({
        endpointDomain,
        status: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return c.json({
    ok: results.some((r) => r.ok),
    results,
    vapidSubject: c.env.VAPID_SUBJECT,
  });
});

app.get('/api/admin/logs', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies.session ?? null;
  const userId = await getSessionUserId(c.env, token);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user || user.is_admin !== 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const category = c.req.query('category') as LogCategory | undefined;
  const level = c.req.query('level') as LogLevel | undefined;
  const filterUserId = c.req.query('user_id');
  const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
  const offset = Number(c.req.query('offset')) || 0;

  const logs = await queryLogs(c.env, {
    category,
    level,
    userId: filterUserId,
    limit,
    offset,
  });

  return c.json({
    logs: logs.map((log) => ({
      ...log,
      metadata: log.metadata_json ? JSON.parse(log.metadata_json) : null,
    })),
  });
});

app.get('/api/admin/cron-status', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies.session ?? null;
  const userId = await getSessionUserId(c.env, token);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user || user.is_admin !== 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const lastRun = await c.env.KV.get('cron:last_run');
  const runCount = await c.env.KV.get('cron:run_count');

  return c.json({
    lastRun,
    runCount: runCount ? Number(runCount) : 0,
    currentTime: DateTime.utc().toISO(),
  });
});

app.get('/api/admin/vapid-check', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies.session ?? null;
  const userId = await getSessionUserId(c.env, token);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user || user.is_admin !== 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const publicKey = c.env.VAPID_PUBLIC_KEY;
  const privateKey = c.env.VAPID_PRIVATE_KEY;
  const subject = c.env.VAPID_SUBJECT;

  const checks: Record<string, unknown> = {
    publicKeyLength: publicKey?.length ?? 0,
    privateKeyLength: privateKey?.length ?? 0,
    publicKeyPrefix: publicKey?.substring(0, 10) ?? null,
    subject,
    isPlaceholder:
      publicKey?.startsWith('replace-') ||
      privateKey?.startsWith('replace-') ||
      !publicKey ||
      !privateKey,
  };

  // Validate public key can be decoded
  if (publicKey && !publicKey.startsWith('replace-')) {
    try {
      const decoded = base64UrlDecode(publicKey);
      checks.publicKeyDecodedLength = decoded.length;
      checks.publicKeyFirstByte = decoded[0];
      checks.isValidUncompressedPoint = decoded.length === 65 && decoded[0] === 0x04;
    } catch (e) {
      checks.publicKeyDecodeError = e instanceof Error ? e.message : String(e);
    }
  }

  // Validate private key can be decoded
  if (privateKey && !privateKey.startsWith('replace-')) {
    try {
      const decoded = base64UrlDecode(privateKey);
      checks.privateKeyDecodedLength = decoded.length;
      checks.isValidPrivateKeyLength = decoded.length === 32;
    } catch (e) {
      checks.privateKeyDecodeError = e instanceof Error ? e.message : String(e);
    }
  }

  return c.json(checks);
});

app.get('/api/admin/subscriptions', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies.session ?? null;
  const userId = await getSessionUserId(c.env, token);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user || user.is_admin !== 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const result = await c.env.DB.prepare(
    `SELECT
      ps.user_id,
      ps.endpoint,
      ps.created_at as subscription_created,
      ns.enabled,
      ns.delivery_time,
      ns.timezone,
      ns.next_delivery_at
    FROM push_subscriptions ps
    LEFT JOIN notification_schedules ns ON ps.user_id = ns.user_id
    ORDER BY ps.created_at DESC
    LIMIT 100`
  ).all();

  return c.json({
    subscriptions: result.results.map((row) => ({
      ...row,
      endpointDomain: new URL(row.endpoint as string).host,
    })),
  });
});

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLength);
  return atob(base64);
}

function encodeAdminCursor(createdAt: string, id: string): string {
  return toBase64Url(`${createdAt}|${id}`);
}

function decodeAdminCursor(cursor: string): { createdAt: string; id: string } {
  const decoded = fromBase64Url(cursor);
  const [createdAt, id] = decoded.split('|');
  if (!createdAt || !id) {
    throw new Error('Invalid cursor');
  }
  return { createdAt, id };
}

app.get('/api/admin/users', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies.session ?? null;
  const userId = await getSessionUserId(c.env, token);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user || user.is_admin !== 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const url = new URL(c.req.url);
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

  const cursorParam = url.searchParams.get('cursor');
  let cursor: { createdAt: string; id: string } | null = null;
  if (cursorParam) {
    try {
      cursor = decodeAdminCursor(cursorParam);
    } catch {
      return c.json({ error: 'Invalid cursor' }, 400);
    }
  }

  const bindings: Array<string | number> = [];
  let cursorClause = '';
  if (cursor) {
    cursorClause = 'AND (u.created_at < ? OR (u.created_at = ? AND u.id < ?))';
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const result = await c.env.DB.prepare(
    `SELECT
      u.id,
      u.username,
      u.is_anonymous,
      u.is_admin,
      u.created_at
    FROM users u
    WHERE u.merged_into_user_id IS NULL
      AND u.is_anonymous = 0
      ${cursorClause}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ?`
  )
    .bind(...bindings, limit)
    .all();

  const users = result.results as Array<{
    id: string;
    username: string | null;
    is_anonymous: number;
    is_admin: number;
    created_at: string;
  }>;

  const userIds = users.map((row) => row.id);
  const passwordByUser = new Map<string, { email: string; createdAt: string }>();
  const oauthByUser = new Map<
    string,
    Array<{ provider: string; email: string | null; createdAt: string }>
  >();

  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(',');
    const passwordResult = await c.env.DB.prepare(
      `SELECT user_id, email, created_at FROM auth_email_password WHERE user_id IN (${placeholders})`
    )
      .bind(...userIds)
      .all();

    for (const row of passwordResult.results as Array<{
      user_id: string;
      email: string;
      created_at: string;
    }>) {
      if (!passwordByUser.has(row.user_id)) {
        passwordByUser.set(row.user_id, { email: row.email, createdAt: row.created_at });
      }
    }

    const oauthResult = await c.env.DB.prepare(
      `SELECT user_id, provider, email, created_at FROM auth_oauth WHERE user_id IN (${placeholders})`
    )
      .bind(...userIds)
      .all();

    for (const row of oauthResult.results as Array<{
      user_id: string;
      provider: string;
      email: string | null;
      created_at: string;
    }>) {
      const list = oauthByUser.get(row.user_id) ?? [];
      list.push({ provider: row.provider, email: row.email, createdAt: row.created_at });
      oauthByUser.set(row.user_id, list);
    }
  }

  const usersPayload = users.map((row) => {
    const password = passwordByUser.get(row.id);
    const oauthProviders = oauthByUser.get(row.id) ?? [];
    const authProviders: Array<{ provider: string; email: string | null; createdAt: string }> = [];

    if (password) {
      authProviders.push({
        provider: 'password',
        email: password.email,
        createdAt: password.createdAt,
      });
    }

    for (const provider of oauthProviders) {
      authProviders.push({
        provider: provider.provider,
        email: provider.email,
        createdAt: provider.createdAt,
      });
    }

    const email = password?.email ?? oauthProviders[0]?.email ?? null;

    return {
      id: row.id,
      username: row.username,
      email,
      isAnonymous: row.is_anonymous === 1,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at,
      authProviders,
    };
  });

  const lastUser = usersPayload[usersPayload.length - 1];
  const nextCursor =
    usersPayload.length === limit && lastUser
      ? encodeAdminCursor(lastUser.createdAt, lastUser.id)
      : null;

  return c.json({ users: usersPayload, nextCursor });
});

app.put('/api/admin/users/:id/admin', async (c) => {
  const cookies = parseCookies(c.req.header('cookie') ?? null);
  const token = cookies.session ?? null;
  const userId = await getSessionUserId(c.env, token);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await getUserById(c.env, userId);
  if (!user || user.is_admin !== 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const targetUserId = c.req.param('id');
  const body = await c.req.json();
  const parsed = z.object({ isAdmin: z.boolean() }).parse(body);

  // Prevent removing your own admin status
  if (targetUserId === userId && !parsed.isAdmin) {
    return c.json({ error: 'Cannot remove your own admin status' }, 400);
  }

  const targetUser = await getUserById(c.env, targetUserId);
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  await c.env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?')
    .bind(parsed.isAdmin ? 1 : 0, targetUserId)
    .run();

  return c.json({ ok: true, isAdmin: parsed.isAdmin });
});

app.get('/api/word/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) {
    return c.json({ error: 'Invalid word id' }, 400);
  }
  const word = await getWordById(c.env, id);
  if (!word) {
    return c.json({ error: 'Word not found' }, 404);
  }
  return c.json({ word: { ...word, examples: JSON.parse(word.examples_json) } });
});

app.onError((err, c) => {
  return c.json({ error: err.message ?? 'Server error' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    // Record cron heartbeat for monitoring
    await env.KV.put('cron:last_run', new Date().toISOString());
    const runCount = Number((await env.KV.get('cron:run_count')) || 0) + 1;
    await env.KV.put('cron:run_count', String(runCount));

    ctx.waitUntil(processDueSchedules(env));
  },
};

function computeInitialDelivery(timezone: string, deliveryTime: string): string {
  const [hour, minute] = deliveryTime.split(':').map(Number);
  const nowLocal = DateTime.now().setZone(timezone);
  const scheduled = nowLocal.set({ hour, minute, second: 0, millisecond: 0 });
  const next = scheduled <= nowLocal ? scheduled.plus({ days: 1 }) : scheduled;
  const iso = next.toUTC().toISO();
  if (!iso) {
    throw new Error('Invalid delivery time');
  }
  return iso;
}

function computeNextDeliveryFromTomorrow(timezone: string, deliveryTime: string): string {
  const [hour, minute] = deliveryTime.split(':').map(Number);
  const nextLocal = DateTime.now()
    .setZone(timezone)
    .plus({ days: 1 })
    .set({ hour, minute, second: 0, millisecond: 0 });
  const iso = nextLocal.toUTC().toISO();
  if (!iso) {
    throw new Error('Invalid delivery time');
  }
  return iso;
}

async function ensureDefaultSchedule(env: Env, userId: string, timezone: string): Promise<void> {
  const existing = await getNotificationSchedule(env, userId);
  if (existing) {
    return;
  }
  const nextDeliveryAt = computeInitialDelivery(timezone, DEFAULT_PREFERENCES.delivery_time);
  await upsertNotificationSchedule(env, {
    userId,
    deliveryTime: DEFAULT_PREFERENCES.delivery_time,
    timezone,
    enabled: false,
    nextDeliveryAt,
  });
}

async function ensureAnonymousRecord(env: Env, userId: string, timezone: string): Promise<void> {
  timeZoneSchema.parse(timezone);
  const existing = await getUserById(env, userId);
  if (!existing) {
    await createAnonymousUser(env, userId, timezone, DEFAULT_PREFERENCES);
    await ensureDefaultSchedule(env, userId, timezone);
  } else if (existing.is_anonymous !== 1 || existing.merged_into_user_id) {
    return;
  } else if (existing.timezone !== timezone) {
    await updateUserTimezone(env, userId, timezone);
  }
}
