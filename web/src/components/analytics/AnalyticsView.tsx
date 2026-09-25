import Link from 'next/link';
import { Fragment } from 'react';
import { analytics, shiftedMonth } from '@/lib/analytics';
import { cardEstimate } from '@/lib/benefit';
import { categories } from '@/lib/classification';
import type { AppSession } from '@/lib/auth/types';
import { ActionForm } from '@/components/forms/ActionForm';
import { budgetAction } from '@/app/(app)/analytics/actions';
export async function AnalyticsView({
  session,
  month,
  memberId,
  family = false,
}: {
  session: AppSession;
  month?: string;
  memberId?: string;
  family?: boolean;
}) {
  const data = await analytics(session, { month, memberId }),
    categoryList = await categories();
  const performance = new Map<string, { total: number; remaining: number } | null>();
  // Only configured cards need the heavier ledger calculation; process sequentially to bound memory.
  for (const card of data.cards.filter((c) => c.benefitRule).slice(0, 50)) {
    const estimate = await cardEstimate(session, card.id, shiftedMonth(data.month, 1));
    performance.set(
      card.id,
      estimate.configured
        ? { total: estimate.result.total, remaining: estimate.result.remaining }
        : null,
    );
  }
  const max = Math.max(1, ...data.trend.map((t) => t.net)),
    now = Date.now();
  const query = new URLSearchParams({ month: data.month, ...(memberId ? { memberId } : {}) });
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex justify-between">
        <h1 className="text-2xl font-semibold">
          {family ? '가족 현황' : '사용 분석'}
          {memberId ? ' · ' + (data.members[0]?.name ?? '') : ''}
        </h1>
        <Link href="/" className="underline">
          대시보드
        </Link>
      </header>
      <form className="flex gap-3">
        <label>
          승인월 (한국 시간)
          <input
            name="month"
            type="month"
            defaultValue={data.month}
            className="rounded border p-2"
          />
        </label>
        {memberId && <input name="memberId" type="hidden" value={memberId} />}
        <button className="rounded border p-2">조회</button>
      </form>
      <section className="rounded border p-4">
        <h2 className="text-xl font-semibold">순사용액 {data.total.toLocaleString('ko-KR')}원</h2>
        <p>
          전월 대비 {(data.total - data.previous).toLocaleString('ko-KR')}원 · 전년 동월 대비{' '}
          {(data.total - data.lastYear).toLocaleString('ko-KR')}원
        </p>
        <p className="text-sm">
          확정 승인에서 연결된 취소를 차감합니다. 이후 취소가 도착하면 과거 합계도 바뀔 수 있습니다.
        </p>
      </section>
      <div className="flex flex-wrap gap-4">
        <Link href="/transactions" className="underline">
          거래 내역
        </Link>
        <Link href="/review" className="underline">
          거래 검토
        </Link>
        <Link href="/benefits" className="underline">
          실적 추정치
        </Link>
        {family && (
          <>
            <Link href="/family/devices" className="underline">
              기기 관리
            </Link>
            <Link href="/family/categories" className="underline">
              분류 관리
            </Link>
            <Link href="/family/rules" className="underline">
              파싱 규칙
            </Link>
          </>
        )}
      </div>
      <section>
        <h2 className="mb-3 font-semibold">구성원 × 카드</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">구성원</th>
                <th className="p-2">카드</th>
                <th className="p-2">순사용액</th>
                <th className="p-2">다음 혜택월 실적 추정치</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <Fragment key={member.id}>
                  <tr className="bg-muted border-t">
                    <th className="p-2">
                      {family ? (
                        <Link
                          href={`/family/members/${encodeURIComponent(member.id)}?month=${data.month}`}
                          className="underline"
                        >
                          {member.name}
                        </Link>
                      ) : (
                        member.name
                      )}
                    </th>
                    <td className="p-2">
                      전체 · 검토 원문{' '}
                      {data.reviewCounts.find((r) => r.memberId === member.id)?.count ?? 0}건
                    </td>
                    <td className="p-2">
                      {data.rows
                        .filter((r) => r.memberId === member.id)
                        .reduce((s, r) => s + r.net, 0)
                        .toLocaleString('ko-KR')}
                      원
                    </td>
                    <td />
                  </tr>
                  {data.cards
                    .filter((c) => c.memberId === member.id)
                    .map((card) => {
                      const p = performance.get(card.id);
                      return (
                        <tr key={card.id} className="border-t">
                          <td />
                          <td className="p-2">
                            <Link
                              href={`/transactions?month=${data.month}&cardId=${encodeURIComponent(card.id)}`}
                              className="underline"
                            >
                              {card.nickname} ({card.last4})
                            </Link>
                          </td>
                          <td className="p-2">
                            {data.rows
                              .find((r) => r.cardId === card.id)
                              ?.net.toLocaleString('ko-KR') ?? '0'}
                            원
                          </td>
                          <td className="p-2">
                            <Link
                              href={`/benefits?cardId=${card.id}&month=${shiftedMonth(data.month, 1)}`}
                              className="underline"
                            >
                              {p
                                ? `${p.total.toLocaleString('ko-KR')}원 추정 · ${p.remaining ? `${p.remaining.toLocaleString('ko-KR')}원 부족` : '최고 구간 달성'}`
                                : '규칙/기간 확인'}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {data.cards.filter((c) => c.benefitRule).length > 50 && (
          <p>실적 미리보기는 50장까지 표시합니다. 개별 실적 화면에서 확인해주세요.</p>
        )}
      </section>
      <section>
        <h2 className="font-semibold">13개월 순사용액 추이</h2>
        <div className="mt-3 flex flex-col gap-2">
          {data.trend.map((t) => (
            <div
              key={t.month}
              className="grid grid-cols-[5rem_1fr_7rem] items-center gap-2 text-xs"
            >
              <span>{t.month}</span>
              <div className="bg-muted h-4 rounded">
                <div
                  className="bg-primary h-4 rounded"
                  style={{ width: `${(t.net / max) * 100}%` }}
                />
              </div>
              <span className="text-right">{t.net.toLocaleString('ko-KR')}원</span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-semibold">카테고리 분포</h2>
        <ul>
          {categoryList
            .map((c) => ({
              name: c.name,
              net: data.categoryRows
                .filter((r) => r.categoryId === c.id)
                .reduce((s, r) => s + r.net, 0),
            }))
            .concat([
              {
                name: '미분류',
                net: data.categoryRows
                  .filter((r) => r.categoryId === null)
                  .reduce((s, r) => s + r.net, 0),
              },
            ])
            .filter((c) => c.net > 0)
            .map((c) => (
              <li key={c.name}>
                {c.name} · {c.net.toLocaleString('ko-KR')}원 ·{' '}
                {data.total ? Math.round((c.net / data.total) * 100) : 0}%
              </li>
            ))}
        </ul>
      </section>
      <section>
        <h2 className="font-semibold">예산과 초과 현황</h2>
        {data.budgets.map((b) => (
          <p key={b.id} className={b.over ? 'text-destructive' : ''}>
            {b.member?.name ?? '가족 전체'} · {b.category?.name ?? '전체 분류'}:{' '}
            {b.used.toLocaleString('ko-KR')} / {b.amount.toLocaleString('ko-KR')}원{' '}
            {b.over ? `· ${b.over.toLocaleString('ko-KR')}원 초과` : ''}
          </p>
        ))}
        <details>
          <summary>이 달 예산 설정/수정</summary>
          <ActionForm action={budgetAction}>
            <input type="hidden" name="month" value={data.month} />
            <label>
              대상
              <select
                name="memberId"
                defaultValue={memberId ?? session.memberId}
                className="rounded border p-2"
              >
                {session.scope === 'FAMILY' && !memberId && <option value="">가족 전체</option>}
                {data.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              분류
              <select name="categoryId" className="rounded border p-2">
                <option value="">전체</option>
                {categoryList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              월 예산 (원)
              <input
                name="amount"
                type="number"
                min={0}
                max={2147483647}
                step={1}
                required
                className="rounded border p-2"
              />
            </label>
            <button className="rounded border p-2">같은 대상·분류 예산 저장</button>
          </ActionForm>
        </details>
      </section>
      <section>
        <h2 className="font-semibold">수집기 상태</h2>
        {data.devices.map((d) => (
          <p key={d.id}>
            {data.members.find((m) => m.id === d.memberId)?.name} · {d.deviceName}:{' '}
            {!d.statusReportedAt
              ? '상태 보고 미수신'
              : now - d.statusReportedAt.getTime() > 6 * 3600000
                ? '상태 보고 6시간 이상 지연'
                : '상태 보고 정상'}
          </p>
        ))}
        <p className="text-sm">
          결제가 없어도 상태 보고는 계속되어야 합니다. 지연 시 알림 권한·절전·네트워크를 확인하세요.
        </p>
      </section>
      <section className="flex flex-wrap gap-4">
        <a href={`/api/reports?${query}&format=xlsx`} className="underline">
          월간 엑셀 받기
        </a>
        <a href={`/api/reports?${query}&format=pdf`} className="underline">
          월간 PDF 받기
        </a>
      </section>
    </main>
  );
}
