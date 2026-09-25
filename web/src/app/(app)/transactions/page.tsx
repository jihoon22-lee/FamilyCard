import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { monthlyTransactions } from '@/lib/transactions';
import { formatDate } from '@/lib/time';
import { netAmount } from '@/lib/reconciliation';
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; cardId?: string; page?: string }>;
}) {
  const session = await requireSession(),
    params = await searchParams;
  const data = await monthlyTransactions(session, {
    month: params.month,
    cardId: params.cardId,
    page: Number(params.page ?? 1),
  });
  const href = (page: number) =>
    '/transactions?' +
    new URLSearchParams({
      month: data.month,
      page: String(page),
      ...(params.cardId ? { cardId: params.cardId } : {}),
    });
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex justify-between">
        <h1 className="text-2xl font-semibold">거래 내역</h1>
        <Link href="/" className="underline">
          대시보드
        </Link>
      </header>
      <form className="flex flex-wrap gap-3">
        <label>
          승인월 (한국 시간)
          <input
            type="month"
            name="month"
            defaultValue={data.month}
            className="rounded border p-2"
          />
        </label>
        <label>
          카드
          <select name="cardId" defaultValue={params.cardId ?? ''} className="rounded border p-2">
            <option value="">전체</option>
            {data.cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.member.name} · {c.nickname} ({c.last4})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded border px-4">
          조회
        </button>
      </form>
      <section className="rounded-lg border p-4">
        <p className="text-lg font-semibold">
          이 달 승인 순사용액 {data.net.toLocaleString('ko-KR')}원
        </p>
        <p className="text-muted-foreground text-sm">
          확정 승인에서 연결된 취소를 차감한 금액입니다. 나중에 도착한 취소도 원래 승인월에
          반영됩니다. 카드사 청구액과 다를 수 있습니다.
        </p>
        <p>
          확인 필요 {data.pending}건 · 원화 미확정 {data.unknownAmount}건
        </p>
      </section>
      <div className="flex gap-4">
        <Link href="/review" className="underline">
          확인할 거래·수동 입력
        </Link>
        <Link href="/cards" className="underline">
          카드 관리
        </Link>
      </div>
      {data.items.length === 0 && (
        <p>이 기간의 거래가 없습니다. 카드 등록과 원문 분석 상태를 확인해주세요.</p>
      )}
      {data.items.map((t) => (
        <article key={t.id} className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="font-semibold">
            {t.member.name} · {t.card ? `${t.card.nickname} (${t.card.last4})` : '카드 미지정'} ·{' '}
            {t.txType === 'APPROVAL' ? '승인' : '취소'}
          </h2>
          <p>
            {formatDate(t.approvedAt)}
            {t.timePrecision === 'DAY'
              ? ' · 날짜만 확인됨'
              : t.timePrecision === 'RECEIVED'
                ? ' · 수신 시각 기준'
                : ''}{' '}
            · {t.merchantName || '가맹점 미확인'}
          </p>
          <p>
            {t.amount === null ? '원화 금액 미확정' : `${t.amount.toLocaleString('ko-KR')}원`}
            {t.txType === 'APPROVAL' && t.amount !== null
              ? ` · 취소 ${t.canceledAmount.toLocaleString('ko-KR')}원 · 순사용 ${netAmount(t)!.toLocaleString('ko-KR')}원`
              : ''}
          </p>
          <p className="text-muted-foreground text-sm">
            근거 {t._count.evidence}건{t.state === 'REVIEW' ? ' · 확인 필요' : ''}
            {t.isOrphanCancellation ? ' · 취소 원거래 확인 필요' : ''}
            {t.isManuallyEdited ? ' · 수동 판단 보존' : ''}
          </p>
          <Link
            href={`/review?rawId=${encodeURIComponent(t.rawMessageId)}`}
            className="text-sm underline"
          >
            원문 확인·수정·병합/분리
          </Link>
        </article>
      ))}
      <nav className="flex justify-between">
        <Link href={href(Math.max(1, data.page - 1))} className="underline">
          이전
        </Link>
        <span>
          {data.page} / {data.totalPages} · {data.total}건
        </span>
        <Link href={href(Math.min(data.totalPages, data.page + 1))} className="underline">
          다음
        </Link>
      </nav>
    </main>
  );
}
