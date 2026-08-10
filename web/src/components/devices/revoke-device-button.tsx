'use client';

import { useState, useTransition } from 'react';

import { revokeDeviceAction } from '@/app/(family)/family/devices/actions';
import { Button } from '@/components/ui/button';

/**
 * 기기 폐기 버튼. 폰 분실 시 첫 대응이라 확인 다이얼로그를 한 번 거친다.
 * 폐기하면 그 토큰은 즉시 무효가 된다(actions.ts 참고).
 */
export function RevokeDeviceButton({ deviceId }: { deviceId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const confirmed = window.confirm(
      '이 기기를 폐기하시겠습니까?\n폐기하면 이 기기의 토큰은 즉시 무효가 되어 다시 로그인할 수 없습니다.',
    );
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await revokeDeviceAction(deviceId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? '폐기 중…' : '폐기'}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
