import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { reportRows } from '@/lib/analytics';
import { excelReport, pdfReport } from '@/lib/reports';
import { InputError } from '@/lib/cards';
import { monthRange } from '@/lib/time';
export const runtime = 'nodejs';
const state = globalThis as unknown as { familycardReportBusy?: boolean };
export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams,
    month = params.get('month') ?? '',
    format = params.get('format');
  try {
    monthRange(month);
  } catch {
    return NextResponse.json({ error: 'invalid_month' }, { status: 400 });
  }
  if (format !== 'xlsx' && format !== 'pdf')
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  if (state.familycardReportBusy)
    return NextResponse.json(
      { error: '보고서를 생성 중입니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'Retry-After': '5' } },
    );
  state.familycardReportBusy = true;
  try {
    const rows = await reportRows(session, {
      month,
      memberId: params.get('memberId') || undefined,
    });
    const bytes = format === 'xlsx' ? await excelReport(month, rows) : await pdfReport(month, rows);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type':
          format === 'xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/pdf',
        'Content-Disposition': `attachment; filename="familycard-${month}.${format}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('report_export_failed');
    return NextResponse.json({ error: '보고서를 생성하지 못했습니다.' }, { status: 500 });
  } finally {
    state.familycardReportBusy = false;
  }
}
