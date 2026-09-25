import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { reportRows } from '@/lib/analytics';
import { netAmount } from '@/lib/reconciliation';
import { dateTimeInput } from '@/lib/time';
import { InputError } from '@/lib/cards';
type Rows = Awaited<ReturnType<typeof reportRows>>;
const total = (rows: Rows) =>
  rows
    .filter((t) => t.txType === 'APPROVAL' && t.state === 'CONFIRMED')
    .reduce((sum, t) => sum + (netAmount(t) ?? 0), 0);
export async function excelReport(month: string, rows: Rows) {
  if (rows.length > 10000) throw new InputError('엑셀 보고서 건수 한도 초과');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FamilyCard';
  const summary = workbook.addWorksheet('월간 요약');
  summary.addRows([
    ['FamilyCard 월간 보고서', month],
    ['확정 승인 순사용액', total(rows)],
    ['거래 건수', rows.length],
    ['기준', '취소 반영 순사용액. 청구액/공식 실적과 다를 수 있습니다.'],
  ]);
  summary.getColumn(1).width = 28;
  summary.getColumn(2).width = 65;
  const sheet = workbook.addWorksheet('거래 내역', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '구성원', key: 'member', width: 16 },
    { header: '카드', key: 'card', width: 25 },
    { header: '카드 끝번호', key: 'last4', width: 15 },
    { header: '시각 (한국)', key: 'date', width: 24 },
    { header: '종류', key: 'type', width: 12 },
    { header: '가맹점', key: 'merchant', width: 36 },
    { header: '승인/취소 금액', key: 'amount', width: 18 },
    { header: '연결 취소액', key: 'canceled', width: 18 },
    { header: '승인 순사용액', key: 'net', width: 18 },
    { header: '분류', key: 'category', width: 18 },
    { header: '상태', key: 'state', width: 18 },
  ];
  for (const t of rows)
    sheet.addRow({
      member: t.member.name,
      card: t.card?.nickname ?? '미지정',
      last4: t.card?.last4 ?? '',
      date: dateTimeInput(t.approvedAt).replace('T', ' '),
      type: t.txType === 'APPROVAL' ? '승인' : '취소',
      merchant: t.merchantName,
      amount: t.amount,
      canceled: t.txType === 'APPROVAL' ? t.canceledAmount : null,
      net: t.txType === 'APPROVAL' ? netAmount(t) : null,
      category: t.category?.name ?? '미분류',
      state: t.isOrphanCancellation ? '원거래 미확인' : t.state === 'REVIEW' ? '확인 필요' : '확정',
    });
  // All user strings remain literal text cells, never formula objects or CSV expressions.
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: 'K1' };
  for (const col of ['amount', 'canceled', 'net']) sheet.getColumn(col).numFmt = '#,##0';
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
export async function pdfReport(month: string, rows: Rows): Promise<Buffer> {
  if (rows.length > 2000)
    throw new InputError(
      'PDF는 월 2,000건까지 지원합니다. 구성원별로 나누거나 엑셀을 사용해주세요.',
    );
  const doc = new PDFDocument({
    size: 'A4',
    margin: 42,
    autoFirstPage: false,
    info: { Title: `FamilyCard ${month} 월간 보고서`, Author: 'FamilyCard' },
  });
  const chunks: Buffer[] = [];
  let size = 0;
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        doc.destroy(new Error('Report size exceeded'));
        return;
      }
      chunks.push(chunk);
    });
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Korean', join(process.cwd(), 'public/fonts/NotoSansKR-Regular.otf'));
  doc.addPage();
  doc.font('Korean').fontSize(19).text(`FamilyCard · ${month}`);
  doc
    .moveDown(0.5)
    .fontSize(11)
    .text(`확정 승인 순사용액 ${total(rows).toLocaleString('ko-KR')}원`);
  doc.fontSize(9).text('취소 반영 순사용액입니다. 청구액·카드사 공식 실적과 다를 수 있습니다.');
  doc.moveDown();
  for (const t of rows) {
    const text = `${dateTimeInput(t.approvedAt).replace('T', ' ')}  ${t.member.name} · ${t.card?.nickname ?? '미지정'} (${t.card?.last4 ?? ''})\n${t.txType === 'APPROVAL' ? '승인' : '취소'} · ${t.merchantName} · ${t.amount === null ? '원화 미확정' : t.amount.toLocaleString('ko-KR') + '원'}${t.txType === 'APPROVAL' && t.amount !== null ? ' · 순사용 ' + netAmount(t)!.toLocaleString('ko-KR') + '원' : ''}\n${t.category?.name ?? '미분류'} · ${t.state === 'REVIEW' ? '확인 필요' : '확정'}${t.isOrphanCancellation ? ' · 원거래 미확인' : ''}`;
    if (doc.y + doc.heightOfString(text, { width: 510 }) > 760) doc.addPage();
    doc.fontSize(9).text(text, { width: 510 }).moveDown(0.7);
  }
  doc.end();
  return result;
}
