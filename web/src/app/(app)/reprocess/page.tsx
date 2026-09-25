import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { listRuns } from '@/lib/reprocessing';
import { ActionForm } from '@/components/forms/ActionForm';
import { reprocessAction } from './actions';
const input = 'w-full rounded border p-2';
export default async function ReprocessPage() {
  const session = await requireSession();
  const runs = await listRuns(session);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex justify-between">
        <h1 className="text-2xl font-semibold">원문 재분석</h1>
        <Link href="/review" className="underline">
          거래 검토
        </Link>
      </header>
      <p>
        먼저 미리보기를 실행합니다. 결과는 파싱·카드 연결 기준 예상이며, 복수 출처 병합·취소 연결은
        실제 처리 후 검토해야 합니다. 수동 판단과 원문은 보존됩니다.
      </p>
      <ActionForm action={reprocessAction}>
        <input type="hidden" name="intent" value="preview" />
        <label>
          카드사 코드 (비우면 전체)
          <input name="issuer" maxLength={40} className={input} />
        </label>
        <p className="text-xs">
          카드사 필터는 이전에 식별된 카드사를 사용합니다. 규칙이 없었던 원문은 카드사 필터를 비워야
          포함됩니다.
        </p>
        <label>
          처리 상태
          <select name="status" className={input}>
            <option value="">전체</option>
            {['PENDING', 'FAILED', 'NEEDS_CARD', 'PARSED', 'IGNORED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          수신 시작일 (한국 시간)
          <input name="from" type="date" className={input} />
        </label>
        <label>
          수신 종료일 (당일 포함)
          <input name="to" type="date" className={input} />
        </label>
        <button className="bg-primary text-primary-foreground rounded p-2">미리보기 예약</button>
      </ActionForm>
      <Link href="/reprocess" className="underline">
        진행 상태 새로고침
      </Link>
      <p className="text-sm">
        자동 처리가 켜진 서버에서는 페이지를 닫아도 진행됩니다. 반영 완료는 분석 예약 완료를 뜻하며
        실제 처리 대기·오류는 거래 검토 화면에서 확인하세요.
      </p>
      {runs.map((run) => (
        <section key={run.id} className="rounded border p-4">
          <h2 className="font-semibold">
            {run.mode === 'PREVIEW' ? '미리보기' : '반영 예약'} · {run.state}
          </h2>
          <p className="text-xs">
            {run.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
          </p>
          <p>
            검사 {run.summary.total} · 복구 예상 {run.summary.wouldFix} · 변경 예상{' '}
            {run.summary.wouldChange} · 악화 예상 {run.summary.wouldBreak} · 수동 보존{' '}
            {run.summary.skippedManual} · 예약 {run.summary.queued}
          </p>
          {run.error && (
            <p role="alert">
              {run.error === 'CONFIG_CHANGED'
                ? '규칙/카드가 변경되어 중단했습니다. 새 미리보기를 실행하세요.'
                : '처리 오류입니다. 새 미리보기를 실행해주세요.'}
            </p>
          )}
          {run.summary.wouldBreak > 0 && (
            <p className="text-destructive">
              기존에 해석하던 거래가 미확정 또는 무시로 바뀔 수 있습니다. 실제 재처리에 실패해도
              기존 거래는 보존됩니다.
            </p>
          )}
          {run.summary.samples.length > 0 && (
            <ul>
              {run.summary.samples.map((sample) => (
                <li key={sample.rawId}>
                  <Link
                    className="underline"
                    href={`/review?rawId=${encodeURIComponent(sample.rawId)}`}
                  >
                    {sample.before} → {sample.after} 원문 확인
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {run.state === 'PENDING' && (
            <ActionForm action={reprocessAction}>
              <input type="hidden" name="id" value={run.id} />
              <input type="hidden" name="intent" value="advance" />
              <button className="rounded border p-2">다음 20건 진행</button>
            </ActionForm>
          )}
          {run.mode === 'PREVIEW' && run.state === 'DONE' && (
            <ActionForm action={reprocessAction}>
              <input type="hidden" name="id" value={run.id} />
              <input type="hidden" name="intent" value="apply" />
              {run.summary.wouldBreak > 0 && (
                <label>
                  <input name="acknowledge" type="checkbox" required /> 악화 예상 건을 확인했습니다.
                </label>
              )}
              <button className="rounded border p-2">미리본 원문 재분석 예약</button>
            </ActionForm>
          )}
        </section>
      ))}
    </main>
  );
}
