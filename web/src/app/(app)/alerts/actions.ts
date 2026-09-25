'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { readAlert } from '@/lib/alerts';
import { subscribe, unsubscribe, pushPublicKey } from '@/lib/alerts/push';
import { InputError } from '@/lib/cards';
import type { FormResult } from '@/components/forms/ActionForm';
export async function readAlertAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    await readAlert(session, String(f.get('id') ?? ''));
    revalidatePath('/alerts');
    return { ok: true, message: '확인했습니다.' };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('alert_read_failed');
    return { ok: false, message: '확인 처리하지 못했습니다.' };
  }
}
export async function pushAction(
  value: unknown,
  family: boolean,
  disable = false,
): Promise<FormResult> {
  const session = await requireSession();
  try {
    if (disable) {
      await unsubscribe(session);
      return { ok: true, message: '이 계정의 브라우저 푸시를 모두 껐습니다.' };
    }
    if (!pushPublicKey()) throw new InputError('서버 푸시 설정이 아직 준비되지 않았습니다.');
    await subscribe(session, value, family);
    return { ok: true, message: '브라우저 푸시를 켰습니다. 거래 내용은 보내지 않습니다.' };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('push_subscription_failed');
    return {
      ok: false,
      message: '구독하지 못했습니다. 브라우저의 이전 구독을 끈 뒤 다시 시도해주세요.',
    };
  }
}
