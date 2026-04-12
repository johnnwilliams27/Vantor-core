import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { DIMENSIONS } from '@/lib/analytics/dimensions';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = DIMENSIONS.map((d) => ({
    slug: d.slug,
    label: d.label,
    description: d.description,
    granularities: d.granularities ?? null,
  }));

  return NextResponse.json({ data });
}
