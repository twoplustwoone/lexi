import { expect, test } from '@playwright/test';

/**
 * A layout-shift budget for the reader.
 *
 * The complaint this encodes: the page settled, then more of it arrived and
 * pushed what was already there. The worst offender was a 44px search target
 * dropping into an 18px wordmark row once history loaded, moving the entire
 * page down 25px.
 */
const word = {
  day: new Date().toISOString().slice(0, 10),
  word: 'evanescent',
  wordPoolId: 1,
  detailsStatus: 'ready' as const,
  details: {
    word: 'evanescent',
    phonetics: '/ˌɛvəˈnɛsənt/',
    audioUrl: null,
    meanings: [
      {
        partOfSpeech: 'adjective',
        definitions: ['Soon passing out of sight, memory, or existence; quickly fading.'],
        examples: ['The evanescent glow of fireflies lasted only a few minutes.'],
      },
    ],
    etymology: 'From Latin evanescere, to vanish.',
    sourceUrl: null,
  },
};

const history = ['2026-08-23', '2026-08-22', '2026-07-18'].map((d, i) => ({
  word_id: i + 2,
  delivered_at: `${d}T09:00:00.000Z`,
  delivered_on: d,
  viewed_at: null,
  word: ['quiescent', 'temerity', 'jejune'][i],
  definition: 'A definition sitting under the word in the archive list.',
  etymology: 'From Latin.',
  pronunciation: '/x/',
  examples: ['An example.'],
}));

const settings = {
  schedule: { enabled: false, delivery_time: '09:00', timezone: 'UTC' },
  preferences: {
    version: 1,
    notification_enabled: false,
    delivery_time: '09:00',
    word_filters: { difficulty: 'balanced' },
  },
};

/** Google's "good" threshold is 0.1; this app has no excuse for anything near it. */
const BUDGET = 0.01;

const SCENARIOS = [
  { name: 'stream, returning reader', path: '/', history },
  { name: 'stream, first visit', path: '/', history: [] },
  { name: 'you', path: '/you', history },
];

for (const scenario of SCENARIOS) {
  test(`layout shift stays within budget: ${scenario.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Latency on both the data and the fonts, so anything that arrives late
    // enough to push the page has room to do so.
    await page.route('**/fonts/*.woff2', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (pathname === '/api/word/today') return route.fulfill({ json: word });
      if (pathname === '/api/history') return route.fulfill({ json: { history: scenario.history } });
      if (pathname === '/api/me') {
        return route.fulfill({
          json: { user_id: 'u', is_authenticated: false, is_anonymous: true, is_admin: false },
        });
      }
      if (pathname === '/api/settings') return route.fulfill({ json: settings });
      return route.fulfill({ json: { ok: true } });
    });

    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) {
            (window as unknown as { __cls: number }).__cls += shift.value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    await page.goto(scenario.path);
    await page.waitForTimeout(3500);

    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(BUDGET);
  });
}
