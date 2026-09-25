import { requireFamilyScope } from '@/lib/auth/session';
import { AnalyticsView } from '@/components/analytics/AnalyticsView';
export default async function FamilyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireFamilyScope();
  return <AnalyticsView session={session} month={(await searchParams).month} family />;
}
