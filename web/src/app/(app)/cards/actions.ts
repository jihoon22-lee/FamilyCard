'use server';
import { linkObservedCard } from '@/lib/observed-cards';
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
      message: '카드를 저장했습니다. 알림에서 발견한 카드 묶음에 연결할 수 있습니다.',
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

export async function linkObservedCardAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const session = await requireSession();
  try {
    const result = await linkObservedCard(session, {
      memberId: text(form, 'memberId'),
      issuer: text(form, 'issuer'),
      token: text(form, 'token'),
      cardId: text(form, 'cardId'),
    });
    revalidatePath('/', 'layout');
    return {
      ok: true,
      message: `기존 거래 ${result.linked}건을 연결했습니다. 이후 같은 표기의 알림도 자동 연결됩니다.${result.skipped ? ` 수동 수정·유효 기간 등으로 ${result.skipped}건은 유지했습니다.` : ''}`,
    };
  } catch (error) {
    if (error instanceof InputError) return { ok: false, message: error.message };
    console.error('observed_card_link_failed');
    return { ok: false, message: '연결하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
