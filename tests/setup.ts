// Vitest global setup: load .env.local so integration tests can reach
// the dev Supabase project via NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Vitest does not auto-load .env.local (Vite only surfaces VITE_* vars by default),
// so we wire dotenv here explicitly. Tests that don't need DB access are unaffected.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import '@testing-library/jest-dom/vitest';

loadEnv({ path: resolve(__dirname, '..', '.env.local') });
