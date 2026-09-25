'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { saveBenefitRule, saveEstimateSnapshot } from '@/lib/benefit';
import { InputError } from '@/lib/cards';
import type { FormResult } from '@/components/forms/ActionForm';
const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};
export async function benefitAction(_p: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireSession();
  try {
    if (text(f, 'intent') === 'snapshot') {
      await saveEstimateSnapshot(session, text(f, 'cardId'), text(f, 'month'));
      return { ok: true, message: '추정치와 거래별 산정 사유를 기록했습니다.' };
    }
    if (f.get('confirmed') !== 'on') throw new InputError('공식 약관 조건을 확인해주세요.');
    const thresholds = f.getAll('threshold'),
      descs = f.getAll('benefitDesc'),
      caps = f.getAll('monthlyCap');
    if (thresholds.length !== descs.length || thresholds.length !== caps.length)
      throw new InputError('구간 입력을 확인해주세요.');
    await saveBenefitRule(session, {
      cardId: text(f, 'cardId'),
      expectedVersion: Number(text(f, 'version')),
      effectiveFrom: text(f, 'effectiveFrom'),
      effectiveTo: text(f, 'effectiveTo') || undefined,
      sourceUrl: text(f, 'sourceUrl'),
      config: {
        periodType: text(f, 'periodType'),
        cancellationPolicy: text(f, 'cancellationPolicy'),
        minPerTxAmount: Number(text(f, 'minPerTxAmount')),
        exclusions: f.getAll('exclusions'),
        tiers: thresholds.map((n, i) => ({
          threshold: Number(n),
          benefitDesc: String(descs[i]),
          monthlyCap: Number(caps[i]),
        })),
      },
    });
    revalidatePath('/benefits');
    return { ok: true, message: '새 실적 규칙 버전을 저장했습니다. 계산값은 추정치입니다.' };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('benefit_action_failed');
    return { ok: false, message: '저장하지 못했습니다. 입력과 변경 상태를 다시 확인해주세요.' };
  }
}
