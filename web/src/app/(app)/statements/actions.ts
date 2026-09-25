'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import {
  readStatementFile,
  importStatement,
  decideStatement,
  type StatementMapping,
} from '@/lib/statements';
import { InputError } from '@/lib/cards';
import type { FormResult } from '@/components/forms/ActionForm';
const state = globalThis as unknown as { familycardStatementBusy?: boolean };
const text = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
export interface UploadResult {
  ok: boolean;
  message: string;
  preview?: { headers: string[]; rows: string[][]; count: number };
  id?: string;
}
export async function uploadStatement(f: FormData): Promise<UploadResult> {
  const session = await requireSession();
  if (state.familycardStatementBusy)
    return { ok: false, message: '명세서를 처리 중입니다. 잠시 후 다시 시도해주세요.' };
  state.familycardStatementBusy = true;
  try {
    const file = f.get('file');
    if (!(file instanceof File) || file.size > 2 * 1024 * 1024)
      throw new InputError('2MiB 이하 CSV/XLSX 파일을 선택해주세요.');
    const bytes = Buffer.from(await file.arrayBuffer());
    const encoding = text(f, 'encoding') || 'utf-8';
    if (text(f, 'intent') === 'preview') {
      const p = await readStatementFile(file.name, bytes, encoding);
      return {
        ok: true,
        message: '열과 기간을 지정한 뒤 원본을 보관하세요.',
        preview: { headers: p.headers, rows: p.rows.slice(0, 5), count: p.rows.length },
      };
    }
    if (f.get('confirmed') !== 'on')
      throw new InputError('한 카드의 원화 내역과 매핑을 확인해주세요.');
    const mapping: StatementMapping = {
      cardId: text(f, 'cardId'),
      date: Number(text(f, 'date')),
      amount: Number(text(f, 'amount')),
      merchant: Number(text(f, 'merchant')),
      fixedType: text(f, 'fixedType') as StatementMapping['fixedType'],
      typeColumn: Number(text(f, 'typeColumn')),
      amountKind: text(f, 'amountKind') as StatementMapping['amountKind'],
      encoding: encoding as StatementMapping['encoding'],
      from: text(f, 'from'),
      to: text(f, 'to'),
    };
    const result = await importStatement(
      session,
      file.name,
      bytes,
      mapping,
      f.get('remap') === 'on',
    );
    revalidatePath('/statements');
    revalidatePath('/review');
    return {
      ok: true,
      id: result.id,
      message: result.duplicate
        ? '이미 보관된 파일입니다. 원문을 중복 저장하지 않았습니다.'
        : `${result.rows}행을 보관했습니다. 거래 반영 전 대사 결과를 확인하세요.`,
    };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('statement_upload_failed');
    return { ok: false, message: '명세서를 보관하지 못했습니다. 파일과 입력을 확인해주세요.' };
  } finally {
    state.familycardStatementBusy = false;
  }
}
export async function statementDecisionAction(
  _previous: FormResult,
  f: FormData,
): Promise<FormResult> {
  const session = await requireSession();
  try {
    if (f.get('confirmed') !== 'on') throw new InputError('선택한 행의 반영 내용을 확인해주세요.');
    const ids = f.getAll('rawId');
    if (ids.some((id) => typeof id !== 'string')) throw new InputError('행 선택을 확인해주세요.');
    await decideStatement(session, {
      rawIds: ids as string[],
      action: text(f, 'decision') as 'CREATE' | 'LINK' | 'CORRECT' | 'IGNORE',
      targetId: text(f, 'targetId') || undefined,
    });
    for (const path of [
      '/statements',
      '/review',
      '/transactions',
      '/analytics',
      '/family',
      '/benefits',
      '/',
    ])
      revalidatePath(path);
    return { ok: true, message: '선택한 판단을 기록했습니다. 원문과 파일은 보존됩니다.' };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message };
    console.error('statement_decision_failed');
    return { ok: false, message: '반영하지 못했습니다. 다시 확인해주세요.' };
  }
}
