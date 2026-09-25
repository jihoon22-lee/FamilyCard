import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/auth/session';
import { repairCardProjection } from '@/lib/processing/repair';
async function run(form: FormData) {
  'use server';
  const session = await getAppSession();
  if (!session) redirect('/login');
  const cardId = String(form.get('cardId') ?? '');
  const result = await repairCardProjection(session, cardId, form.get('apply') === 'yes');
  redirect(
    `/family/projection?scanned=${result.scanned}&changed=${result.changed}&applied=${!result.dryRun}`,
  );
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getAppSession();
  if (
    !session ||
    session.entrypoint !== 'WEB' ||
    session.role !== 'ADMIN' ||
    session.scope !== 'FAMILY'
  )
    redirect('/');
  const result = await searchParams;
  return (
    <main>
      <h1>취소 투영 복구</h1>
      <p>
        기본은 전체 이력 비교만 수행합니다. 변경 건수를 확인한 뒤 반영하세요. 최대 100,000건이며 큰
        원장은 시간이 걸릴 수 있습니다.
      </p>
      <form action={run}>
        <label>
          카드 ID <input name="cardId" required />
        </label>
        <label>
          <input type="checkbox" name="apply" value="yes" />
          비교 결과를 확인했으며 변경을 반영합니다
        </label>
        <button>실행</button>
      </form>
      {result.scanned && (
        <p>
          조회 {result.scanned}건 · 차이 {result.changed}건 ·{' '}
          {result.applied === 'true' ? '반영 완료' : '비교만 완료'}
        </p>
      )}
    </main>
  );
}
