'use client';
import { useActionState, type ReactNode } from 'react';
export interface FormResult {
  ok: boolean;
  message: string;
}
export function ActionForm({
  action,
  children,
}: {
  action: (previous: FormResult, form: FormData) => Promise<FormResult>;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: '' });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        {children}
      </fieldset>
      {pending && <p role="status">처리 중…</p>}
      {state.message && (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={state.ok ? 'text-sm' : 'text-destructive text-sm'}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
