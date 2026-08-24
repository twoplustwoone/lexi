import { expect, test } from '@playwright/test';

// The rest of the suite blocks service workers, because cache-first responses
// make navigation nondeterministic. These tests deliberately allow one, since
// the behaviour under test is the worker taking control.
test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('takes control on a first visit without reloading the page', async ({ page }) => {
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations += 1;
      }
    });

    await page.goto('/');

    // clients.claim() makes the worker take over the page that registered it.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 20000,
    });

    // A reload triggered by controllerchange would land shortly after control
    // is taken, so give one time to happen before asserting it did not.
    await page.waitForTimeout(2500);

    // goto is the one navigation there should ever be. A first visit has no
    // superseded assets to refresh, so reloading is a blank flash for nothing.
    expect(mainFrameNavigations).toBe(1);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'You' })
    ).toBeVisible();
  });

  test('renders the app while controlled by the worker', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 20000,
    });

    // Second visit: this one loads through the worker's caches rather than
    // straight from the network.
    await page.reload();
    await expect(page.getByText('Lexi', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Words' })
    ).toBeVisible();
  });
});
