import Link from 'next/link';
import { requireFamilyScope } from '@/lib/auth/session';
import { categories } from '@/lib/classification';
import { EXCLUSIONS } from '@/lib/benefit';
import { ActionForm } from '@/components/forms/ActionForm';
import { categoryAction } from './actions';
function Fields({ id, name, code }: { id?: string; name?: string; code?: string | null }) {
  return (
    <>
      {id && <input type="hidden" name="id" value={id} />}
      <label>
        분류 이름
        <input
          name="name"
          required
          maxLength={50}
          defaultValue={name ?? ''}
          className="rounded border p-2"
        />
      </label>
      <label>
        실적 제외 항목 연결
        <select name="benefitCode" defaultValue={code ?? ''} className="rounded border p-2">
          <option value="">연결 없음</option>
          {Object.entries(EXCLUSIONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <button className="rounded border p-2">저장</button>
    </>
  );
}
export default async function CategoriesPage() {
  await requireFamilyScope();
  const rows = await categories();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">가족 공용 카테고리</h1>
      <Link href="/transactions" className="underline">
        거래 분류하기
      </Link>
      <p>분류 이름은 가족이 공유합니다. 같은 가맹점 자동 분류 학습은 거래 소유자별로 적용됩니다.</p>
      <ActionForm action={categoryAction}>
        <Fields />
      </ActionForm>
      {rows.map((c) => (
        <details key={c.id}>
          <summary>{c.name}</summary>
          <ActionForm action={categoryAction}>
            <Fields id={c.id} name={c.name} code={c.benefitCode} />
          </ActionForm>
        </details>
      ))}
    </main>
  );
}
