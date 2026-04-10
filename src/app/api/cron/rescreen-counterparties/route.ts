import { NextRequest, NextResponse } from 'next/server';
import { rescreenCounterpartyBatch } from '@/lib/sanctions/rescreen';

const MAX_ITERATIONS = 20; // Cap at 1000 counterparties per run (20 × 50)

/**
 * Weekly counterparty re-screening cron job.
 * Iterates through all counterparties due for re-screening in batches.
 * Trigger via Vercel Cron or external scheduler.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let totalProcessed = 0;
  let totalFlagged = 0;
  let totalErrors = 0;
  let cursor: string | undefined;
  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const result = await rescreenCounterpartyBatch(cursor);

      totalProcessed += result.processed;
      totalFlagged += result.flagged;
      totalErrors += result.errors;

      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
  } catch (err) {
    console.error('[cron/rescreen-counterparties]', err);
    return NextResponse.json(
      {
        error: (err as Error).message,
        processed: totalProcessed,
        flagged: totalFlagged,
        errors: totalErrors,
      },
      { status: 500 },
    );
  }

  console.log(
    `[cron/rescreen-counterparties] processed=${totalProcessed} flagged=${totalFlagged} errors=${totalErrors} iterations=${iterations}`,
  );

  return NextResponse.json({
    processed: totalProcessed,
    flagged: totalFlagged,
    errors: totalErrors,
    iterations,
  });
}
