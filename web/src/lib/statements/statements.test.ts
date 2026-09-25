import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readStatementFile } from './file';
import { parseRow, type StatementMapping } from './parse';
const mapping: StatementMapping = {
  cardId: 'synthetic',
  date: 0,
  amount: 1,
  merchant: 2,
  fixedType: 'APPROVAL',
  amountKind: 'APPROVAL',
  encoding: 'utf-8',
  from: '2026-08-01',
  to: '2026-08-31',
};
describe('statement formats and bounded input', () => {
  it('reads quoted CSV without executing formulas and validates KST dates/amount meaning', async () => {
    const file = await readStatementFile(
      'test.csv',
      Buffer.from('날짜,금액,가맹점\n2026-08-10,"12,000",가공가맹점\n'),
    );
    const parsed = parseRow(file.rows[0]!, mapping);
    expect(parsed.fields?.amount).toBe(12000);
    expect(parsed.fields?.approvedAt).toBe('2026-08-09T15:00:00.000Z');
    expect(parseRow(['2026-02-30', '100', '가공'], mapping).fields).toBeNull();
    expect(parseRow(['2026-09-01', '100', '가공'], mapping).fields).toBeNull();
    expect(parseRow(['2026-08-10', '-100', '가공'], mapping).fields).toBeNull();
    expect(
      parseRow(['2026-08-10', '-100', '가공'], { ...mapping, fixedType: 'CANCELLATION' }).fields
        ?.amount,
    ).toBe(100);
  });
  it('reads XLSX values but rejects formula cells and sparse huge rows', async () => {
    const b = new ExcelJS.Workbook(),
      s = b.addWorksheet('가공');
    s.addRows([
      ['날짜', '금액', '가맹점'],
      [new Date('2026-08-10T00:00:00Z'), 12000, '가공'],
    ]);
    const file = await readStatementFile('test.xlsx', Buffer.from(await b.xlsx.writeBuffer()));
    expect(file.rows[0]?.[1]).toBe('12000');
    s.getCell('B2').value = { formula: '1+1', result: 2 };
    await expect(
      readStatementFile('test.xlsx', Buffer.from(await b.xlsx.writeBuffer())),
    ).rejects.toThrow('수식');
    s.getCell('B2').value = 12000;
    s.getCell('A5000').value = 'sparse';
    await expect(
      readStatementFile('test.xlsx', Buffer.from(await b.xlsx.writeBuffer())),
    ).rejects.toThrow();
  });
  it('rejects compressed oversized XML and excessive CSV rows', async () => {
    const b = new ExcelJS.Workbook(),
      s = b.addWorksheet('fake');
    s.addRows([['header'], ['x'.repeat(2 * 1024 * 1024 + 100)]]);
    await expect(
      readStatementFile('test.xlsx', Buffer.from(await b.xlsx.writeBuffer())),
    ).rejects.toThrow();
    await expect(
      readStatementFile('test.csv', Buffer.from('a\n' + 'x\n'.repeat(1001))),
    ).rejects.toThrow();
  });
});
