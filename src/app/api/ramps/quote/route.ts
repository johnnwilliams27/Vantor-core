import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { writeAuditLog } from '@/lib/audit/logger';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { isTestMode } from '@/lib/test-mode/helpers';
import { calculateVantorFee } from '@/lib/billing/usage';
import { z } from 'zod';

const schema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  cryptoToken: z.enum(['USDC', 'USDT']),
  fiatCurrency: z.string().default('USD'),
  cryptoAmount: z.number().positive().optional(),
  fiatAmount: z.number().positive().optional(),
}).refine((d) => d.cryptoAmount !== undefined || d.fiatAmount !== undefined, {
  message: 'Provide either cryptoAmount or fiatAmount',
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('ramps-quote', session.user.id, 20, 60 * 60 * 1000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });

  try {
    const mode = getIntegrationMode(session.user.subscription_tier);
    const adapter = getBankingAdapter(mode);
    const quote = await adapter.getRampQuote(parsed.data);

    const testMode = isTestMode();
    const vantorFee = testMode ? 0 : calculateVantorFee(quote.fiatAmount);

    await writeAuditLog({
      userId: session.user.id,
      action: parsed.data.direction === 'onramp' ? 'onramp_execute' : 'offramp_execute',
      details: { stage: 'quote', ...parsed.data },
    });

    return NextResponse.json({ data: { ...quote, vantor_fee: vantorFee } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
