import Link from 'next/link';
import { monthlyTransactions } from '@/lib/transactions';
import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { signOutAction } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { countRawMessages } from './raw/query';

export const metadata: Metadata = {
  title: '대시보드 · FamilyCard',
};

export default async function DashboardPage() {
  const session = await requireSession();
  const [rawMessageCount, monthly] = await Promise.all([
    countRawMessages(session),
    monthlyTransactions(session),
  ]);

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
          <CardDescription>취소를 반영한 순사용액입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{monthly.net.toLocaleString('ko-KR')}원</p>
          <p className="text-muted-foreground text-sm">
            확정된 승인 순사용액입니다. 확인 필요 {monthly.pending}건·원화 미확정{' '}
            {monthly.unknownAmount}건은 별도로 확인해주세요.
          </p>
          <ul className="my-3 flex flex-col gap-2">
            {monthly.totals.map((total) => {
              const card = monthly.cards.find((c) => c.id === total.cardId);
              return (
                <li key={total.cardId ?? 'unassigned'}>
                  <Link
                    href={
                      card
                        ? `/transactions?cardId=${encodeURIComponent(card.id)}&month=${monthly.month}`
                        : '/review'
                    }
                    className="underline"
                  >
                    {card
                      ? `${card.member.name} · ${card.nickname} (${card.last4})`
                      : '카드 미분류'}
                  </Link>
                  : {total.net.toLocaleString('ko-KR')}원
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-4">
            <Link href="/alerts" className="underline">
              운영·실적 알림
            </Link>
            <Link href="/analytics" className="underline">
              분석·예산·리포트
            </Link>
            <Link href="/benefits" className="underline">
              실적 추정치
            </Link>
            <Link href="/transactions" className="underline">
              거래 내역
            </Link>
            <Link href="/review" className="underline">
              확인할 거래
            </Link>
            <Link href="/cards" className="underline">
              카드 관리
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>수집된 알림 원문</CardTitle>
          <CardDescription>
            서버에 본인 원문 {rawMessageCount.toLocaleString('ko-KR')}건이 보관되어 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            전송에 성공한 알림의 수집 시각·출처·제목·본문을 확인할 수 있습니다. 폰에서 아직 전송
            대기 중인 항목은 성공한 뒤 여기에 나타납니다.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/raw">수집 원문 보기</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/collection">수집기 상태 보기</Link>
          </Button>
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
