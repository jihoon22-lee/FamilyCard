import Link from 'next/link';
import type { Metadata } from 'next';
import type { CaptureOriginKind } from '@prisma/client';

import { requireSession } from '@/lib/auth/session';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

import { fetchDistinctPackageNames, fetchRawMessages } from './query';
import { formatKst } from './format-kst';

export const metadata: Metadata = {
  title: '수집 원문 · FamilyCard',
};

const SOURCE_LABEL: Record<string, string> = {
  NOTIFICATION: '알림',
  SMS: '문자',
  MANUAL: '수동입력',
  STATEMENT: '명세서',
};

const ORIGIN_LABEL: Record<string, string> = {
  CARD_APP: '카드사 앱',
  PAYMENT_APP: '결제·자산 앱',
  KAKAO_CHANNEL: '카카오 공식 채널',
  SMS_SENDER: 'SMS 발신자',
  MANUAL_ENTRY: '수동 입력',
  STATEMENT_UPLOAD: '명세서 업로드',
  UNKNOWN_APP: '기존 앱(미분류)',
};

interface RawPageProps {
  searchParams: Promise<{ page?: string; packageName?: string; originKind?: string }>;
}

function pageHref(page: number, packageName?: string, originKind?: CaptureOriginKind): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (packageName) params.set('packageName', packageName);
  if (originKind) params.set('originKind', originKind);
  return `/raw?${params.toString()}`;
}

function parseOriginKind(value?: string): CaptureOriginKind | undefined {
  return value && Object.hasOwn(ORIGIN_LABEL, value) ? (value as CaptureOriginKind) : undefined;
}

// Phase 3 파서 작성의 근거 자료가 되는 화면. 파싱 전이므로 원문을 그대로
// 보여준다. scope=SELF(앱 WebView·일반 구성원 웹)는 본인 기기의 원문만,
// scope=FAMILY(관리자 웹 로그인)는 가족 전원의 원문을 본다 — 그 분기는
// query.ts 의 visibleMemberIds() 안에서만 일어난다.
// → docs/plan/phase2-contract.md §5
export default async function RawMessageListPage({ searchParams }: RawPageProps) {
  const session = await requireSession();
  const params = await searchParams;

  const requestedPage = Number(params.page ?? '1');
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const packageName = params.packageName?.trim() || undefined;
  const originKind = parseOriginKind(params.originKind);

  const [{ items, totalCount, totalPages }, packageNames] = await Promise.all([
    fetchRawMessages(session, { page, packageName, originKind }),
    fetchDistinctPackageNames(session),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">수집 원문</p>
          <h1 className="text-xl font-semibold sm:text-2xl">파싱 전 원문 목록</h1>
        </div>
        <Link href="/" className="text-muted-foreground text-sm underline underline-offset-4">
          대시보드로
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>필터</CardTitle>
          <CardDescription>세부 출처와 패키지명으로 원문을 나눠 볼 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="GET" action="/raw" className="flex flex-wrap items-center gap-2">
            <select
              name="originKind"
              defaultValue={originKind ?? ''}
              className="border-input h-11 flex-1 rounded-md border bg-transparent px-3 text-base shadow-xs outline-none md:text-sm"
            >
              <option value="">전체 출처</option>
              {Object.entries(ORIGIN_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              name="packageName"
              defaultValue={packageName ?? ''}
              className="border-input h-11 flex-1 rounded-md border bg-transparent px-3 text-base shadow-xs outline-none md:text-sm"
            >
              <option value="">전체 패키지</option>
              {packageNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm">
              필터 적용
            </Button>
            {(packageName || originKind) && (
              <Link
                href="/raw"
                className="text-muted-foreground text-sm underline underline-offset-4"
              >
                초기화
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>원문이 없습니다</CardTitle>
            <CardDescription>
              {packageName || originKind
                ? '선택한 조건으로 수집된 원문이 없습니다.'
                : '아직 수집된 원문이 없습니다. 안드로이드 앱에서 수집이 시작되면 여기 표시됩니다.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-1.5">
                <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>{formatKst(item.receivedAt)}</span>
                  <span className="flex items-center gap-2">
                    <span className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5">
                      {SOURCE_LABEL[item.source] ?? item.source}
                    </span>
                    <span className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5">
                      {ORIGIN_LABEL[item.originKind] ?? item.originKind}
                    </span>
                    <span>{item.memberName}</span>
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">{item.packageName}</p>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-sm break-words whitespace-pre-wrap">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <nav className="flex items-center justify-between gap-4">
        {page > 1 ? (
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={pageHref(page - 1, packageName, originKind)}>이전</Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled>
            이전
          </Button>
        )}
        <span className="text-muted-foreground text-sm">
          {page} / {totalPages} 페이지 · 총 {totalCount}건
        </span>
        {page < totalPages ? (
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={pageHref(page + 1, packageName, originKind)}>다음</Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled>
            다음
          </Button>
        )}
      </nav>
    </main>
  );
}
