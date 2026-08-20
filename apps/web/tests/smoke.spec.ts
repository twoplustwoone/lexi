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

type ApiOverrides = {
  me?: Partial<typeof defaultMe>;
  settings?: typeof defaultSettings;
  history?: typeof defaultHistory;
  word?: typeof defaultTodayWord;
};

async function mockApi(page: Page, overrides: ApiOverrides = {}) {
  const me = { ...defaultMe, ...(overrides.me ?? {}) };
  const settings = overrides.settings ?? defaultSettings;
  const history = overrides.history ?? defaultHistory;
  const word = overrides.word ?? defaultTodayWord;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

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
      await route.fulfill({ json: { users: [], nextCursor: null } });
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

test("renders the home view with today's word", async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByText('Lexi', { exact: true })).toBeVisible();
  await expect(page.getByText("Today's word")).toBeVisible();
  await expect(page.getByRole('heading', { name: defaultTodayWord.word })).toBeVisible();
  await expect(page.getByText(defaultTodayWord.details.meanings[0].definitions[0])).toBeVisible();
});

test('shows collapsible history entries', async ({ page }) => {
  await mockApi(page);
  await page.goto('/history');
  await expect(page.getByText('History')).toBeVisible();

  const details = page.locator('details').first();
  const summary = details.locator('summary');
  await expect(details.locator('text=Etymology')).toBeHidden();
  await summary.click();
  await expect(details.locator('text=Etymology')).toBeVisible();
});

test('saves updated delivery time in settings', async ({ page }) => {
  await mockApi(page);
  await page.goto('/settings');

  const timeInput = page.getByLabel('Delivery time');
  await timeInput.fill('10:30');

  const requestPromise = page.waitForRequest(
    (req) => req.url().endsWith('/api/settings') && req.method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Save settings' }).click();
  const request = await requestPromise;
  const payload = request.postDataJSON() as {
    delivery_time: string;
    word_filters?: { difficulty?: string };
  };
  expect(payload.delivery_time).toBe('10:30');
  expect(payload.word_filters?.difficulty).toBe('balanced');
  await expect(page.getByText('Saved. Changes apply next day.')).toBeVisible();
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
  await expect(page.getByText("Today's word")).toBeVisible();
});

test('shows admin actions when authenticated as admin', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'admin-user',
      is_authenticated: true,
      is_anonymous: false,
      is_admin: true,
    },
  });
  await page.goto('/admin');
  await expect(page.getByText('Signed in as admin-user')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  // Sending a push lives behind the Notifications tab; the screen opens on the
  // dashboard.
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByRole('button', { name: 'Send now' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Title' }).fill('Test notification');
  const requestPromise = page.waitForRequest((req) => req.url().endsWith('/api/admin/notify'));
  await page.getByRole('button', { name: 'Send now' }).click();
  await requestPromise;
});

test('anonymous users can reach settings from the main nav', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'anon-user',
      is_authenticated: false,
      is_anonymous: true,
      is_admin: false,
    },
  });
  await page.goto('/');

  // The nav must expose Settings without an account: notification delivery is
  // the whole product, and anonymous use is a supported mode.
  const settingsLink = page.getByRole('link', { name: 'Settings' });
  await expect(settingsLink).toBeVisible();

  await settingsLink.click();
  await expect(page.getByLabel('Delivery time')).toBeVisible();
});

test('the home reminder banner links to settings', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  const bannerLink = page.getByRole('link', { name: 'Open settings' });
  await expect(bannerLink).toBeVisible();
  await bannerLink.click();
  await expect(page.getByLabel('Delivery time')).toBeVisible();
});
