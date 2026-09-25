import { requireSession } from '@/lib/auth/session';
import { AnalyticsView } from '@/components/analytics/AnalyticsView';
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();
  return <AnalyticsView session={session} month={(await searchParams).month} />;
}
