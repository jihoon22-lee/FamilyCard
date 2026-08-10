'use client';

import { useActionState } from 'react';

import { signUpAction, type AuthResult } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initialState: AuthResult = { ok: true };

/**
 * 가입 폼. useActionState로 signUpAction의 결과(AuthResult)를 받아
 * 실패 시(중복 이름·잘못된 초대 코드 등) 한국어 에러 문구를 보여줍니다.
 * 성공 시 리다이렉트는 액션 내부에서 처리됩니다.
 */
export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(
    (_prevState: AuthResult, formData: FormData) => signUpAction(formData),
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="signup-name">이름</Label>
        <Input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="username"
          required
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="signup-password">비밀번호</Label>
        <Input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="signup-invite-code">초대 코드</Label>
        <Input
          id="signup-invite-code"
          name="inviteCode"
          type="text"
          autoComplete="off"
          required
          disabled={isPending}
        />
        <p className="text-muted-foreground text-xs">가족에게 받은 초대 코드를 입력하세요.</p>
      </div>

      {!state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={isPending}>
        {isPending ? '가입 중…' : '가입하기'}
      </Button>
    </form>
  );
}
