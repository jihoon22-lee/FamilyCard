import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { changePassword } from '@/lib/auth/account';
import { InputError } from '@/lib/cards';
async function change(form: FormData) {
  'use server';
  const session = await requireSession();
  try {
    await changePassword(
      session,
      String(form.get('current') ?? ''),
      String(form.get('next') ?? ''),
    );
  } catch (e) {
    if (e instanceof InputError) redirect('/account?error=' + encodeURIComponent(e.message));
    throw e;
  }
  redirect('/login');
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireSession();
  if (session.entrypoint !== 'WEB')
    return <p>비밀번호 변경은 웹 브라우저에서 로그인한 뒤 진행해주세요.</p>;
  const { error } = await searchParams;
  return (
    <main>
      <h1>비밀번호 변경</h1>
      <p>변경하면 현재 브라우저를 포함한 모든 웹 세션이 종료됩니다. 앱 수집은 유지됩니다.</p>
      {error && <p role="alert">{error}</p>}
      <form action={change}>
        <label>
          현재 비밀번호
          <input type="password" name="current" autoComplete="current-password" required />
        </label>
        <label>
          새 비밀번호
          <input type="password" name="next" autoComplete="new-password" minLength={8} required />
        </label>
        <button>변경 후 다시 로그인</button>
      </form>
    </main>
  );
}
