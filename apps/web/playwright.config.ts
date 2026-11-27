import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // The app's service worker uses cache-first on same-origin GETs and reloads
    // the page on controllerchange, which makes navigation nondeterministic here.
    serviceWorkers: 'block',
  },
});
