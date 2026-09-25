import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { listAlerts } from '@/lib/alerts';
import { pushPublicKey } from '@/lib/alerts/push';
import { formatDate } from '@/lib/time';
import { ActionForm } from '@/components/forms/ActionForm';
import { readAlertAction } from './actions';
import { PushSettings } from './PushSettings';
export default async function AlertsPage() {
  const session = await requireSession(),
    alerts = await listAlerts(session);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex justify-between">
        <h1 className="text-2xl font-semibold">운영·실적 알림</h1>
        <Link href="/" className="underline">
          대시보드
        </Link>
      </header>
      <p>
        상태 보고 지연, 산정 기간 종료 5일 이내 최소 실적 구간 80% 미만, 이전 달성 구간 아래로 바뀐
        추정치를 확인합니다. 주기 검사가 켜진 서버에서 약 1시간마다 갱신됩니다.
      </p>
      <PushSettings
        publicKey={pushPublicKey()}
        canFamily={session.scope === 'FAMILY' && session.entrypoint === 'WEB'}
      />
      {alerts.length === 0 && <p>표시할 알림이 없습니다.</p>}
      {alerts.map((a) => (
        <article key={a.id} className="rounded border p-4">
          <p className="text-xs">
            {a.member.name} · {formatDate(a.createdAt)}
            {a.readAt ? ' · 확인함' : ''}
          </p>
          <p>{a.message}</p>
          <Link href={a.href} className="underline">
            관련 화면 확인
          </Link>
          {!a.readAt && a.memberId === session.memberId && (
            <ActionForm action={readAlertAction}>
              <input type="hidden" name="id" value={a.id} />
              <button className="rounded border p-2">확인 처리</button>
            </ActionForm>
          )}
        </article>
      ))}
    </main>
  );
}
