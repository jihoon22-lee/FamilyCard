import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocked = vi.hoisted(() => ({
  session: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getAppSession: mocked.session }));
vi.mock('@/lib/reprocessing', () => ({
  createPreview: mocked.preview,
  applyPreview: mocked.apply,
  listRuns: mocked.list,
}));
import { POST, GET } from './route';
const session = { memberId: 'self', name: '', role: 'ADMIN', scope: 'SELF', entrypoint: 'DEVICE' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_URL', 'https://familycard.example');
  mocked.session.mockResolvedValue(session);
  mocked.preview.mockResolvedValue({ id: 'preview' });
  mocked.apply.mockResolvedValue({ id: 'apply' });
  mocked.list.mockResolvedValue([]);
});
const request = (body: unknown, origin = 'https://familycard.example') =>
  new Request('https://familycard.example/api/reparse', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
describe('scoped reparse route', () => {
  it('rejects unauthenticated requests and cross-origin writes', async () => {
    mocked.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request({}))).status).toBe(401);
    mocked.session.mockResolvedValue(session);
    expect((await POST(request({}, 'https://other.example'))).status).toBe(403);
    expect(mocked.preview).not.toHaveBeenCalled();
  });
  it('does not accept a forged member or scope and requires a preview before apply', async () => {
    expect(
      (await POST(request({ scope: 'ALL', memberId: 'victim', status: 'FAILED' }))).status,
    ).toBe(202);
    expect(mocked.preview).toHaveBeenCalledWith(session, {
      issuer: undefined,
      status: 'FAILED',
      from: undefined,
      to: undefined,
    });
    expect((await POST(request({ dryRun: false }))).status).toBe(400);
    expect(mocked.apply).not.toHaveBeenCalled();
    expect(
      (await POST(request({ dryRun: false, previewId: 'p', acknowledgeBreak: true }))).status,
    ).toBe(202);
    expect(mocked.apply).toHaveBeenCalledWith(session, 'p', true);
  });
  it('bounds request bytes before JSON parsing', async () => {
    expect((await POST(request({ padding: 'x'.repeat(5000) }))).status).toBe(413);
    expect(mocked.preview).not.toHaveBeenCalled();
  });
});
