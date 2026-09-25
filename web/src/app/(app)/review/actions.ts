'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import type { FormResult } from '@/components/forms/ActionForm';
import { InputError } from '@/lib/cards';
import { saveManualTransaction, mergeTransactions, splitEvidence } from '@/lib/review';
import { processBatch, queueRawIds } from '@/lib/processing';
const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};
function refresh() {
  for (const path of ['/', '/cards', '/review', '/transactions', '/family']) revalidatePath(path);
}
const failed = (error: unknown): FormResult => {
  if (error instanceof InputError) return { ok: false, message: error.message };
  console.error('review_action_failed');
  return { ok: false, message: '변경하지 못했습니다. 새로고침 후 다시 시도해주세요.' };
};
export async function manualAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    const amount = text(f, 'amount');
    if (!/^\d+$/.test(amount)) throw new InputError('원 단위 정수 금액을 입력해주세요.');
    await saveManualTransaction(session, {
      rawId: text(f, 'rawId') || undefined,
      memberId: text(f, 'memberId'),
      requestId: text(f, 'requestId'),
      cardId: text(f, 'cardId') || undefined,
      amount: Number(amount),
      approvedAt: text(f, 'approvedAt'),
      merchantName: text(f, 'merchantName'),
      txType: text(f, 'txType'),
      originalTransactionId: text(f, 'originalTransactionId') || undefined,
    });
    refresh();
    return { ok: true, message: '거래를 저장했습니다. 수동 판단은 재처리로 덮어쓰지 않습니다.' };
  } catch (e) {
    return failed(e);
  }
}
export async function mergeAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    if (f.get('confirm') !== 'on') throw new InputError('동일한 거래임을 확인해주세요.');
    await mergeTransactions(session, text(f, 'primaryId'), text(f, 'secondaryId'));
    refresh();
    return { ok: true, message: '원문을 보존하고 하나의 거래로 합쳤습니다.' };
  } catch (e) {
    return failed(e);
  }
}
export async function splitAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    if (f.get('confirm') !== 'on') throw new InputError('별도 거래임을 확인해주세요.');
    await splitEvidence(session, text(f, 'rawId'));
    refresh();
    return { ok: true, message: '거래를 분리했습니다. 금액과 취소 연결을 다시 확인해주세요.' };
  } catch (e) {
    return failed(e);
  }
}
export async function retryRawAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    const count = await queueRawIds(session, [text(f, 'rawId')]);
    refresh();
    return {
      ok: count > 0,
      message: count ? '원문 재분석을 예약했습니다.' : '원문을 찾을 수 없습니다.',
    };
  } catch (e) {
    return failed(e);
  }
}
export async function processNowAction(): Promise<FormResult> {
  const session = await requireSession();
  try {
    const result = await processBatch(session);
    refresh();
    return {
      ok: true,
      message: `처리 작업 ${result.processed}건 완료 · 재시도/실패 ${result.failed}건. 확정 여부는 목록에서 확인하세요.`,
    };
  } catch (e) {
    return failed(e);
  }
}
