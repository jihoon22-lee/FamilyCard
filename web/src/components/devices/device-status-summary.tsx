import { parseDeviceStatus, statusFreshness } from '@/lib/device-status';

function time(value: number | Date | null): string {
  if (!value) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
}

export function DeviceStatusSummary({
  reportedAt,
  snapshot,
}: {
  reportedAt: Date | null;
  snapshot: unknown;
}) {
  const status = parseDeviceStatus(snapshot);
  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-xs">
      <p>{statusFreshness(reportedAt)}</p>
      <p>상태 도착: {time(reportedAt)} (한국 시간)</p>
      {status ? (
        <>
          <p>
            앱 빌드 {status.versionCode} · 대기 {status.pending}건 · 확인 필요 {status.rejected}건
          </p>
          <p>
            폰 관찰: {time(status.sampledAt)} · 마지막 로컬 저장: {time(status.lastQueuedAt)}
          </p>
          <p>
            전송 시도: {time(status.lastUploadAttemptAt)} · 응답 반영: {time(status.lastUploadAt)}
          </p>
          <p>
            알림 접근 {status.notificationGranted ? '허용' : '꺼짐'} · 문자 수신{' '}
            {status.smsGranted ? '허용' : '꺼짐'} · 문자 읽기{' '}
            {status.smsReadGranted ? '허용' : '꺼짐'}
          </p>
          <p>
            RCS 자동 보충 {status.rcsEnabled ? '켜짐' : '꺼짐'} · 확인 시도:{' '}
            {time(status.rcsAttemptedAt)} · 조회 완료 구간: {time(status.rcsCompletedThrough)}
          </p>
        </>
      ) : (
        <p>상태 보고를 지원하는 앱이 연결되면 표시됩니다.</p>
      )}
    </div>
  );
}
