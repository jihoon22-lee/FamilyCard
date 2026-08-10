import Link from 'next/link';
import type { Metadata } from 'next';

import { requireFamilyScope } from '@/lib/auth/session';
import { visibleMemberIds } from '@/lib/auth/scope';
import { prisma } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RegisterDeviceForm } from '@/components/devices/register-device-form';
import { RevokeDeviceButton } from '@/components/devices/revoke-device-button';

export const metadata: Metadata = {
  title: '기기 관리 · FamilyCard',
};

function formatLastSeen(date: Date | null): string {
  if (!date) return '아직 접속 기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

// 안드로이드 앱이 로그인 화면 없이 바로 대시보드를 열 수 있게 하는 디바이스
// 토큰을 구성원별로 발급·폐기하는 화면. ADMIN 전용 — (family) 그룹 아래
// 있어 미들웨어가 1차로, requireFamilyScope() 가 2차로 scope 를 검사한다.
// → docs/plan/phase2-contract.md §4
export default async function DevicesPage() {
  const session = await requireFamilyScope();

  const visible = await visibleMemberIds(session);

  const [members, devices] = await Promise.all([
    prisma.familyMember.findMany({
      where: { id: { in: visible } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.device.findMany({
      where: { memberId: { in: visible } },
      select: {
        id: true,
        deviceName: true,
        lastSeenAt: true,
        revokedAt: true,
        member: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">관리자</p>
          <h1 className="text-xl font-semibold sm:text-2xl">기기 관리</h1>
        </div>
        <Link href="/family" className="text-muted-foreground text-sm underline underline-offset-4">
          가족 전체 보기로
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>새 기기 추가</CardTitle>
          <CardDescription>
            구성원을 선택하고 기기 이름을 입력하면 토큰이 발급됩니다. 발급된 토큰은 안드로이드 앱
            설정 화면에 입력하세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterDeviceForm members={members} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>등록된 기기</CardTitle>
          <CardDescription>
            {devices.length === 0 ? '등록된 기기가 없습니다.' : `총 ${devices.length}대`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {devices.map((device) => (
            <div
              key={device.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">
                  {device.deviceName}
                  {device.revokedAt && (
                    <span className="text-destructive ml-2 text-xs font-normal">폐기됨</span>
                  )}
                </p>
                <p className="text-muted-foreground text-xs">{device.member.name}</p>
                <p className="text-muted-foreground text-xs">
                  마지막 접속: {formatLastSeen(device.lastSeenAt)}
                </p>
              </div>
              {!device.revokedAt && <RevokeDeviceButton deviceId={device.id} />}
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
