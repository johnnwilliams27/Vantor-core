import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { STANDARD_VIEWS } from '@/lib/analytics/standard-views';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = STANDARD_VIEWS.map((v) => ({
    id: v.id,
    slug: v.slug,
    label: v.label,
    description: v.description,
    kind: v.kind,
    chartType: v.chartType,
    config: v.config,
    sortOrder: v.sortOrder,
  }));

  return NextResponse.json({ data });
}
