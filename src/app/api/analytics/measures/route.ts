import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { MEASURES } from '@/lib/analytics/measures';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = MEASURES.map((m) => ({
    slug: m.slug,
    label: m.label,
    description: m.description,
    unit: m.unit,
    computed: m.computed ?? false,
    dimensions: m.dimensions,
  }));

  return NextResponse.json({ data });
}
