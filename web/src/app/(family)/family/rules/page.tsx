import Link from 'next/link';
import { requireFamilyScope } from '@/lib/auth/session';
import { rulePageData, draftPattern } from '@/lib/parser-rules';
import { dateTimeInput } from '@/lib/time';
import { ActionForm } from '@/components/forms/ActionForm';
import { ruleAction, restoreRuleAction } from './actions';
const input = 'w-full rounded-md border p-2';
type Rule = Awaited<ReturnType<typeof rulePageData>>['rules'][number];
function Fields({
  rule,
  draft,
  at,
}: {
  rule?: Rule;
  draft?: ReturnType<typeof draftPattern>;
  at: Date;
}) {
  return (
    <>
      {rule && (
        <>
          <input type="hidden" name="id" value={rule.id} />
          <input type="hidden" name="version" value={rule.version} />
        </>
      )}
      <label>
        카드사 코드
        <input
          name="issuer"
          defaultValue={rule?.issuer ?? ''}
          maxLength={40}
          required
          className={input}
        />
      </label>
      <label>
        동작
        <select name="action" defaultValue={rule?.action ?? 'PARSE'} className={input}>
          <option value="PARSE">거래 해석</option>
          <option value="IGNORE">명시적 무시 (원문 보존)</option>
        </select>
      </label>
      <label>
        우선순위 (작은 숫자 우선)
        <input
          name="priority"
          type="number"
          min={-100000}
          max={100000}
          defaultValue={rule?.priority ?? 100}
          required
          className={input}
        />
      </label>
      <label>
        적용 조건 정규식
        <textarea
          name="matchPattern"
          maxLength={2048}
          defaultValue={rule?.matchPattern ?? draft?.pattern ?? '^$'}
          required
          className={input}
        />
      </label>
      <label>
        필드 추출 정규식
        <textarea
          name="extractPattern"
          maxLength={2048}
          defaultValue={rule?.extractPattern ?? draft?.pattern ?? '^$'}
          required
          className={input}
        />
      </label>
      <label>
        필드 매핑 (JSON)
        <textarea
          name="fieldMap"
          maxLength={8000}
          rows={7}
          defaultValue={JSON.stringify(rule?.fieldMap ?? draft?.fieldMap ?? {}, null, 2)}
          required
          className={input}
        />
      </label>
      <label>
        가공 샘플 (이름·가맹점·금액·카드번호를 가짜로 바꿔 입력)
        <textarea
          name="sampleText"
          maxLength={16000}
          rows={5}
          defaultValue={rule?.sampleText ?? ''}
          className={input}
        />
      </label>
      <label>
        샘플 수신 시각 (한국 시간)
        <input
          name="sampleReceivedAt"
          type="datetime-local"
          defaultValue={dateTimeInput(at)}
          required
          className={input}
        />
      </label>
      <label>
        <input name="isActive" type="checkbox" defaultChecked={rule?.isActive ?? false} /> 활성화
      </label>
      <label>
        <input name="confirmed" type="checkbox" /> 시험 결과의 금액·시각·카드 표기·종류를
        확인했습니다.
      </label>
      <div className="flex gap-3">
        <button name="intent" value="preview" className="rounded border px-3 py-2">
          저장 전 시험
        </button>
        <button
          name="intent"
          value="save"
          className="bg-primary text-primary-foreground rounded px-3 py-2"
        >
          규칙 저장
        </button>
      </div>
    </>
  );
}
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ rawId?: string }>;
}) {
  const session = await requireFamilyScope();
  const { rawId } = await searchParams;
  const { rules, raw } = await rulePageData(session, rawId);
  const draft = raw ? draftPattern(raw) : undefined;
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex justify-between">
        <h1 className="text-2xl font-semibold">파싱 규칙 관리</h1>
        <Link href="/review" className="underline">
          확인할 거래
        </Link>
      </header>
      <p>
        규칙은 가족 전체의 해석에 적용됩니다. 초안은 비활성이며 카드사·거래 종류·필드의 의미는 직접
        확인해야 합니다. 우선순위가 가장 높은 첫 일치 규칙을 사용합니다.
      </p>
      <details>
        <summary>필드 매핑 작성 도움말</summary>
        <p className="text-sm">
          추출 정규식의 명명 그룹을 from에 지정합니다. 금액은 money, 카드 표기는 card_token, 날짜는
          datetime_md 또는 datetime_iso, 고정 거래 종류는 const를 사용합니다. 취소 금액도
          양수입니다. approvalReference는 해당 사건의 고유 번호만 사용하고 취소에서 원승인 번호를
          재사용하지 마세요.
        </p>
        <pre className="overflow-auto text-xs">
          {JSON.stringify(
            {
              amount: { type: 'money', from: 'number1' },
              cardToken: { type: 'card_token', from: 'token' },
              approvedAt: { type: 'datetime_md', from: ['month', 'day', 'time'] },
              txType: { type: 'const', value: 'APPROVAL' },
              merchant: { type: 'text', from: 'merchant' },
            },
            null,
            2,
          )}
        </pre>
      </details>
      {raw && (
        <details open>
          <summary>선택한 원문에서 만든 구조 초안</summary>
          <pre className="max-h-64 overflow-auto text-sm whitespace-pre-wrap">{draft?.sample}</pre>
          <p>
            number1 등의 그룹은 숫자 후보이며 금액·날짜·카드번호로 자동 확정하지 않습니다. 샘플에는
            가공한 문구를 입력하세요.
          </p>
        </details>
      )}
      <section className="rounded border p-4">
        <h2 className="mb-3 font-semibold">새 규칙</h2>
        <ActionForm action={ruleAction}>
          <Fields draft={draft} at={raw?.receivedAt ?? new Date()} />
        </ActionForm>
      </section>
      <p className="text-sm">
        최대 500개 규칙과 각 최근 20개 버전을 표시합니다. 과거 이력은 DB에 보존됩니다.
      </p>
      {rules.map((rule) => (
        <section key={rule.id} className="rounded border p-4">
          <h2 className="font-semibold">
            {rule.issuer} · v{rule.version} · {rule.action} · {rule.isActive ? '활성' : '비활성'}
          </h2>
          <details>
            <summary>편집·시험 적용</summary>
            <ActionForm action={ruleAction}>
              <Fields rule={rule} at={new Date()} />
            </ActionForm>
          </details>
          <details>
            <summary>이전 설정 복원</summary>
            <ActionForm action={restoreRuleAction}>
              <input type="hidden" name="id" value={rule.id} />
              <input type="hidden" name="version" value={rule.version} />
              <label>
                복원할 버전
                <select name="restoreVersion" className={input}>
                  {rule.revisions.map((r) => (
                    <option key={r.id} value={r.version}>
                      v{r.version} ({r.createdAt.toISOString().slice(0, 10)})
                    </option>
                  ))}
                </select>
              </label>
              <button className="rounded border p-2">새 비활성 버전으로 복원</button>
            </ActionForm>
          </details>
        </section>
      ))}
    </main>
  );
}
