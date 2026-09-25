import { beforeEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), rows: vi.fn(), excel: vi.fn(), pdf: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getAppSession: m.session }));
vi.mock('@/lib/analytics', () => ({ reportRows: m.rows }));
vi.mock('@/lib/reports', () => ({ excelReport: m.excel, pdfReport: m.pdf }));
import { GET } from './route';
import { InputError } from '@/lib/cards';
const session = { memberId: 'self', role: 'ADMIN', scope: 'SELF', entrypoint: 'DEVICE', name: '' };
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue(session);
  m.rows.mockResolvedValue([]);
  m.excel.mockResolvedValue(Buffer.from('fake'));
});
describe('report route', () => {
  it('requires authentication and keeps exports private', async () => {
    m.session.mockResolvedValue(null);
    expect(
      (await GET(new Request('https://example.com/api/reports?month=2026-08&format=xlsx'))).status,
    ).toBe(401);
    m.session.mockResolvedValue(session);
    const res = await GET(new Request('https://example.com/api/reports?month=2026-08&format=xlsx'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(m.rows).toHaveBeenCalledWith(session, { month: '2026-08', memberId: undefined });
  });
  it('does not generate a report when scope validation fails', async () => {
    m.rows.mockRejectedValue(new InputError('denied'));
    expect(
      (
        await GET(
          new Request('https://example.com/api/reports?month=2026-08&format=xlsx&memberId=other'),
        )
      ).status,
    ).toBe(400);
    expect(m.excel).not.toHaveBeenCalled();
  });
});
