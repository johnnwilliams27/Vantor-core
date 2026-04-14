-- Probe to reconcile the $11.3M vs $9.1M split. Sums the same underlying
-- tables the two aggregation paths query so we can see where the delta
-- actually comes from on the dev test enterprise.

SELECT json_build_object(
  'bank_total', (
    SELECT COALESCE(SUM(CAST(current_balance AS NUMERIC)), 0)::text
    FROM bank_accounts
    WHERE is_active = true
  ),
  'wallet_balances_total', (
    SELECT COALESCE(SUM(CAST(usd_value AS NUMERIC)), 0)::text
    FROM wallet_balances
  ),
  'yield_positions_total', (
    SELECT COALESCE(SUM(CAST(current_value_usd AS NUMERIC)), 0)::text
    FROM yield_positions
    WHERE is_active = true
  ),
  'yield_positions_by_protocol', (
    SELECT json_agg(json_build_object(
      'protocol', protocol,
      'count', cnt,
      'total_usd', total
    ))
    FROM (
      SELECT protocol,
             COUNT(*) AS cnt,
             COALESCE(SUM(CAST(current_value_usd AS NUMERIC)), 0)::text AS total
      FROM yield_positions
      WHERE is_active = true
      GROUP BY protocol
    ) sub
  ),
  'wallet_balances_by_token', (
    SELECT json_agg(json_build_object(
      'token', token,
      'total_usd', total
    ))
    FROM (
      SELECT token, COALESCE(SUM(CAST(usd_value AS NUMERIC)), 0)::text AS total
      FROM wallet_balances
      GROUP BY token
    ) sub
  )
) AS report;
