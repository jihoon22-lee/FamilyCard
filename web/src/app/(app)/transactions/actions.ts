'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { classifyTransaction } from '@/lib/classification';
import { InputError } from '@/lib/cards';
import type { FormResult } from '@/components/forms/ActionForm';
export async function classifyAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  const text = (k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
  try {
    await classifyTransaction(session, {
      id: text('id'),
      categoryId: text('categoryId') || undefined,
      benefitOverride: text('benefitOverride') || undefined,
      learn: f.get('learn') === 'on',
    });
    revalidatePath('/transactions');
    revalidatePath('/benefits');
    return { ok: true, message: '거래 분류와 실적 포함 판단을 저장했습니다.' };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('classification_action_failed');
    return { ok: false, message: '저장하지 못했습니다. 다시 확인해주세요.' };
  }
}
