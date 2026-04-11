/**
 * Migration runner — POSTs SQL to Supabase Management API
 * Usage: npx tsx scripts/migrate.ts supabase/migrations/0004_banking.sql
 *
 * Requires env: SUPABASE_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL
 *
 * On success, also inserts a row into `supabase_migrations.schema_migrations`
 * so the tracker stays in sync going forward. Migrations applied before
 * 2026-04-11 are NOT backfilled — see the "Migrations" note in CLAUDE.md
 * for the cutover line and the rationale.
 */
import fs from 'fs';
import path from 'path';

const PROJECT_REF = process.env.NEXT_PUBLIC_SUPABASE_URL
  ?.replace('https://', '')
  .split('.')[0] ?? '';

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? '';

interface QueryResult {
  ok: boolean;
  status: number;
  body: string;
}

async function postQuery(query: string): Promise<QueryResult> {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

/**
 * Parse a migration filename like "0038_policy_engine_schema.sql" into
 * { version: "0038", name: "policy_engine_schema" }. Returns null if the
 * filename doesn't follow the expected NNNN_name.sql pattern.
 */
function parseMigrationFilename(filename: string): { version: string; name: string } | null {
  const match = /^(\d+)_(.+)\.sql$/.exec(filename);
  if (!match) return null;
  return { version: match[1], name: match[2] };
}

/**
 * Insert a tracker row for the just-applied migration.
 *
 * Idempotent via `WHERE NOT EXISTS` so re-running an already-applied migration
 * doesn't error and doesn't require a unique constraint on `version`. Only
 * writes the three columns that exist on both dev and prod (version, name,
 * statements); prod-specific columns (created_by, idempotency_key, rollback)
 * stay NULL — those weren't being populated by anything before, so this is
 * consistent with the historical state.
 *
 * The full SQL is stored as a single-element `statements` array via Postgres
 * dollar-quoting. We deliberately do NOT split on semicolons (which would be
 * lossy and dangerous around dollar-quoted bodies, comments, and string
 * literals). Existing pre-cutover rows have multi-element arrays from
 * Supabase's own tooling, but a single-element array is a valid `text[]` and
 * any tool that reads `statements` for replay can still concat them.
 *
 * Failures here are NON-FATAL — the actual migration already applied — but
 * are reported loudly so the operator can patch the tracker by hand if it
 * matters for the use case at hand.
 */
async function recordTrackerRow(filename: string, sql: string): Promise<void> {
  const parsed = parseMigrationFilename(filename);
  if (!parsed) {
    console.warn(`[tracker] Skipping tracker insert: filename "${filename}" doesn't match NNNN_name.sql pattern.`);
    return;
  }

  // Dollar-quote tag must not appear inside the SQL body. If a future
  // migration ever contains this exact tag, refuse to write rather than
  // corrupt the stored SQL.
  const TAG = 'ECCMIGSTMT';
  const dollarTag = `$${TAG}$`;
  if (sql.includes(dollarTag)) {
    console.warn(`[tracker] Skipping tracker insert: migration body contains the dollar-quote tag ${dollarTag}.`);
    console.warn(`[tracker] Pick a different tag in scripts/migrate.ts and re-run, or insert the row manually.`);
    return;
  }

  // Defensive escape: filename literals shouldn't contain single quotes, but
  // if they ever do, double them so we don't break out of the literal.
  const versionLit = parsed.version.replace(/'/g, "''");
  const nameLit = parsed.name.replace(/'/g, "''");

  const insertSql = `
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    SELECT '${versionLit}', '${nameLit}', ARRAY[${dollarTag}${sql}${dollarTag}]
    WHERE NOT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${versionLit}'
    );
  `;

  const result = await postQuery(insertSql);
  if (!result.ok) {
    console.warn(`[tracker] Tracker insert failed (HTTP ${result.status}). The migration itself was applied successfully — only the tracker row is missing.`);
    console.warn(`[tracker] Response: ${result.body}`);
    console.warn(`[tracker] You can patch the tracker by hand. See CLAUDE.md → Migrations.`);
    return;
  }
  console.log(`[tracker] Recorded ${parsed.version}_${parsed.name} in supabase_migrations.schema_migrations.`);
}

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

  const result = await postQuery(sql);

  if (!result.ok) {
    console.error(`Migration failed (HTTP ${result.status}):`);
    console.error(result.body);
    process.exit(1);
  }

  console.log('Migration applied successfully.');
  try {
    const json = JSON.parse(result.body);
    if (json) console.log(JSON.stringify(json, null, 2));
  } catch {
    if (result.body) console.log(result.body);
  }

  await recordTrackerRow(path.basename(filePath), sql);
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
