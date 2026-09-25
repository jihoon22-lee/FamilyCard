import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), visible: vi.fn(), find: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getAppSession: m.session }));
vi.mock('@/lib/auth/scope', () => ({ visibleMemberIds: m.visible }));
vi.mock('@/lib/db', () => ({ prisma: { statementImport: { findFirst: m.find } } }));
import { GET } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({
    memberId: 'self',
    scope: 'SELF',
    entrypoint: 'DEVICE',
    role: 'ADMIN',
  });
  m.visible.mockResolvedValue(['self']);
});
describe('original statement download', () => {
  it('requires session and scopes guessed file IDs', async () => {
    m.session.mockResolvedValue(null);
    expect(
      (
        await GET(new Request('https://example.com'), {
          params: Promise.resolve({ id: 'foreign' }),
        })
      ).status,
    ).toBe(401);
    m.session.mockResolvedValue({ memberId: 'self' });
    m.find.mockResolvedValue(null);
    expect(
      (
        await GET(new Request('https://example.com'), {
          params: Promise.resolve({ id: 'foreign' }),
        })
      ).status,
    ).toBe(404);
    expect(m.find.mock.calls[0]![0].where).toEqual({ id: 'foreign', memberId: { in: ['self'] } });
  });
  it('serves exact bytes with private caching and attachment headers', async () => {
    m.find.mockResolvedValue({ fileName: '가공.csv', originalFile: new Uint8Array([1, 2, 3]) });
    const r = await GET(new Request('https://example.com'), {
      params: Promise.resolve({ id: 'own' }),
    });
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('content-disposition')).toContain('attachment;');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3]);
  });
});
