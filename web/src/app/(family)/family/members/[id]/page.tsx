import { notFound } from 'next/navigation';
import { requireFamilyScope } from '@/lib/auth/session';
import { visibleMemberIds } from '@/lib/auth/scope';
import { AnalyticsView } from '@/components/analytics/AnalyticsView';
export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireFamilyScope(),
    { id } = await params;
  const visible = await visibleMemberIds(session);
  if (!visible.includes(id)) notFound();
  return (
    <AnalyticsView session={session} memberId={id} month={(await searchParams).month} family />
  );
}
