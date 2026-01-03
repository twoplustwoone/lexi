import { render } from 'preact';

import { App } from './App';
import './styles.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
