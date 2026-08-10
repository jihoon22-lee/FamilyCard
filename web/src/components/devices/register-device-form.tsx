'use client';

import { useActionState, useState } from 'react';

import {
  registerDeviceAction,
  type RegisterDeviceState,
} from '@/app/(family)/family/devices/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MemberOption {
  id: string;
  name: string;
}

const initialState: RegisterDeviceState = { status: 'idle' };

/**
 * 기기 등록 폼 + 발급 직후 1회성 토큰 표시.
 *
 * 토큰 원문은 registerDeviceAction 의 반환값(React 상태)에만 존재하고
 * 어디에도 저장되지 않는다 — 화면을 새로고침하거나 다른 기기를 또
 * 등록하면 다시는 볼 수 없다. QR 코드는 아직 지원하지 않는다(package.json
 * 에 QR 생성 라이브러리가 없어 새로 설치하지 않았다 — 보고서 참고). 대신
 * 토큰 문자열을 큰 글씨로 보여주고 복사 버튼을 제공한다.
 */
export function RegisterDeviceForm({ members }: { members: MemberOption[] }) {
  const [state, formAction, isPending] = useActionState(registerDeviceAction, initialState);
  const [copied, setCopied] = useState(false);

  async function handleCopy(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (state.status === 'success') {
    return (
      <div className="flex flex-col gap-4">
        <div className="border-destructive/50 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-4">
          <p className="text-sm font-semibold">
            {state.memberName}님의 &ldquo;{state.deviceName}&rdquo; 토큰이 발급됐습니다
          </p>
          <p className="text-destructive text-sm font-medium">
            이 토큰은 지금 한 번만 표시됩니다. 다시 볼 수 없으니 안전하게 복사해 앱에 입력해주세요.
          </p>
          <code className="bg-background block rounded-md border p-3 text-sm break-all">
            {state.token}
          </code>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void handleCopy(state.token)}>
              {copied ? '복사됨' : '토큰 복사'}
            </Button>
            <p className="text-muted-foreground text-xs">QR 코드 등록은 추후 지원 예정입니다.</p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          다른 기기 등록하기
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="register-device-member">구성원</Label>
        <select
          id="register-device-member"
          name="memberId"
          required
          disabled={isPending}
          defaultValue=""
          className="border-input h-11 w-full rounded-md border bg-transparent px-3 text-base shadow-xs outline-none md:text-sm"
        >
          <option value="" disabled>
            구성원을 선택하세요
          </option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="register-device-name">기기 이름</Label>
        <Input
          id="register-device-name"
          name="deviceName"
          type="text"
          placeholder="예: 하은이 갤럭시"
          required
          disabled={isPending}
        />
      </div>

      {state.status === 'error' && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? '발급 중…' : '토큰 발급'}
      </Button>
    </form>
  );
}
