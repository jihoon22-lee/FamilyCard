import Link from 'next/link';
import type { Metadata } from 'next';

import { requireFamilyScope } from '@/lib/auth/session';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: '가족 전체 보기 · FamilyCard',
};

// 빈 가족 화면. 가족×카드 매트릭스는 Phase 5(관리자 가족 대시보드)에서 채워진다.
export default async function FamilyPage() {
  const session = await requireFamilyScope();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">관리자</p>
          <h1 className="text-xl font-semibold sm:text-2xl">{session.name}님</h1>
        </div>
        <Link href="/" className="text-muted-foreground text-sm underline underline-offset-4">
          내 대시보드로
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>가족 × 카드 현황</CardTitle>
          <CardDescription>아직 수집된 데이터가 없습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            가족 구성원별·카드별 월간 사용금액과 전월실적 달성 추정치를 한 화면에서 비교하는 기능은
            Phase 5에서 추가됩니다.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
