/**
 * Migration runner — POSTs SQL to Supabase Management API
 * Usage: npx tsx scripts/migrate.ts supabase/migrations/0004_banking.sql
 *
 * Requires env: SUPABASE_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL
 */
import fs from 'fs';
import path from 'path';

const PROJECT_REF = process.env.NEXT_PUBLIC_SUPABASE_URL
  ?.replace('https://', '')
  .split('.')[0] ?? '';

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? '';

async function runMigration(sqlFile: string) {
  if (!PROJECT_REF) {
    console.error('NEXT_PUBLIC_SUPABASE_URL not set');
    process.exit(1);
  }
  if (!ACCESS_TOKEN) {
    console.error('SUPABASE_ACCESS_TOKEN not set — get one from https://supabase.com/dashboard/account/tokens');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), sqlFile);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(filePath, 'utf-8');
  console.log(`Running migration: ${sqlFile}`);
  console.log(`Project: ${PROJECT_REF}`);

  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error(`Migration failed (HTTP ${res.status}):`);
    console.error(text);
    process.exit(1);
  }

  console.log('Migration applied successfully.');
  try {
    const json = JSON.parse(text);
    if (json) console.log(JSON.stringify(json, null, 2));
  } catch {
    if (text) console.log(text);
  }
}

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: npx tsx scripts/migrate.ts <sql-file>');
  process.exit(1);
}

runMigration(sqlFile).catch((err) => {
  console.error(err);
  process.exit(1);
});
