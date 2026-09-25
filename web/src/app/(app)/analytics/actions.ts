'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { saveBudget } from '@/lib/budgets';
import { InputError } from '@/lib/cards';
import type { FormResult } from '@/components/forms/ActionForm';
export async function budgetAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  const text = (k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
  try {
    if (!/^\d+$/.test(text('amount'))) throw new InputError('예산을 원 단위로 입력해주세요.');
    await saveBudget(session, {
      id: text('id') || undefined,
      memberId: text('memberId') || undefined,
      categoryId: text('categoryId') || undefined,
      month: text('month'),
      amount: Number(text('amount')),
    });
    revalidatePath('/analytics');
    revalidatePath('/family');
    return { ok: true, message: '예산을 저장했습니다.' };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('budget_action_failed');
    return { ok: false, message: '예산을 저장하지 못했습니다.' };
  }
}
