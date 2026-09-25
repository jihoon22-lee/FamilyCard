'use client';
import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { uploadStatement, type UploadResult } from './actions';
export function UploadForm({ cards }: { cards: Array<{ id: string; label: string }> }) {
  const [file, setFile] = useState<File | null>(null),
    [result, setResult] = useState<UploadResult | null>(null),
    [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null),
    router = useRouter();
  function run(intent: string) {
    if (!file || !form.current) {
      setResult({ ok: false, message: '파일을 선택해주세요.' });
      return;
    }
    const data = new FormData(form.current);
    data.set('file', file);
    data.set('intent', intent);
    startTransition(async () => {
      try {
        const response = await uploadStatement(data);
        setResult((previous) => ({ ...response, preview: response.preview ?? previous?.preview }));
        if (response.id) {
          router.push('/statements?id=' + encodeURIComponent(response.id));
          router.refresh();
        }
      } catch {
        setResult((previous) => ({
          ...previous,
          ok: false,
          message: '연결을 확인하고 다시 시도해주세요.',
        }));
      }
    });
  }
  const columns = (name: string, label: string) => (
    <label>
      {label}
      <select name={name} className="rounded border p-2">
        {result?.preview?.headers.map((h, i) => (
          <option key={i} value={i}>
            {i + 1}: {h || '(빈 이름)'}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form ref={form} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <label>
          CSV/XLSX (첫 행: 열 이름, 한 카드의 원화 내역)
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
        </label>
        <label>
          CSV 인코딩
          <select name="encoding" className="rounded border p-2">
            <option value="utf-8">UTF-8</option>
            <option value="euc-kr">EUC-KR</option>
          </select>
        </label>
        <button type="button" onClick={() => run('preview')} className="rounded border p-2">
          열 미리보기
        </button>
        {result?.preview && (
          <>
            <p>{result.preview.count}행 · 첫 5행</p>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    {result.preview.headers.map((h, i) => (
                      <th key={i} className="border p-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.preview.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => (
                        <td key={j} className="max-w-48 border p-1 break-all">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label>
              카드
              <select name="cardId" className="rounded border p-2">
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {columns('date', '이용/승인 날짜 열')}
            {columns('amount', '원화 금액 열')}
            {columns('merchant', '가맹점 열')}
            <label>
              거래 종류
              <select name="fixedType" className="rounded border p-2">
                <option value="APPROVAL">모든 행 승인</option>
                <option value="CANCELLATION">모든 행 취소</option>
                <option value="COLUMN">종류 열에서 승인/취소 구분</option>
              </select>
            </label>
            {columns('typeColumn', '거래 종류 열 (열에서 구분할 때)')}
            <label>
              금액 열 의미
              <select name="amountKind" className="rounded border p-2">
                <option value="APPROVAL">원승인/취소 금액</option>
                <option value="NET">취소 반영 후 잔액 (비교·연결)</option>
                <option value="BILLED">청구액 (비교·연결)</option>
              </select>
            </label>
            <label>
              명세서 조회 시작일
              <input name="from" type="date" required className="rounded border p-2" />
            </label>
            <label>
              명세서 조회 종료일
              <input name="to" type="date" required className="rounded border p-2" />
            </label>
            <label>
              <input name="remap" type="checkbox" /> 이미 올린 같은 파일이면 미연결 행의 열 매핑만
              수정
            </label>
            <label>
              <input name="confirmed" type="checkbox" /> 이 파일이 선택한 카드 한 장의 원화 내역이며
              열·금액 의미·기간을 확인했습니다.
            </label>
            <button
              type="button"
              onClick={() => run('import')}
              className="bg-primary text-primary-foreground rounded p-2"
            >
              파일·행 원문 보관
            </button>
          </>
        )}
      </fieldset>
      {pending && <p role="status">처리 중…</p>}
      {result?.message && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
    </form>
  );
}
