// Compile-time check that every template produces IR matching the
// recursive Condition schema. These failed silently in production
// before — the server-side Zod parse rejected them with 400.

import { describe, it, expect } from 'vitest';
import { RULE_TEMPLATES } from './templates';
import { conditionSchema } from './schemas/ir.schema';

describe('RULE_TEMPLATES', () => {
  it.each(RULE_TEMPLATES.map((t) => [t.id, t]))(
    'template %s produces schema-valid IR with default values',
    (_id, t) => {
      const values: Record<string, string | number> = {};
      for (const f of t.fields) values[f.key] = f.defaultValue;
      const rule = t.build({ name: t.title, values });
      const parsed = conditionSchema.safeParse(rule.condition);
      if (!parsed.success) {
        // eslint-disable-next-line no-console
        console.error(`${t.id}:`, JSON.stringify(parsed.error.flatten(), null, 2));
      }
      expect(parsed.success).toBe(true);
    },
  );
});
