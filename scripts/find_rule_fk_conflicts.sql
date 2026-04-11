-- Enumerate every table that has a rewrite rule AND an FK to enterprises
-- (directly or transitively via cascade) so we can see the full blast
-- radius of the audit_logs-style bug.

SELECT jsonb_build_object(
  'tables_with_rules', (
    SELECT json_agg(jsonb_build_object(
      'table', c.relname,
      'rule', r.rulename,
      'ev_type', r.ev_type,
      'instead', r.is_instead
    ))
    FROM pg_rewrite r
    JOIN pg_class c ON c.oid = r.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND r.rulename NOT IN ('_RETURN')  -- exclude view rules
  ),
  'fks_to_enterprises', (
    SELECT json_agg(jsonb_build_object(
      'table', cl.relname,
      'constraint', co.conname,
      'on_delete', co.confdeltype,
      'def', pg_get_constraintdef(co.oid)
    ))
    FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_class ref ON ref.oid = co.confrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE co.contype = 'f'
      AND ref.relname = 'enterprises'
      AND n.nspname = 'public'
  )
) AS report;
