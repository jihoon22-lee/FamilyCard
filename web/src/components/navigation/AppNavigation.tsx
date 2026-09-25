import Link from 'next/link';
import type { AppSession } from '@/lib/auth/types';
import { reviewCount } from '@/lib/review/query';
export async function AppNavigation({ session }: { session: AppSession }) {
  const count = await reviewCount(session);
  return (
    <nav aria-label="주요 메뉴" className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-3 text-sm">
        <Link href="/" className="font-semibold">
          FamilyCard
        </Link>
        <Link href="/transactions" className="underline">
          거래
        </Link>
        <Link href="/benefits" className="underline">
          실적 추정치
        </Link>
        <Link href="/review" className="bg-muted rounded px-2 py-1 font-medium">
          확인 필요 {count.toLocaleString('ko-KR')}
        </Link>
        <Link href="/alerts" className="underline">
          알림
        </Link>
        {session.entrypoint === 'WEB' && <Link href="/account">계정</Link>}
        {session.entrypoint === 'WEB' && session.role === 'ADMIN' && session.scope === 'FAMILY' && (
          <Link href="/family/sessions">웹 세션 관리</Link>
        )}
        {session.scope === 'FAMILY' && (
          <Link href="/family" className="underline">
            가족 전체
          </Link>
        )}
      </div>
    </nav>
  );
}
