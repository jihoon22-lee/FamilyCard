import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { revokeWebSessions } from '@/lib/auth/account';
import { visibleMemberIds } from '@/lib/auth/scope';
import { prisma } from '@/lib/db';
async function revoke(form: FormData) {
  'use server';
  await revokeWebSessions(await requireSession(), String(form.get('memberId') ?? ''));
  redirect('/family/sessions');
}
export default async function Page() {
  const session = await requireSession();
  if (session.entrypoint !== 'WEB' || session.scope !== 'FAMILY' || session.role !== 'ADMIN')
    redirect('/');
  const members = await prisma.familyMember.findMany({
    where: { id: { in: await visibleMemberIds(session) } },
    select: { id: true, name: true },
  });
  return (
    <main>
      <h1>웹 세션 종료</h1>
      <p>선택한 구성원의 모든 웹 로그인을 종료합니다. 앱 수집과 기기 세션은 유지됩니다.</p>
      {members.map((m) => (
        <form key={m.id} action={revoke}>
          <input type="hidden" name="memberId" value={m.id} />
          <span>{m.name}</span>
          <button>모든 웹 세션 종료</button>
        </form>
      ))}
    </main>
  );
}
