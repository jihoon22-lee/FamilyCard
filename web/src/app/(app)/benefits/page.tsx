import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { benefitCards, cardEstimate, EXCLUSIONS } from '@/lib/benefit';
import { validateConfig } from '@/lib/benefit/engine';
import { currentKstMonth, dayInput, monthRange } from '@/lib/time';
import { ActionForm } from '@/components/forms/ActionForm';
import { TierFields } from './TierFields';
import { benefitAction } from './actions';
const input = 'w-full rounded border p-2';
const reasons: Record<string, string> = {
  MIN_AMOUNT: '건별 최소 금액 미달',
  MANUAL_EXCLUDE: '직접 제외',
  KRW_UNKNOWN: '원화 금액 미확정',
  REVIEW: '거래 확인 필요',
  ORPHAN_CANCELLATION_ESTIMATE: '원거래 미확인 취소 차감 (추정)',
  ORIGINAL_UNCONFIRMED: '원거래 미확정',
  ORIGINAL_RULE_UNKNOWN: '원거래 당시 규칙 미확인',
  CANCEL_PERIOD: '취소일 사이클 차감',
};
function reason(code: string | null) {
  if (!code) return '포함';
  for (const [key, label] of Object.entries(EXCLUSIONS))
    if (code === 'CATEGORY_' + key || code === 'MERCHANT_' + key)
      return `${label} 제외 (${code.startsWith('CATEGORY') ? '분류' : '가맹점명'})`;
  return reasons[code] ?? '확인 필요';
}
export default async function BenefitsPage({
  searchParams,
}: {
  searchParams: Promise<{ cardId?: string; month?: string }>;
}) {
  const session = await requireSession(),
    params = await searchParams,
    cards = await benefitCards(session);
  let month = params.month ?? currentKstMonth();
  try {
    monthRange(month);
  } catch {
    month = currentKstMonth();
  }
  const card = cards.find((c) => c.id === params.cardId) ?? (!params.cardId ? cards[0] : undefined);
  const data = card ? await cardEstimate(session, card.id, month) : null;
  const transactionMap = new Map(data?.configured ? data.transactions.map((t) => [t.id, t]) : []);
  let config;
  try {
    config = card?.benefitRule ? validateConfig(card.benefitRule) : undefined;
  } catch {
    config = undefined;
  }
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex justify-between">
        <h1 className="text-2xl font-semibold">카드 실적 추정치</h1>
        <Link href="/" className="underline">
          대시보드
        </Link>
      </header>
      <p>
        카드사의 공식 수치가 아닙니다. 누락·할부 변경·환율 확정과 제외 기준 차이가 있으므로 카드사
        앱과 대조해주세요.
      </p>
      <form className="flex flex-wrap gap-3">
        <label>
          카드
          <select name="cardId" defaultValue={card?.id} className={input}>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.member.name} · {c.nickname} ({c.last4})
              </option>
            ))}
          </select>
        </label>
        <label>
          혜택 판정월
          <input name="month" type="month" defaultValue={month} className={input} />
        </label>
        <button className="rounded border p-2">조회</button>
      </form>
      {!card && (
        <p>
          카드를 먼저 등록하거나 조회할 카드를 선택해주세요.{' '}
          <Link href="/cards" className="underline">
            카드 관리
          </Link>
        </p>
      )}
      {data?.configured && (
        <section className="flex flex-col gap-3 rounded border p-4">
          <h2 className="font-semibold">
            {card?.nickname} · 실적 추정치 {data.result.total.toLocaleString('ko-KR')}원
          </h2>
          <p>
            산정 기간 {dayInput(data.range.start)} ~{' '}
            {dayInput(new Date(data.range.end.getTime() - 1))} · 규칙 v{data.version}
          </p>
          <p>
            {data.result.next
              ? `다음 구간까지 ${data.result.remaining.toLocaleString('ko-KR')}원 부족 (추정치) · ${data.result.next.benefitDesc}`
              : '등록한 최고 구간 달성 (추정치)'}
          </p>
          {data.result.next && (
            <progress
              className="w-full"
              max={data.result.next.threshold || 1}
              value={Math.max(0, data.result.total)}
              aria-label="실적 달성 진행률 추정치"
            />
          )}
          <p>
            확인 필요 {data.result.uncertain}건 · 카드 미지정 {data.unassigned}건 · 제외/미확정{' '}
            {data.result.excluded}건
          </p>
          <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="underline">
            입력한 공식 조건 확인
          </a>
          <details>
            <summary>거래별 포함·제외·취소 사유</summary>
            <ul className="flex flex-col gap-2">
              {data.result.evaluations.map((e) => {
                const t = transactionMap.get(e.transactionId);
                return (
                  <li key={e.transactionId}>
                    <Link
                      href={`/review?rawId=${encodeURIComponent(t?.rawMessageId ?? '')}`}
                      className="underline"
                    >
                      {t?.merchantName || '가맹점 미확인'}
                    </Link>{' '}
                    · {e.contribution.toLocaleString('ko-KR')}원 · {reason(e.reason)}
                    {e.uncertain ? ' · 확인 필요' : ''}
                  </li>
                );
              })}
            </ul>
          </details>
          <ActionForm action={benefitAction}>
            <input type="hidden" name="intent" value="snapshot" />
            <input type="hidden" name="cardId" value={data.card.id} />
            <input type="hidden" name="month" value={month} />
            <button className="rounded border p-2">이 추정치와 산정 사유 기록</button>
          </ActionForm>
        </section>
      )}
      {card && (
        <>
          <p>
            {data && !data.configured
              ? '해당 산정 기간에 적용할 공식 조건이 등록되지 않았습니다.'
              : ''}
          </p>
          <details open={!card.benefitRule}>
            <summary>실적 규칙 편집 (새 버전 저장)</summary>
            <ActionForm action={benefitAction}>
              <input type="hidden" name="cardId" value={card.id} />
              <input type="hidden" name="version" value={card.benefitRule?.version ?? 0} />
              <label>
                공식 상품 안내·약관 HTTPS 주소
                <input
                  name="sourceUrl"
                  type="url"
                  defaultValue={card.benefitRule?.sourceUrl ?? ''}
                  required
                  maxLength={1000}
                  className={input}
                />
              </label>
              <label>
                적용 시작일 (산정 기간 시작일 기준)
                <input
                  name="effectiveFrom"
                  type="date"
                  defaultValue={dayInput(card.benefitRule?.effectiveFrom ?? null)}
                  required
                  className={input}
                />
              </label>
              <label>
                적용 종료일 (선택, 해당 날짜부터 제외)
                <input
                  name="effectiveTo"
                  type="date"
                  defaultValue={dayInput(card.benefitRule?.effectiveTo ?? null)}
                  className={input}
                />
              </label>
              <label>
                기간
                <select
                  name="periodType"
                  defaultValue={config?.periodType ?? 'PREV_CALENDAR_MONTH'}
                  className={input}
                >
                  <option value="PREV_CALENDAR_MONTH">전월 달력 월</option>
                  <option value="STATEMENT_CYCLE">결제일 기준 사이클</option>
                </select>
              </label>
              <label>
                취소 차감
                <select
                  name="cancellationPolicy"
                  defaultValue={config?.cancellationPolicy ?? 'DEDUCT_FROM_ORIGINAL'}
                  className={input}
                >
                  <option value="DEDUCT_FROM_ORIGINAL">원결제 사이클에서 차감</option>
                  <option value="DEDUCT_FROM_CANCEL_PERIOD">취소한 사이클에서 차감</option>
                </select>
              </label>
              <label>
                건별 최소 인정 금액
                <input
                  name="minPerTxAmount"
                  type="number"
                  min={0}
                  step={1}
                  max={2147483647}
                  defaultValue={config?.minPerTxAmount ?? 0}
                  required
                  className={input}
                />
              </label>
              <TierFields initial={config?.tiers ?? []} />
              <fieldset>
                <legend>약관에서 확인한 제외 항목</legend>
                {Object.entries(EXCLUSIONS).map(([code, label]) => (
                  <label key={code} className="mr-4 inline-flex gap-1">
                    <input
                      type="checkbox"
                      name="exclusions"
                      value={code}
                      defaultChecked={
                        config?.exclusions.includes(code as keyof typeof EXCLUSIONS) ?? false
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label>
                <input type="checkbox" name="confirmed" required /> 해당 카드의 공식 조건과 적용
                기간을 확인했습니다.
              </label>
              <button className="bg-primary text-primary-foreground rounded p-2">
                실적 규칙 저장
              </button>
            </ActionForm>
          </details>
          <details>
            <summary>보존된 규칙 이력 ({card.benefitRule?.revisions.length ?? 0})</summary>
            <ul>
              {card.benefitRule?.revisions.map((r) => (
                <li key={r.id}>
                  v{r.version} · {dayInput(r.effectiveFrom)}부터{' '}
                  {dayInput(r.effectiveTo) || '종료 제한 없음'}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </main>
  );
}
