'use client';
import { useState, useTransition } from 'react';
import { pushAction } from './actions';
export function PushSettings({
  publicKey,
  canFamily,
}: {
  publicKey: string | null;
  canFamily: boolean;
}) {
  const [message, setMessage] = useState(''),
    [family, setFamily] = useState(false),
    [pending, startTransition] = useTransition();
  function enable() {
    startTransition(async () => {
      try {
        if (
          !publicKey ||
          !('serviceWorker' in navigator) ||
          !('PushManager' in window) ||
          !('Notification' in window)
        ) {
          setMessage(
            '이 환경은 웹 푸시를 지원하지 않거나 서버 설정이 준비되지 않았습니다. 알림 목록은 사용할 수 있습니다.',
          );
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setMessage('브라우저 알림 권한을 허용해야 푸시를 받을 수 있습니다.');
          return;
        }
        const registration = await navigator.serviceWorker.register('/notifications-sw.js');
        await navigator.serviceWorker.ready;
        const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
          c.charCodeAt(0),
        );
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: bytes,
          }));
        const result = await pushAction(subscription.toJSON(), family);
        setMessage(result.message);
      } catch {
        setMessage('푸시를 켜지 못했습니다. 브라우저 권한·HTTPS 연결을 확인해주세요.');
      }
    });
  }
  function disable() {
    startTransition(async () => {
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration('/');
          const subscription = await registration?.pushManager.getSubscription();
          await subscription?.unsubscribe();
        }
        setMessage((await pushAction(null, false, true)).message);
      } catch {
        setMessage('푸시를 끄지 못했습니다. 다시 시도해주세요.');
      }
    });
  }
  return (
    <section className="rounded border p-4">
      <h2 className="font-semibold">선택: 브라우저 푸시</h2>
      <p className="text-sm">
        브라우저 제공자의 푸시 서비스를 경유합니다. 금액·카드명·원문은 보내지 않고 “확인할 알림이
        있습니다”만 전달합니다. 앱 WebView에서 지원하지 않으면 웹 브라우저에서 설정하세요.
      </p>
      {!publicKey && <p>서버 푸시 설정 대기 중입니다.</p>}
      {canFamily && (
        <label>
          <input type="checkbox" checked={family} onChange={(e) => setFamily(e.target.checked)} />{' '}
          가족 알림도 받기
        </label>
      )}
      <div className="mt-2 flex gap-3">
        <button onClick={enable} disabled={pending || !publicKey} className="rounded border p-2">
          이 브라우저에서 받기
        </button>
        <button onClick={disable} disabled={pending} className="rounded border p-2">
          이 계정의 모든 푸시 끄기
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
