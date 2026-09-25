'use server';
import { revalidatePath } from 'next/cache';
import { requireFamilyScope } from '@/lib/auth/session';
import { InputError } from '@/lib/cards';
import { saveRule, previewRule, restoreRule, type RuleInput } from '@/lib/parser-rules';
import { kstLocalDateTime } from '@/lib/time';
import type { FormResult } from '@/components/forms/ActionForm';
const text = (f: FormData, key: string) => {
  const v = f.get(key);
  return typeof v === 'string' ? v : '';
};
function input(f: FormData): RuleInput {
  let fieldMap: unknown;
  try {
    fieldMap = JSON.parse(text(f, 'fieldMap'));
  } catch {
    throw new InputError('필드 매핑 JSON 형식을 확인해주세요.');
  }
  let at: Date;
  try {
    at = kstLocalDateTime(text(f, 'sampleReceivedAt'));
  } catch {
    throw new InputError('샘플 수신 시각을 확인해주세요.');
  }
  return {
    id: text(f, 'id') || undefined,
    expectedVersion: Number(text(f, 'version')),
    issuer: text(f, 'issuer'),
    priority: Number(text(f, 'priority')),
    action: text(f, 'action'),
    isActive: f.get('isActive') === 'on',
    matchPattern: text(f, 'matchPattern'),
    extractPattern: text(f, 'extractPattern'),
    fieldMap,
    sampleText: text(f, 'sampleText'),
    sampleReceivedAt: at.toISOString(),
    confirmed: f.get('confirmed') === 'on',
  };
}
export async function ruleAction(_previous: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireFamilyScope();
  try {
    if (text(f, 'intent') === 'preview') {
      const p = await previewRule(session, input(f));
      return {
        ok: p.result.status !== 'FAILED',
        message: `샘플: ${JSON.stringify(p.result)}\n최근 실패/미확정 ${p.checked}건 시험: 해석 ${p.parsed}, 무시 ${p.ignored}, 매치 후 오류 ${p.matchedFailed}. 다른 활성 규칙과의 우선순위 및 카드/중복/취소 연결은 범위 재처리 미리보기에서 확인하세요.`,
      };
    }
    const saved = await saveRule(session, input(f));
    revalidatePath('/family/rules');
    return {
      ok: true,
      message: `규칙 v${saved.version} 저장 (${saved.isActive ? '활성' : '비활성'}). 과거 원문은 범위 재처리에서 반영하세요.`,
    };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('parser_rule_action_failed');
    return { ok: false, message: '저장하지 못했습니다. 새로고침 후 다시 확인해주세요.' };
  }
}
export async function restoreRuleAction(_previous: FormResult, f: FormData): Promise<FormResult> {
  const session = await requireFamilyScope();
  try {
    await restoreRule(
      session,
      text(f, 'id'),
      Number(text(f, 'restoreVersion')),
      Number(text(f, 'version')),
    );
    revalidatePath('/family/rules');
    return {
      ok: true,
      message: '선택한 설정을 새 비활성 버전으로 복원했습니다. 시험 적용 후 활성화하세요.',
    };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('parser_rule_restore_failed');
    return { ok: false, message: '복원하지 못했습니다.' };
  }
}
