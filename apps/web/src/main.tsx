import { render } from 'preact';

import { App } from './App';
import './styles.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const buildId = import.meta.env.VITE_BUILD_ID as string | undefined;
    const swUrl = buildId ? `/sw.js?v=${buildId}` : '/sw.js';
    try {
      const registration = await navigator.serviceWorker.register(swUrl);
      registration.update().catch(() => undefined);
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch {
      // No-op if SW registration fails (e.g., private mode or unsupported).
    }
  });
}

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
