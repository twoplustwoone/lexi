import { render } from 'preact';

import { App } from './App';
import './styles.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const buildId = import.meta.env.VITE_BUILD_ID as string | undefined;
    const swUrl = buildId ? `/sw.js?v=${buildId}` : '/sw.js';
    try {
      // Whether this page is already controlled has to be read before
      // registering: on a first visit it is not, and clients.claim() in the
      // worker fires controllerchange straight away.
      const hadController = Boolean(navigator.serviceWorker.controller);

      const registration = await navigator.serviceWorker.register(swUrl);
      registration.update().catch(() => undefined);

      // Reload only when a worker replaces one that was already in charge —
      // that is an update, and the page is running assets the new worker has
      // superseded. A first visit has nothing to refresh, so reloading there
      // is a blank flash on the very first thing a new user sees.
      if (!hadController) {
        return;
      }

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
