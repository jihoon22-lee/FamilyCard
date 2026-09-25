import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { listCards } from '@/lib/cards';
import { reviewData } from '@/lib/review/query';
import { manualRequestId } from '@/lib/review';
import { dateTimeInput, formatDate } from '@/lib/time';
import { narrative } from '@/lib/parser';
import { ActionForm } from '@/components/forms/ActionForm';
import {
  manualAction,
  mergeAction,
  splitAction,
  retryRawAction,
  processNowAction,
} from './actions';
const input = 'border-input w-full rounded-md border bg-transparent px-3 py-2';
const button = 'bg-primary text-primary-foreground rounded-md px-4 py-2';
const REASONS: Record<string, string> = {
  NO_RULE: '해석 규칙 없음',
  INVALID_RULE: '규칙 확인 필요',
  EXTRACTION_FAILED: '문구 형식 확인 필요',
  INVALID_FIELDS: '추출한 금액·날짜 확인 필요',
  UNSUPPORTED_FORMAT: '아직 지원하지 않는 원문 구조',
  INPUT_TOO_LARGE: '분석 가능한 길이 초과',
  NO_CARD: '카드 미지정',
  NO_CARD_TOKEN: '카드 식별 표기 없음',
  AMBIGUOUS_CARD: '카드 후보가 여러 장',
  FOREIGN_KRW_UNKNOWN: '원화 환산액 미확정',
  NEEDS_RECONCILIATION: '같은 결제인지 확인 필요',
  EVIDENCE_CONFLICT: '연결된 원문 사이의 내용 차이',
  NO_ORIGINAL: '취소의 원거래 확인 필요',
  AMBIGUOUS_ORIGINAL: '취소 원거래 후보가 여러 건',
  INVALID_MANUAL_LINK: '선택한 원거래의 날짜·잔여액 확인 필요',
  LEDGER_LIMIT: '거래량이 처리 한도를 초과함',
  PROCESSING_ERROR: '자동 처리 오류',
  TRANSACTION_RETRY: '동시 변경으로 재시도 필요',
};
function reason(value: string | null) {
  if (value?.startsWith('EXISTING_PRESERVED_')) return '재분석하지 못해 이전 거래를 보존했습니다.';
  return value ? (REASONS[value] ?? '확인 필요') : '확인 필요';
}
type CardRow = Awaited<ReturnType<typeof listCards>>[number];
type TxRow = Awaited<ReturnType<typeof reviewData>>['transactions'][number];
function EditFields({
  cards,
  transactions,
  defaults,
}: {
  cards: CardRow[];
  transactions: TxRow[];
  defaults: {
    cardId?: string | null;
    amount?: number | null;
    approvedAt: Date;
    merchantName?: string;
    txType?: string;
    canceledTxId?: string | null;
  };
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        카드
        <select name="cardId" defaultValue={defaults.cardId ?? ''} className={input}>
          <option value="">카드 미지정</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.member.name} · {c.nickname} ({c.last4})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        금액 (원, 취소도 양수)
        <input
          name="amount"
          type="number"
          min={0}
          max={2147483647}
          step={1}
          defaultValue={defaults.amount ?? ''}
          required
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        거래 시각 (한국 시간)
        <input
          name="approvedAt"
          type="datetime-local"
          defaultValue={dateTimeInput(defaults.approvedAt)}
          required
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        거래 종류
        <select name="txType" defaultValue={defaults.txType ?? ''} required className={input}>
          <option value="">선택</option>
          <option value="APPROVAL">승인</option>
          <option value="CANCELLATION">취소</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        가맹점
        <input
          name="merchantName"
          defaultValue={defaults.merchantName ?? ''}
          maxLength={300}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        취소의 원거래 (선택)
        <select
          name="originalTransactionId"
          defaultValue={defaults.canceledTxId ?? ''}
          className={input}
        >
          <option value="">자동 확인 / 해당 없음</option>
          {transactions
            .filter((t) => t.txType === 'APPROVAL' && t.state === 'CONFIRMED')
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.card?.nickname ?? '미지정'} · {formatDate(t.approvedAt)} · {t.merchantName} ·{' '}
                {t.amount?.toLocaleString('ko-KR') ?? '미확정'}원
              </option>
            ))}
        </select>
      </label>
      <p className="text-muted-foreground text-xs">
        거래 선택 목록은 최근 1,000건까지 표시합니다. 같은 구성원의 같은 카드 거래만 연결할 수
        있습니다.
      </p>
      <button type="submit" className={button}>
        확인한 값 저장
      </button>
    </>
  );
}
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; rawId?: string }>;
}) {
  const session = await requireSession();
  const search = await searchParams;
  const [data, cards] = await Promise.all([
    reviewData(session, Number(search.page ?? 1), search.rawId),
    listCards(session),
  ]);
  const names = new Map(data.members.map((m) => [m.id, m.name]));
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex justify-between gap-4">
        <h1 className="text-2xl font-semibold">확인할 거래</h1>
        <Link href="/" className="underline">
          대시보드
        </Link>
      </header>
      <p>
        검토 원문 {data.total}건 · 처리 대기 {data.pending}건 · 처리 오류 {data.failed}건
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href="/cards" className="underline">
          카드 관리
        </Link>
        <Link href="/transactions" className="underline">
          거래 목록
        </Link>
        <Link href="/review" className="underline">
          새로고침
        </Link>
      </div>
      <ActionForm action={processNowAction}>
        <button type="submit" className={button}>
          대기 원문 분석하기 (최대 20건)
        </button>
      </ActionForm>
      <details className="rounded-lg border p-4">
        <summary>알림이 없는 거래 수동 입력</summary>
        <ActionForm action={manualAction}>
          <input type="hidden" name="requestId" value={manualRequestId()} />
          <label className="flex flex-col gap-1">
            구성원
            <select name="memberId" defaultValue={session.memberId} className={input}>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <EditFields
            cards={cards}
            transactions={data.transactions}
            defaults={{ approvedAt: new Date(), txType: 'APPROVAL' }}
          />
        </ActionForm>
      </details>
      {data.raws.length === 0 && <p>현재 페이지에 확인할 원문이 없습니다.</p>}
      {data.raws.map((raw) => {
        const memberId = raw.device?.memberId ?? raw.ownerMemberId;
        const current = data.linked.find((t) => t.id === raw.evidence?.transactionId);
        const fields =
          raw.parsedFields &&
          typeof raw.parsedFields === 'object' &&
          !Array.isArray(raw.parsedFields)
            ? raw.parsedFields
            : {};
        const candidateDate =
          typeof fields.approvedAt === 'string' ? new Date(fields.approvedAt) : raw.receivedAt;
        const at =
          current?.approvedAt ??
          (Number.isFinite(candidateDate.getTime()) ? candidateDate : raw.receivedAt);
        const possible = data.transactions.filter(
          (t) =>
            t.id !== current?.id &&
            t.memberId === memberId &&
            t.cardId &&
            t.cardId === current?.cardId &&
            t.amount === current.amount &&
            t.txType === current.txType &&
            t.currency === current.currency,
        );
        return (
          <section key={raw.id} className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="font-semibold">
              {memberId ? names.get(memberId) : '소유자 확인 필요'} · {raw.source} ·{' '}
              {reason(
                raw.parseReason ?? current?.reviewReason ?? raw.processingJob?.lastError ?? null,
              )}
            </h2>
            <p className="text-muted-foreground text-xs">
              수신 {formatDate(raw.receivedAt)} · 서버 도착 {formatDate(raw.createdAt)}
            </p>
            <pre className="max-h-64 overflow-auto text-sm break-words whitespace-pre-wrap">
              {narrative(raw.body, raw.source) ?? raw.body}
            </pre>
            <details>
              <summary>원문 그대로 보기</summary>
              <pre className="max-h-64 overflow-auto text-xs break-words whitespace-pre-wrap">
                {raw.body}
              </pre>
            </details>
            {current && (
              <p className="text-sm">
                연결된 거래 {current.amount?.toLocaleString('ko-KR') ?? '원화 미확정'}
                {current.amount !== null ? '원' : ''} · 근거 {current.evidence.length}건
                {current.isManuallyEdited ? ' · 수동 판단 보존 중' : ''}
              </p>
            )}
            <details>
              <summary>카드 지정·수동 수정·취소 연결</summary>
              <ActionForm action={manualAction}>
                <input type="hidden" name="rawId" value={raw.id} />
                <EditFields
                  cards={cards.filter((c) => c.memberId === memberId)}
                  transactions={data.transactions.filter((t) => t.memberId === memberId)}
                  defaults={{
                    cardId: current?.cardId,
                    amount:
                      current?.amount ?? (typeof fields.amount === 'number' ? fields.amount : null),
                    approvedAt: at,
                    merchantName:
                      current?.merchantName ??
                      (typeof fields.merchantName === 'string' ? fields.merchantName : ''),
                    txType:
                      current?.txType ??
                      (typeof fields.txType === 'string' ? fields.txType : undefined),
                    canceledTxId: current?.canceledTxId,
                  }}
                />
              </ActionForm>
            </details>
            <ActionForm action={retryRawAction}>
              <input type="hidden" name="rawId" value={raw.id} />
              <button type="submit" className="rounded-md border px-3 py-2">
                이 원문 다시 분석
              </button>
            </ActionForm>

            {current && possible.length > 0 && (
              <details>
                <summary>동일한 거래로 합치기</summary>
                <ActionForm action={mergeAction}>
                  <input type="hidden" name="secondaryId" value={current.id} />
                  <label>
                    남길 대표 거래
                    <select name="primaryId" required className={input}>
                      {possible.map((t) => (
                        <option key={t.id} value={t.id}>
                          {formatDate(t.approvedAt)} · {t.merchantName} ·{' '}
                          {t.amount?.toLocaleString('ko-KR')}원
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input type="checkbox" name="confirm" required /> 서로 다른 결제가 아니라 같은
                    거래임을 확인했습니다.
                  </label>
                  <button type="submit" className={button}>
                    원문을 보존하고 합치기
                  </button>
                </ActionForm>
              </details>
            )}
            {current && current.evidence.length > 1 && (
              <ActionForm action={splitAction}>
                <input type="hidden" name="rawId" value={raw.id} />
                <label>
                  <input type="checkbox" name="confirm" required /> 이 원문은 나머지 근거와 별도
                  거래입니다.
                </label>
                <button type="submit" className="rounded-md border px-3 py-2">
                  별도 거래로 분리
                </button>
              </ActionForm>
            )}
          </section>
        );
      })}
      <nav className="flex justify-between">
        <Link href={`/review?page=${Math.max(1, data.page - 1)}`} className="underline">
          이전
        </Link>
        <span>
          {data.page} / {data.totalPages}
        </span>
        <Link
          href={`/review?page=${Math.min(data.totalPages, data.page + 1)}`}
          className="underline"
        >
          다음
        </Link>
      </nav>
    </main>
  );
}
