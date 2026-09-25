import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { excelReport, pdfReport } from './index';
const rows = [
  {
    id: 'fake',
    memberId: 'self',
    member: { name: '가공 구성원' },
    card: { nickname: '가공 카드', last4: '1234' },
    approvedAt: new Date('2026-07-31T15:30:00Z'),
    merchantName: '=HYPERLINK("https://example.com")',
    amount: 12000,
    canceledAmount: 2000,
    txType: 'APPROVAL' as const,
    state: 'CONFIRMED' as const,
    isOrphanCancellation: false,
    category: { name: '식비' },
  },
];
describe('local report generation', () => {
  it('writes literal strings, KST dates and net amounts to XLSX', async () => {
    const bytes = await excelReport('2026-08', rows);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet('월간 요약')!.getCell('B2').value).toBe(10000);
    const sheet = workbook.getWorksheet('거래 내역')!;
    expect(sheet.getCell('F2').value).toBe(rows[0]!.merchantName);
    expect(sheet.getCell('F2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('D2').value).toBe('2026-08-01 00:30');
    expect(sheet.getCell('I2').value).toBe(10000);
  });
  it('embeds the Korean font in a valid PDF', async () => {
    const bytes = await pdfReport('2026-08', rows);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(10000);
    expect(bytes.toString('latin1')).toContain('/FontFile3');
  });
});
