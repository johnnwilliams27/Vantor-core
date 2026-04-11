-- Single-row diagnostic: merges FK, rules, counts into one JSON row so the
-- Supabase Management API returns it all.

SELECT json_build_object(
  'fk', (
    SELECT json_agg(json_build_object(
      'conname', conname,
      'on_delete', confdeltype,
      'def', pg_get_constraintdef(oid)
    ))
    FROM pg_constraint
    WHERE conrelid = 'audit_logs'::regclass
      AND contype = 'f'
      AND conname LIKE '%enterprise%'
  ),
  'rules', (
    SELECT json_agg(json_build_object(
      'name', rulename,
      'ev_type', ev_type,
      'instead', is_instead,
      'enabled', ev_enabled
    ))
    FROM pg_rewrite
    WHERE ev_class = 'audit_logs'::regclass
  ),
  'enterprise_counts', (
    SELECT json_build_object(
      'total', COUNT(*),
      'test_named', COUNT(*) FILTER (WHERE name LIKE 'test-%')
    )
    FROM enterprises
  ),
  'audit_logs_counts', (
    SELECT json_build_object(
      'with_enterprise_id', COUNT(*),
      'for_test_enterprises', COUNT(*) FILTER (
        WHERE enterprise_id IN (SELECT id FROM enterprises WHERE name LIKE 'test-%')
      )
    )
    FROM audit_logs
  ),
  'orphaned_audit_logs', (
    SELECT COUNT(*)
    FROM audit_logs al
    WHERE al.enterprise_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM enterprises e WHERE e.id = al.enterprise_id)
  ),
  'orphaned_forecast_snapshots', (
    SELECT COUNT(*)
    FROM forecast_snapshots fs
    WHERE NOT EXISTS (SELECT 1 FROM enterprises e WHERE e.id = fs.enterprise_id)
  ),
  'orphaned_treasury_state_snapshots', (
    SELECT COUNT(*)
    FROM treasury_state_snapshots tss
    WHERE NOT EXISTS (SELECT 1 FROM enterprises e WHERE e.id = tss.enterprise_id)
  )
) AS report;
