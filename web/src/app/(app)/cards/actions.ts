'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { InputError, saveCard, saveAlias } from '@/lib/cards';
import type { FormResult } from '@/components/forms/ActionForm';
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};
export async function saveCardAction(_previous: FormResult, form: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    await saveCard(session, {
      id: text(form, 'id') || undefined,
      memberId: text(form, 'memberId'),
      issuer: text(form, 'issuer'),
      nickname: text(form, 'nickname'),
      last4: text(form, 'last4'),
      cardType: text(form, 'cardType'),
      statementDay: Number(text(form, 'statementDay')),
      isActive: form.get('isActive') === 'on',
      validFrom: text(form, 'validFrom'),
      validTo: text(form, 'validTo'),
    });
    revalidatePath('/cards');
    revalidatePath('/');
    revalidatePath('/review');
    return {
      ok: true,
      message: '카드를 저장했습니다. 기존 미확정 원문은 재처리에서 다시 분석할 수 있습니다.',
    };
  } catch (error) {
    if (error instanceof InputError) return { ok: false, message: error.message };
    console.error('card_save_failed');
    return { ok: false, message: '저장하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
export async function saveAliasAction(_previous: FormResult, form: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    await saveAlias(session, {
      cardId: text(form, 'cardId'),
      token: text(form, 'token'),
      validFrom: text(form, 'validFrom'),
      validTo: text(form, 'validTo'),
    });
    revalidatePath('/cards');
    return { ok: true, message: '표기를 저장했습니다. 중복된 후보는 자동 확정하지 않습니다.' };
  } catch (error) {
    if (error instanceof InputError) return { ok: false, message: error.message };
    console.error('alias_save_failed');
    return { ok: false, message: '표기를 저장하지 못했습니다.' };
  }
}
