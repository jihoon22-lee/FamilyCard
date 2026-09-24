import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { fetchDeviceStatuses } from '@/lib/device-status';
import { DeviceStatusSummary } from '@/components/devices/device-status-summary';

export default async function CollectionPage() {
  const devices = await fetchDeviceStatuses(await requireSession());
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">수집기 상태</h1>
      <p className="text-muted-foreground text-sm">
        새 결제가 없어도 앱은 약 15분마다 상태를 보냅니다. 절전·네트워크에 따라 지연될 수 있으며,
        최근 보고가 있다는 것만으로 모든 알림의 수집을 보장하지는 않습니다.
      </p>
      {devices.length === 0 && <p>등록된 기기가 없습니다.</p>}
      {devices.map((device) => (
        <section key={device.id} className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="font-medium">
            {device.member.name} · {device.deviceName}
            {device.revokedAt ? ' · 폐기됨' : ''}
          </h2>
          <DeviceStatusSummary
            reportedAt={device.statusReportedAt}
            snapshot={device.statusSnapshot}
          />
        </section>
      ))}
      <Link href="/" className="underline">
        대시보드로
      </Link>
    </main>
  );
}
