import { expect, test, type Page } from '@playwright/test';

const defaultWord = {
  id: 1,
  word: 'luminary',
  definition: 'A person who inspires or influences others.',
  etymology: 'From Latin lumen, meaning light.',
  pronunciation: 'LOO-muh-nair-ee',
  examples: ['She is a luminary in the design world.'],
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
  },
};

const defaultMe = {
  user_id: 'user-123',
  is_authenticated: false,
  is_anonymous: true,
  is_admin: false,
};

type ApiOverrides = {
  me?: Partial<typeof defaultMe>;
  settings?: typeof defaultSettings;
  history?: typeof defaultHistory;
  word?: typeof defaultWord;
};

async function mockApi(page: Page, overrides: ApiOverrides = {}) {
  const me = { ...defaultMe, ...(overrides.me ?? {}) };
  const settings = overrides.settings ?? defaultSettings;
  const history = overrides.history ?? defaultHistory;
  const word = overrides.word ?? defaultWord;

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
      await route.fulfill({ json: { date: '2024-01-02', word } });
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

    if (pathname === '/api/admin/notify') {
      await route.fulfill({ json: { ok: true } });
      return;
    }

    await route.fulfill({ json: { ok: true } });
  });
}

test("renders the home view with today's word", async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByText('Word of the Day')).toBeVisible();
  await expect(page.getByText("Today's word")).toBeVisible();
  await expect(page.getByText(defaultWord.word)).toBeVisible();
  await expect(page.getByText(defaultWord.definition)).toBeVisible();
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
  const payload = request.postDataJSON() as { delivery_time: string };
  expect(payload.delivery_time).toBe('10:30');
  await expect(page.getByText('Saved. Changes apply next day.')).toBeVisible();
});

test('shows sign-in options when signed out', async ({ page }) => {
  await mockApi(page, {
    me: {
      user_id: 'anon-user',
      is_authenticated: false,
      is_anonymous: true,
      is_admin: false,
    },
  });
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Email + Password' })).toBeVisible();
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
  await page.goto('/account');
  await expect(page.getByText('Signed in as admin-user')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send test notification' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);

  const requestPromise = page.waitForRequest((req) =>
    req.url().endsWith('/api/admin/notify')
  );
  await page.getByRole('button', { name: 'Send test notification' }).click();
  await requestPromise;
});
