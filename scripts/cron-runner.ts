/**
 * Local cron runner — fires all cron endpoints on their configured schedules.
 * Mirrors the Vercel cron configuration so the same schedules apply in dev.
 *
 * Usage:
 *   npm run cron
 *
 * Required env vars (loaded from .env.local via --env-file):
 *   CRON_SECRET    — must match the value checked in each cron route
 *   APP_URL        — base URL of the running Next.js app (default: http://localhost:3000)
 */
import cron from 'node-cron';

const BASE_URL = process.env.APP_URL ?? 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

if (!CRON_SECRET) {
  console.warn('[cron-runner] Warning: CRON_SECRET is not set — all cron calls will return 401');
}

async function callCron(path: string): Promise<void> {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const body = await res.json().catch(() => null);
    if (res.ok) {
      console.log(`[cron] ${path} → ${res.status}`, body);
    } else {
      console.error(`[cron] ${path} → ${res.status}`, body);
    }
  } catch (err) {
    console.error(`[cron] ${path} failed:`, err);
  }
}

// Every minute: process due scheduled payments
cron.schedule('* * * * *', () => {
  callCron('/api/cron/process-scheduled-payments');
});

// Every 5 minutes: poll on-chain wallet balances
cron.schedule('*/5 * * * *', () => {
  callCron('/api/cron/poll-balances');
});

// Every 6 hours: generate treasury recommendations + refresh forecasts
cron.schedule('0 */6 * * *', () => {
  callCron('/api/cron/treasury-analysis');
});

console.log('[cron-runner] Started. Schedules:');
console.log('  * * * * *      → /api/cron/process-scheduled-payments');
console.log('  */5 * * * *    → /api/cron/poll-balances');
console.log('  0 */6 * * *    → /api/cron/treasury-analysis');
console.log('[cron-runner] Press Ctrl+C to stop.');
