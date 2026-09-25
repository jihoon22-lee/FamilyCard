import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { visibleMemberIds } from '@/lib/auth/scope';
import { prisma } from '@/lib/db';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const visible = await visibleMemberIds(session),
    { id } = await params;
  const file = await prisma.statementImport.findFirst({
    where: { id, memberId: { in: visible } },
    select: { fileName: true, originalFile: true },
  });
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new Response(new Uint8Array(file.originalFile), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
