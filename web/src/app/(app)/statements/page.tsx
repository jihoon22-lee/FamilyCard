import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { listCards, InputError } from '@/lib/cards';
import { statementList, statementDetail } from '@/lib/statements';
import { formatDate } from '@/lib/time';
import { ActionForm } from '@/components/forms/ActionForm';
import { UploadForm } from './UploadForm';
import { statementDecisionAction } from './actions';
const labels: Record<string, string> = {
  LINKED: '연결 완료',
  IGNORED: '반영 제외',
  INVALID: '열/기간/값 확인 필요',
  MATCH: '일치 후보',
  AMBIGUOUS: '후보 여러 건',
  AMOUNT_MISMATCH: '금액 차이',
  MISSING: '대상 거래 없음',
};
export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; page?: string }>;
}) {
  const session = await requireSession(),
    params = await searchParams;
  const [files, cards] = await Promise.all([statementList(session), listCards(session)]);
  let detail = null,
    error = '';
  if (params.id)
    try {
      detail = await statementDetail(session, params.id, Number(params.page ?? 1));
    } catch (e) {
      if (e instanceof InputError) error = e.message;
      else throw e;
    }
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex justify-between">
        <h1 className="text-2xl font-semibold">명세서 대사</h1>
        <Link href="/transactions" className="underline">
          거래 내역
        </Link>
      </header>
      <p>
        파일과 모든 행을 보존한 뒤 검토한 내용만 거래에 반영합니다. 승인·매입·청구 시점 차이로
        불일치할 수 있으며, 명세서에 없다는 이유로 기존 거래를 삭제하거나 취소하지 않습니다.
      </p>
      <details open={!params.id}>
        <summary>명세서 가져오기·매핑 수정</summary>
        <p className="text-sm">
          2MiB·데이터 1,000행·50열까지 지원합니다. XLSX는 첫 시트, 수식은 값으로 변환해주세요. 승인
          금액과 청구액을 혼동하지 마세요.
        </p>
        <UploadForm
          cards={cards.map((c) => ({
            id: c.id,
            label: `${c.member.name} · ${c.nickname} (${c.last4})`,
          }))}
        />
      </details>
      <nav className="flex flex-wrap gap-3">
        {files.map((f) => (
          <Link key={f.id} href={`/statements?id=${f.id}`} className="underline">
            {f.fileName} ({f._count.rawMessages})
          </Link>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {detail && (
        <>
          <h2 className="font-semibold">
            {detail.record.fileName} · {detail.total}행
          </h2>
          <a href={`/api/statements/${detail.record.id}/file`} className="underline">
            보관한 원본 파일 받기
          </a>
          <p>
            일치 후보도 승인일·금액·가맹점을 확인한 뒤 연결하세요. 새 거래 생성은 기존 거래와 다른
            누락 내역에만 사용합니다. 순액/청구액으로 승인 금액을 자동 보정하지 않습니다.
          </p>
          <ActionForm action={statementDecisionAction}>
            <label>
              선택 행 작업
              <select name="decision" className="rounded border p-2">
                <option value="LINK">유일한 일치 후보에 연결</option>
                <option value="CREATE">확인한 누락 승인/취소 생성</option>
                <option value="IGNORE">거래 반영에서 제외 (원문 보존)</option>
              </select>
            </label>
            {detail.items.map((item) => (
              <article key={item.raw.id} className="rounded border p-3">
                <label>
                  <input
                    type="checkbox"
                    name="rawId"
                    value={item.raw.id}
                    disabled={item.status === 'LINKED'}
                  />
                  {item.raw.title} · {labels[item.status]}
                </label>
                <p>
                  {item.fields
                    ? `${formatDate(new Date(item.fields.approvedAt))} · ${item.fields.merchantName} · ${item.fields.amount.toLocaleString('ko-KR')}원`
                    : '매핑/원문을 확인해주세요.'}
                </p>
                <details>
                  <summary>보존 원문</summary>
                  <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">
                    {item.raw.body}
                  </pre>
                </details>
                <Link href={`/review?rawId=${item.raw.id}`} className="underline">
                  수동 검토
                </Link>
              </article>
            ))}
            <label>
              <input type="checkbox" name="confirmed" required /> 선택 행이 같은 거래인지 또는
              별도의 누락 거래인지 확인했습니다.
            </label>
            <button className="rounded border p-2">선택 행 반영</button>
          </ActionForm>
          {detail.items
            .filter(
              (i) =>
                !['LINKED', 'IGNORED', 'INVALID'].includes(i.status) && i.candidates.length > 0,
            )
            .map((item) => (
              <details key={item.raw.id}>
                <summary>{item.raw.title} · 후보를 지정해 연결/보정</summary>
                <ActionForm action={statementDecisionAction}>
                  <input type="hidden" name="rawId" value={item.raw.id} />
                  <label>
                    기존 거래
                    <select name="targetId" className="rounded border p-2">
                      {item.candidates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {formatDate(t.approvedAt)} · {t.merchantName} ·{' '}
                          {t.amount?.toLocaleString('ko-KR') ?? '미확정'}원
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    작업
                    <select name="decision" className="rounded border p-2">
                      <option value="LINK">근거만 연결</option>
                      {item.fields?.amountKind === 'APPROVAL' && (
                        <option value="CORRECT">기존 승인/취소 금액을 행 금액으로 보정</option>
                      )}
                    </select>
                  </label>
                  <label>
                    <input name="confirmed" type="checkbox" required /> 같은 사건과 보정 금액임을
                    확인했습니다.
                  </label>
                  <button className="rounded border p-2">확인한 판단 저장</button>
                </ActionForm>
              </details>
            ))}
          <nav className="flex justify-between">
            <Link
              href={`/statements?id=${detail.record.id}&page=${Math.max(1, detail.page - 1)}`}
              className="underline"
            >
              이전
            </Link>
            <span>
              {detail.page}/{detail.totalPages}
            </span>
            <Link
              href={`/statements?id=${detail.record.id}&page=${Math.min(detail.totalPages, detail.page + 1)}`}
              className="underline"
            >
              다음
            </Link>
          </nav>
          <details>
            <summary>이 기간 거래 중 아직 이 명세서에 연결하지 않은 건 (최대 100건)</summary>
            <p>행 연결 전에는 정상 거래도 표시됩니다. 명세서에 없다고 취소 처리하지 마세요.</p>
            <ul>
              {detail.unlinked.map((t) => (
                <li key={t.id}>
                  <Link href={`/review?rawId=${t.rawMessageId}`} className="underline">
                    {formatDate(t.approvedAt)} · {t.merchantName} ·{' '}
                    {t.amount?.toLocaleString('ko-KR') ?? '미확정'}원
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </main>
  );
}
