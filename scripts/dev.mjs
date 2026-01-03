import { spawn } from 'node:child_process';
import os from 'node:os';

function findLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return 'localhost';
}

const ip = findLocalIp();
const webUrl = `http://${ip}:5173`;
const apiUrl = `http://${ip}:8787/api`;
const corsAllow = `http://localhost:5173,${webUrl}`;

console.log(`Local network web: ${webUrl}`);
console.log(`Local network API: ${apiUrl}`);
console.log('Note: push notifications require HTTPS on mobile browsers.');

const web = spawn('npm', ['run', 'dev', '--prefix', 'apps/web', '--', '--host'], {
  stdio: 'inherit',
});

const api = spawn(
  'npm',
  [
    'run',
    'dev',
    '--prefix',
    'apps/api',
    '--',
    '--ip',
    '0.0.0.0',
    '--var',
    `CORS_ALLOW_ORIGIN=${corsAllow}`,
  ],
  {
    stdio: 'inherit',
  }
);

const shutdown = () => {
  web.kill('SIGINT');
  api.kill('SIGINT');
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
