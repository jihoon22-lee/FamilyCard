import { kstDayStart, kstLocalDateTime } from '@/lib/time';
import { money } from '@/lib/parser';
import { InputError } from '@/lib/cards';
export interface StatementMapping {
  cardId: string;
  date: number;
  amount: number;
  merchant: number;
  typeColumn?: number;
  fixedType: 'APPROVAL' | 'CANCELLATION' | 'COLUMN';
  amountKind: 'APPROVAL' | 'NET' | 'BILLED';
  encoding: 'utf-8' | 'euc-kr';
  from: string;
  to: string;
}
export interface StatementFields {
  cardId: string;
  amount: number;
  approvedAt: string;
  merchantName: string;
  txType: 'APPROVAL' | 'CANCELLATION';
  timePrecision: 'DAY' | 'SECOND';
  amountKind: StatementMapping['amountKind'];
}
export function validateMapping(m: StatementMapping, columns: number) {
  if (
    !m.cardId ||
    !['APPROVAL', 'CANCELLATION', 'COLUMN'].includes(m.fixedType) ||
    !['APPROVAL', 'NET', 'BILLED'].includes(m.amountKind) ||
    !['utf-8', 'euc-kr'].includes(m.encoding)
  )
    throw new InputError('명세서 매핑을 확인해주세요.');
  for (const index of [
    m.date,
    m.amount,
    m.merchant,
    ...(m.fixedType === 'COLUMN' ? [m.typeColumn] : []),
  ])
    if (!Number.isInteger(index) || index! < 0 || index! >= columns)
      throw new InputError('날짜·금액·가맹점·종류 열을 확인해주세요.');
  try {
    kstDayStart(m.from);
    kstDayStart(m.to);
    if (m.from > m.to) throw new Error();
  } catch {
    throw new InputError('명세서 조회 기간을 확인해주세요.');
  }
  return m;
}
export function parseRow(
  row: string[],
  m: StatementMapping,
): { fields: StatementFields | null; reason: string | null } {
  try {
    let date = row[m.date]!.trim()
      .replace(/^(\d{4})[./](\d{2})[./](\d{2})/, '$1-$2-$3')
      .replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(date);
    date = date.replace(' ', 'T');
    const approvedAt = dayOnly ? kstDayStart(date) : kstLocalDateTime(date);
    const value = m.fixedType === 'COLUMN' ? row[m.typeColumn!]?.trim() : m.fixedType;
    const txType = ['APPROVAL', '승인'].includes(value ?? '')
      ? 'APPROVAL'
      : ['CANCELLATION', '취소', '부분취소'].includes(value ?? '')
        ? 'CANCELLATION'
        : null;
    if (!txType) throw new Error();
    let text = row[m.amount]!.trim().replace(/^₩\s*/, '');
    if (txType === 'CANCELLATION') text = text.replace(/^-/, '');
    if (
      approvedAt < kstDayStart(m.from) ||
      approvedAt >= new Date(kstDayStart(m.to).getTime() + 86400000)
    )
      throw new Error('Outside selected period');
    const amount = money(text),
      merchantName = row[m.merchant]!.trim();
    if (!merchantName || merchantName.length > 300 || approvedAt.getTime() > Date.now() + 86400000)
      throw new Error();
    return {
      fields: {
        cardId: m.cardId,
        amount,
        approvedAt: approvedAt.toISOString(),
        merchantName,
        txType,
        timePrecision: dayOnly ? 'DAY' : 'SECOND',
        amountKind: m.amountKind,
      },
      reason: null,
    };
  } catch {
    return { fields: null, reason: 'STATEMENT_INVALID_ROW' };
  }
}
