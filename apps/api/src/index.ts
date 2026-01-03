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
  phoneSchema,
  pushSubscriptionSchema,
  timeZoneSchema,
  uuidSchema,
} from '@word-of-the-day/shared';

import { buildServerEvent, recordEvent } from './analytics';
import { sendEmailCode } from './auth/email';
import { verifyGoogleIdToken } from './auth/google';
import { resolveUserId } from './auth/identity';
import { mergeAnonymousIntoUser } from './auth/merge';
import { buildExpiry, createCodeHash, generateNumericCode } from './auth/otp';
import {
  buildSessionCookie,
  clearSession,
  createSession,
  getSessionUserId,
  parseCookies,
} from './auth/sessions';
import { sendSmsCode } from './auth/sms';
import { Env, NotificationJob } from './env';
import {
  createAnonymousUser,
  getNotificationSchedule,
  getUserById,
  updateUserPreferences,
  updateUserTimezone,
  upsertNotificationSchedule,
} from './db';
import { processNotificationQueue } from './notifications/consumer';
import { sendWebPushNotification } from './notifications/push';
import { processDueSchedules } from './notifications/scheduler';
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
  } else if (existing.timezone !== parsed.timezone) {
    await updateUserTimezone(c.env, parsed.id, parsed.timezone);
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
  const anonId = c.req.header('x-anon-id');
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
  const body = await c.req.json();
  const parsed = z.object({ endpoint: z.string().url() }).parse(body);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
    .bind(parsed.endpoint)
    .run();
  return c.json({ ok: true });
});

app.post('/api/events', async (c) => {
  const body = await c.req.json();
  const parsed = eventSchema.parse(body);
  await recordEvent(c.env, parsed);
  return c.json({ ok: true });
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

  const anonId = c.req.header('x-anon-id');
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
    'INSERT INTO auth_email_password (user_id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(userId, parsed.email, passwordHash, DateTime.utc().toISO())
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
  const anonId = c.req.header('x-anon-id');
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
  let createdAccount = false;
  const authUser = await c.env.DB.prepare('SELECT user_id FROM auth_email_password WHERE email = ?')
    .bind(parsed.email)
    .first();
  if (authUser) {
    userId = authUser.user_id as string;
  } else {
    const anonId = c.req.header('x-anon-id');
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
      'INSERT INTO auth_email_password (user_id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(userId, parsed.email, hashPassword(crypto.randomUUID()), DateTime.utc().toISO())
      .run();
  }

  if (!userId) {
    return c.json({ error: 'Unable to complete login' }, 500);
  }

  const anonId = c.req.header('x-anon-id');
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

app.post('/api/auth/phone/code/request', async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ phone: phoneSchema }).parse(body);
  const code = generateNumericCode();
  const { hash, salt } = createCodeHash(code);
  await c.env.DB.prepare(
    'INSERT INTO auth_codes (id, target, code_hash, salt, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      parsed.phone,
      hash,
      salt,
      'phone_code',
      buildExpiry(10),
      DateTime.utc().toISO()
    )
    .run();

  await sendSmsCode(c.env, parsed.phone, code);

  return c.json({ ok: true });
});

app.post('/api/auth/phone/code/verify', async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ phone: phoneSchema, code: z.string().min(4) }).parse(body);
  const record = await c.env.DB.prepare(
    `SELECT * FROM auth_codes WHERE target = ? AND purpose = 'phone_code' AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(parsed.phone)
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
  let createdAccount = false;
  const existingPhone = await c.env.DB.prepare('SELECT user_id FROM auth_phone WHERE phone = ?')
    .bind(parsed.phone)
    .first();
  if (existingPhone) {
    userId = existingPhone.user_id as string;
  } else {
    const anonId = c.req.header('x-anon-id');
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
    await c.env.DB.prepare('INSERT INTO auth_phone (user_id, phone, created_at) VALUES (?, ?, ?)')
      .bind(userId, parsed.phone, DateTime.utc().toISO())
      .run();
  }

  const anonId = c.req.header('x-anon-id');
  if (anonId && anonId !== userId) {
    await mergeAnonymousIntoUser(c.env, anonId, userId);
  }

  const session = await createSession(c.env, userId);
  c.header('Set-Cookie', buildSessionCookie(c.env, session.token));

  if (createdAccount) {
    await recordEvent(
      c.env,
      buildServerEvent({ name: 'account_created', userId, metadata: { method: 'phone_code' } })
    );
  }
  await recordEvent(
    c.env,
    buildServerEvent({ name: 'auth_method_used', userId, metadata: { method: 'phone_code' } })
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
    const anonId = c.req.header('x-anon-id');
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

  const anonId = c.req.header('x-anon-id');
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

  const result = await ensureDailyWordForUser(c.env, {
    userId,
    timezone: user.timezone,
  });

  if (c.env.APP_ENV === 'development') {
    const statuses: number[] = [];
    for (const sub of subscriptions.results as Array<{ endpoint: string }>) {
      try {
        const response = await sendWebPushNotification({
          endpoint: sub.endpoint,
          publicKey: c.env.VAPID_PUBLIC_KEY,
          privateKey: c.env.VAPID_PRIVATE_KEY,
          subject: c.env.VAPID_SUBJECT,
        });
        statuses.push(response.status);
        if (response.status === 404 || response.status === 410) {
          await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
            .bind(sub.endpoint)
            .run();
        }
      } catch {
        statuses.push(0);
      }
    }
    return c.json({ ok: true, mode: 'direct', statuses });
  }

  await c.env.NOTIFICATION_QUEUE.send({
    userId,
    wordId: result.word.id,
    dateKey: result.dateKey,
  });

  return c.json({ ok: true });
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
    ctx.waitUntil(processDueSchedules(env));
  },
  queue: async (batch: MessageBatch<NotificationJob>, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(processNotificationQueue(env, batch));
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
  } else if (existing.timezone !== timezone) {
    await updateUserTimezone(env, userId, timezone);
  }
}
