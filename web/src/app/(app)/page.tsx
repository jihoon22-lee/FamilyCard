import Link from 'next/link';
import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { signOutAction } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: '대시보드 · FamilyCard',
};

// 빈 대시보드. 거래·실적 데이터는 Phase 2(수집)·Phase 4(실적 엔진) 이후 이 화면에 붙습니다.
export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">안녕하세요</p>
          <h1 className="text-xl font-semibold sm:text-2xl">{session.name}님</h1>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            로그아웃
          </Button>
        </form>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>이번 달 카드 사용</CardTitle>
          <CardDescription>아직 수집된 데이터가 없습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            안드로이드 앱에서 카드 결제 알림 수집이 시작되면, 이 화면에 카드별 월간 사용금액과
            전월실적 달성 추정치가 표시됩니다.
          </p>
        </CardContent>
      </Card>

      {session.scope === 'FAMILY' && (
        <Button asChild variant="outline" size="lg" className="h-12 w-full text-base">
          <Link href="/family">가족 전체 보기</Link>
        </Button>
      )}
    </main>
  );
}
