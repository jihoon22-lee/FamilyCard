'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { createPreview, applyPreview, advanceRun } from '@/lib/reprocessing';
import { InputError } from '@/lib/cards';
import type { FormResult } from '@/components/forms/ActionForm';
const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};
export async function reprocessAction(_previous: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    const intent = text(f, 'intent');
    if (intent === 'apply') {
      await applyPreview(session, text(f, 'id'), f.get('acknowledge') === 'on');
    } else if (intent === 'advance') {
      await advanceRun(session, text(f, 'id'));
    } else {
      await createPreview(session, {
        issuer: text(f, 'issuer') || undefined,
        status: text(f, 'status') || undefined,
        from: text(f, 'from') || undefined,
        to: text(f, 'to') || undefined,
      });
    }
    revalidatePath('/reprocess');
    return { ok: true, message: '작업을 저장했습니다. 진행 상태를 새로고침해서 확인하세요.' };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('reprocess_action_failed');
    return { ok: false, message: '작업을 완료하지 못했습니다. 새로고침 후 다시 확인해주세요.' };
  }
}
