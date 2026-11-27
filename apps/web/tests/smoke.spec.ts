import { expect, test, type Page } from '@playwright/test';

const defaultTodayWord = {
  day: '2024-01-02',
  word: 'luminary',
  wordPoolId: 1,
  detailsStatus: 'ready' as const,
  details: {
    word: 'luminary',
    phonetics: 'LOO-muh-nair-ee',
    audioUrl: null,
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: ['A person who inspires or influences others.'],
        examples: ['She is a luminary in the design world.'],
      },
    ],
    etymology: 'From Latin lumen, meaning light.',
    sourceUrl: null,
  },
};

const defaultHistory = [
  {
    word_id: 1,
    delivered_at: '2024-01-02T09:00:00.000Z',
    viewed_at: null,
    word: 'luminary',
    definition: 'A person who inspires or influences others.',
    etymology: 'From Latin lumen, meaning light.',
    pronunciation: 'LOO-muh-nair-ee',
    examples: ['She is a luminary in the design world.'],
  },
  {
    word_id: 2,
    delivered_at: '2024-01-01T09:00:00.000Z',
    viewed_at: null,
    word: 'sonder',
    definition: 'The realization that each passerby has a life as vivid as your own.',
    etymology: 'Coined in the Dictionary of Obscure Sorrows.',
    pronunciation: 'SON-der',
    examples: ['Traveling brought on a sudden sense of sonder.'],
  },
];

const defaultSettings = {
  schedule: {
    enabled: false,
    delivery_time: '09:00',
    timezone: 'America/New_York',
  },
  preferences: {
    version: 1,
    notification_enabled: false,
    delivery_time: '09:00',
    word_filters: {
      difficulty: 'balanced',
    },
  },
};

const defaultMe = {
  user_id: 'user-123',
  is_authenticated: false,
  is_anonymous: true,
  is_admin: false,
};

const defaultAdminStats = {
  users: {
    total: 42,
    anonymous: 30,
    authenticated: 12,
    admins: 1,
    byAuthMethod: { password: 7, google: 4, emailCode: 1 },
  },
  engagement: { totalWordsDelivered: 120, totalWordsViewed: 96, viewRate: 0.8 },
  notifications: { enabledCount: 9, disabledCount: 3, pushSubscriptions: 11 },
};

const defaultAdminTimeline = {
  userGrowth: [{ date: '2024-01-01', total: 40, authenticated: 11 }],
  wordsDelivered: [{ date: '2024-01-01', delivered: 12, viewed: 9 }],
  accountCreations: [{ date: '2024-01-01', password: 1, google: 1, emailCode: 0 }],
};

const defaultAdminActivity = {
  eventCounts: { word_viewed: 96, history_opened: 14 },
  clientBreakdown: { web: 20, pwa: 22 },
  recentEvents: [
    {
      event_name: 'word_viewed',
      timestamp: '2024-01-02T09:05:00.000Z',
      user_id: 'user-123',
      client: 'pwa',
    },
  ],
};

const defaultAdminUsers = [
  {
    id: 'admin-user',
    username: 'mira',
    email: 'mira@lexi.app',
    isAnonymous: false,
    isAdmin: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    lastReadAt: new Date().toISOString(),
    authProviders: [{ provider: 'google', email: 'mira@lexi.app', createdAt: '2024-01-01T00:00:00.000Z' }],
  },
  {
    id: 'reader-user',
    username: 'jonas',
    email: null,
    isAnonymous: false,
    isAdmin: false,
    // Well outside the seven-day window, so this reader reads as dormant.
    lastReadAt: '2024-01-02T00:00:00.000Z',
    createdAt: '2024-01-02T00:00:00.000Z',
    authProviders: [{ provider: 'password', email: 'jonas@lexi.app', createdAt: '2024-01-02T00:00:00.000Z' }],
  },
];

const defaultPoolHealth = {
  minimumAdvancedReadyWords: 25,
  advancedHealthy: false,
  byDifficulty: {
    advanced: { total: 27, enabled: 18, ready: 18, pending: 7, failed: 2, notFound: 0 },
    balanced: { total: 415, enabled: 412, ready: 412, pending: 3, failed: 0, notFound: 0 },
    easy: { total: 561, enabled: 560, ready: 560, pending: 0, failed: 0, notFound: 1 },
  },
  bySource: [],
  upcomingPreview: {
    advanced: [
      { id: 1, word: 'susurrus', tier: 3, source: 'seed', detailsStatus: 'ready' },
      { id: 2, word: 'petrichor', tier: 3, source: 'seed', detailsStatus: 'ready' },
    ],
    balanced: [],
    easy: [],
  },
};

const defaultReviewQueue = {
  words: [
    {
      id: 1,
      word: 'susurrus',
      enabled: false,
      tier: 3,
      difficultyCategory: 'advanced',
      source: 'seed',
      createdAt: '2024-01-02T00:00:00.000Z',
      detailsStatus: 'ready',
      reviewStatus: 'pending_review',
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
      fetchedAt: '2024-01-02T00:00:00.000Z',
      error: null,
      details: {
        word: 'susurrus',
        phonetics: '/s(j)uːˈsʌrəs/',
        audioUrl: null,
        meanings: [
          {
            partOfSpeech: 'noun',
            definitions: ['Whispering, murmuring, or rustling.'],
            examples: ['A susurrus of leaves ran along the hedgerow.'],
          },
        ],
        etymology: 'From Latin susurrus, a humming or whispering.',
      },
      rawPayload: null,
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

const defaultWordPool = {
  words: [
    {
      id: 10,
      word: 'evanescent',
      enabled: true,
      tier: 3,
      difficultyCategory: 'advanced',
      source: 'seed',
      createdAt: '2024-01-01T00:00:00.000Z',
      detailsStatus: 'ready',
      reviewStatus: 'approved',
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

const defaultAdminLogs = {
  logs: [
    {
      id: 'log-1',
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'subscription',
      user_id: 'reader-user',
      message: 'Daily notification failed',
      metadata: { status: 410 },
      created_at: new Date().toISOString(),
    },
  ],
};

type ApiOverrides = {
  me?: Partial<typeof defaultMe>;
  settings?: typeof defaultSettings;
  history?: typeof defaultHistory;
  word?: typeof defaultTodayWord;
  /** Delays every response, so serial round-trips become observable. */
  latencyMs?: number;
};

async function mockApi(page: Page, overrides: ApiOverrides = {}) {
  const me = { ...defaultMe, ...(overrides.me ?? {}) };
  const settings = overrides.settings ?? defaultSettings;
  const history = overrides.history ?? defaultHistory;
  const word = overrides.word ?? defaultTodayWord;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (overrides.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, overrides.latencyMs));
    }

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204 });
      return;
    }

    if (pathname === '/api/identity/anonymous') {
      await route.fulfill({ json: { ok: true } });
      return;
    }

    if (pathname === '/api/me') {
      await route.fulfill({ json: me });
      return;
    }

    if (pathname === '/api/word/today') {
      await route.fulfill({ json: word });
      return;
    }

    if (pathname === '/api/word/view') {
      await route.fulfill({ json: { ok: true } });
      return;
    }

    if (pathname === '/api/history') {
      await route.fulfill({ json: { history } });
      return;
    }

    if (pathname === '/api/settings') {
      if (request.method() === 'GET') {
        await route.fulfill({ json: settings });
        return;
      }
      if (request.method() === 'PUT') {
        await route.fulfill({ json: { ok: true } });
        return;
      }
    }

    if (pathname === '/api/events') {
      await route.fulfill({ json: { ok: true } });
      return;
    }

    if (pathname === '/api/admin/stats') {
      await route.fulfill({ json: defaultAdminStats });
      return;
    }

    if (pathname === '/api/admin/stats/timeline') {
      await route.fulfill({ json: defaultAdminTimeline });
      return;
    }

    if (pathname === '/api/admin/stats/activity') {
      await route.fulfill({ json: defaultAdminActivity });
      return;
    }

    if (pathname === '/api/admin/users') {
      await route.fulfill({ json: { users: defaultAdminUsers, nextCursor: null } });
      return;
    }

    if (pathname === '/api/admin/word-pool/health') {
      await route.fulfill({ json: defaultPoolHealth });
      return;
    }

    if (pathname === '/api/admin/word-pool/review') {
      await route.fulfill({ json: defaultReviewQueue });
      return;
    }

    if (pathname === '/api/admin/word-pool') {
      await route.fulfill({ json: defaultWordPool });
      return;
    }

    if (pathname === '/api/admin/word-pool/import') {
      await route.fulfill({ json: { created: 1, skipped: 0, filtered: 1, originalCount: 1 } });
      return;
    }

    if (pathname === '/api/admin/logs') {
      await route.fulfill({ json: defaultAdminLogs });
      return;
    }

    if (pathname === '/api/admin/notify') {
      await route.fulfill({
        json: {
          ok: true,
          results: [],
          target: { mode: 'self', userCount: 1, subscriptionCount: 0 },
          vapidSubject: 'mailto:test@example.com',
        },
      });
      return;
    }

    await route.fulfill({ json: { ok: true } });
  });
}

test('the stream opens on today\'s word with nothing above it', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  // Nothing sits above today's word but the wordmark and the date rule — no
  // tagline, no banner, no card.
  await expect(page.getByText('Lexi', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: defaultTodayWord.word })).toBeVisible();
  await expect(page.getByText(defaultTodayWord.details.meanings[0].definitions[0])).toBeVisible();
  await expect(page.getByText('Daily rituals, kept simple.')).toHaveCount(0);
  await expect(page.getByText('Turn on notifications to receive your word')).toHaveCount(0);

  // Two destinations, and the archive continues the same scroll surface.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('button', { name: 'Words' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'You' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'History' })).toHaveCount(0);
});

test('the reader never shows a loading sentence', async ({ page }) => {
  // Every call costs 1.2s, so any serial chain of round-trips is wide open.
  await mockApi(page, { latencyMs: 1200 });

  await page.goto('/', { waitUntil: 'commit' });

  // Sample every frame from navigation onward. Asserting visibility at a
  // moment proves nothing here — Playwright retries, so it would happily wait
  // out two loading screens and then pass. What matters is that no frame ever
  // contained one.
  const frames: string[] = [];
  for (let i = 0; i < 150; i += 1) {
    const text = await page
      .evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      .catch(() => '');
    if (text.trim()) frames.push(text);
    if (text.includes(defaultTodayWord.word)) break;
    await page.waitForTimeout(100);
  }

  expect(frames.some((frame) => frame.includes(defaultTodayWord.word))).toBe(true);
  expect(frames.filter((frame) => /Loading/i.test(frame))).toEqual([]);

  // The wordmark is local, so it precedes the word rather than arriving with
  // it. innerText reflects the CSS uppercase, hence the case-insensitive match.
  expect(frames[0]).toMatch(/lexi/i);

  // And the first-run invitation must never flash at a reader who has history.
  expect(frames.filter((frame) => frame.includes('This is the whole app'))).toEqual([]);
});

test('an archive entry expands in place, without accordion chrome', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  // The archive is part of the stream now, not a separate route.
  const entry = page.getByRole('button', { name: /sonder/ });
  await expect(entry).toBeVisible();
  await expect(page.locator('details')).toHaveCount(0);

  // A definition appears once per entry — the old grid printed it twice.
  await entry.click();
  await expect(page.getByRole('heading', { name: 'sonder' })).toBeVisible();
  await expect(
    page.getByText('The realization that each passerby has a life as vivid as your own.')
  ).toHaveCount(1);
});

test('the delivery time is chosen from presets on a sheet', async ({ page }) => {
  await mockApi(page);
  await page.goto('/you');

  // Settings and Account merged into You; the streak is stated once, here.
  await expect(page.getByRole('heading', { name: 'You' })).toBeVisible();
  await expect(page.getByText('Words kept')).toBeVisible();

  await page.getByRole('button', { name: /Delivery time/ }).click();

  // Presets rather than a time wheel.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Your daily word')).toBeVisible();
  await page.getByText('13:00').click();

  const requestPromise = page.waitForRequest(
    (req) => req.url().endsWith('/api/settings') && req.method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Turn on' }).click();
  const request = await requestPromise;
  expect((request.postDataJSON() as { delivery_time: string }).delivery_time).toBe('13:00');
});

test('enabling from the sheet keeps the time that was just chosen', async ({ page }) => {
  // A saved schedule that differs from the 09:00 fallback, so a draft seeded
  // before settings load would be visibly wrong.
  await mockApi(page, {
    settings: {
      schedule: { enabled: false, delivery_time: '21:00', timezone: 'America/New_York' },
      preferences: {
        version: 1,
        notification_enabled: false,
        delivery_time: '21:00',
        word_filters: { difficulty: 'balanced' },
      },
    },
  });

  const puts: Array<{ enabled: boolean; delivery_time: string }> = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/settings') && request.method() === 'PUT') {
      puts.push(request.postDataJSON() as { enabled: boolean; delivery_time: string });
    }
  });

  await page.goto('/you');
  await expect(page.getByRole('button', { name: /21:00/ })).toBeVisible();
  await page.getByRole('button', { name: /Delivery time/ }).click();
  await page.getByText('07:00').click();
  await page.getByRole('button', { name: 'Turn on' }).click();

  // The user-visible regression: a save could persist the delivery time this
  // render had captured — the old 21:00 — over the 07:00 just chosen. No write
  // may carry the stale value.
  await expect.poll(() => puts.length).toBeGreaterThan(0);
  expect(puts.every((put) => put.delivery_time === '07:00')).toBe(true);

  // Not asserted here: that it is a *single* write, and that `enabled` lands
  // true. Both depend on the push handshake completing, which needs a service
  // worker and a granted notification permission this suite withholds.
});

test('redirects non-admins away from the admin route', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'anon-user',
      is_authenticated: false,
      is_anonymous: true,
      is_admin: false,
    },
  });
  await page.goto('/admin');

  // The admin screen no longer hosts its own sign-in form — signing in happens
  // through the auth sheet, and anyone without the admin flag is sent back to
  // the daily word rather than shown a page they cannot use.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: defaultTodayWord.word })).toBeVisible();
});

test('opens the admin on Overview, with every figure answering a question', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'admin-user',
      is_authenticated: true,
      is_anonymous: false,
      is_admin: true,
    },
  });
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // No figure is titled with a category alone; each asks a question and answers
  // it in a sentence.
  await expect(page.getByText('Is the pool healthy?')).toBeVisible();
  await expect(page.getByText('No — advanced is')).toBeVisible();
  await expect(page.getByText('18 ready against a 25 minimum')).toBeVisible();
  await expect(page.getByText('Are people still reading?')).toBeVisible();
  await expect(page.getByText('How do people get in?')).toBeVisible();
  await expect(page.getByText('Did anything break?')).toBeVisible();

  // The queue count rides on Review so it is visible from any section.
  await expect(page.getByRole('navigation', { name: 'Admin sections' }).first()).toContainText('1');
});

test('the admin nav switches the view instead of stacking screens', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'admin-user',
      is_authenticated: true,
      is_anonymous: false,
      is_admin: true,
    },
  });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Admin sections' }).first();

  // Selecting Words replaces the dashboard rather than rendering beneath it.
  await nav.getByRole('button', { name: 'Words' }).click();
  await expect(page.getByRole('heading', { name: 'Words' })).toBeVisible();
  await expect(page.getByText('Is the pool healthy?')).toBeHidden();

  // People and Notifications are separate screens; they used to render the same
  // component.
  await nav.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  // The table and the phone list rows both exist; assert on the table cell.
  await expect(page.getByRole('cell', { name: 'mira@lexi.app' })).toBeVisible();

  await nav.getByRole('button', { name: /Notif/ }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Send a test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'mira@lexi.app' })).toBeVisible();
});

test('sends a test notification to the recipients picked inline', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'admin-user',
      is_authenticated: true,
      is_anonymous: false,
      is_admin: true,
    },
  });
  await page.goto('/admin');

  const nav = page.getByRole('navigation', { name: 'Admin sections' }).first();
  await nav.getByRole('button', { name: /Notif/ }).click();

  // The recipient picker sits with the composer it controls.
  await page.getByRole('button', { name: 'mira@lexi.app' }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Test notification');

  const requestPromise = page.waitForRequest((req) => req.url().endsWith('/api/admin/notify'));
  await page.getByRole('button', { name: 'Send to 1' }).click();
  const request = await requestPromise;
  const payload = request.postDataJSON() as { target: string; userIds: string[]; body: string };
  expect(payload.target).toBe('custom');
  expect(payload.userIds).toEqual(['admin-user']);
  expect(payload.body).toBe('Test notification');
});

test('review rejects only once a note is entered', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'admin-user',
      is_authenticated: true,
      is_anonymous: false,
      is_admin: true,
    },
  });
  await page.goto('/admin');

  const nav = page.getByRole('navigation', { name: 'Admin sections' }).first();
  await nav.getByRole('button', { name: /Review/ }).click();

  await expect(page.getByRole('heading', { name: 'susurrus' })).toBeVisible();
  await expect(page.getByText('Why it was flagged')).toBeVisible();

  // A note is required to reject, optional to approve.
  const reject = page.getByRole('button', { name: 'Reject' });
  await expect(reject).toBeDisabled();
  await page.getByRole('textbox', { name: 'Review note' }).fill('Definition is wrong.');
  await expect(reject).toBeEnabled();
});

test('anonymous readers can reach their settings from the tab bar', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'anon-user',
      is_authenticated: false,
      is_anonymous: true,
      is_admin: false,
    },
  });
  await page.goto('/');

  // Notification delivery is the whole product and anonymous use is supported,
  // so the schedule must be reachable without an account.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'You' }).click();
  await expect(page.getByRole('heading', { name: 'You' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Delivery time/ })).toBeVisible();

  // The sync upsell lives here and nowhere else.
  await expect(page.getByRole('button', { name: 'Sign in to sync' })).toBeVisible();
});

test('notification setup is offered on day one, not as a daily banner', async ({ page }) => {
  // A first visit has no archive behind it.
  await mockApi(page, { history: [] });
  await page.goto('/');

  await expect(page.getByText('This is the whole app')).toBeVisible();
  await page.getByRole('button', { name: 'Choose a delivery time' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Your daily word')).toBeVisible();
});

test('the daily reading carries no banner once the stream has history', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  // One prompt, once: nothing re-asks on every daily word.
  await expect(page.getByText('This is the whole app')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose a delivery time' })).toHaveCount(0);
  await expect(page.getByText('Turn on notifications')).toHaveCount(0);
});

test('adding a word writes to the pool the app actually reads', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'admin-user',
      is_authenticated: true,
      is_anonymous: false,
      is_admin: true,
    },
  });
  await page.goto('/admin');

  const nav = page.getByRole('navigation', { name: 'Admin sections' }).first();
  await nav.getByRole('button', { name: 'Words' }).click();
  await expect(page.getByRole('heading', { name: 'Words' })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept('susurrus'));

  // The legacy /admin/words table is neither what this screen lists nor what
  // daily selection draws from, so an add must go to the pool.
  const requestPromise = page.waitForRequest(
    (req) => req.url().endsWith('/api/admin/word-pool/import') && req.method() === 'POST'
  );
  await page.getByRole('button', { name: 'Add a word' }).click();
  const request = await requestPromise;
  expect((request.postDataJSON() as { words: string[] }).words).toEqual(['susurrus']);

  await expect(page.getByText('Added 1 to the pool.')).toBeVisible();
});
