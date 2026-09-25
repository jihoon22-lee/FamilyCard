'use server';
import { revalidatePath } from 'next/cache';
import { requireFamilyScope } from '@/lib/auth/session';
import { saveCategory } from '@/lib/classification';
import { InputError } from '@/lib/cards';
import type { FormResult } from '@/components/forms/ActionForm';
export async function categoryAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireFamilyScope();
  const text = (k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
  try {
    await saveCategory(session, {
      id: text('id') || undefined,
      name: text('name'),
      benefitCode: text('benefitCode') || undefined,
    });
    revalidatePath('/family/categories');
    return { ok: true, message: '분류를 저장했습니다.' };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('category_action_failed');
    return { ok: false, message: '분류를 저장하지 못했습니다. 중복 이름이나 입력을 확인해주세요.' };
  }
}
