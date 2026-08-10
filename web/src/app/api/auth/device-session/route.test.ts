// POST/GET /api/auth/device-session 통합 테스트.
//
// docs/plan/phase2-contract.md §7(B) 전부를 이 파일에서 HTTP 계층 기준으로
// 검증한다. nonce 발급·소모(nonce.ts)와 JWT 인코딩(session-token.ts)은 각자
// 파일에서 이미 유닛 테스트로 검증했으므로 여기서는 목(mock)으로 대체하고,
// 이 라우트가 그것들을 올바른 상태 코드로 잇는지에 집중한다.
//
// 개발 DB(localhost:5433)의 시드 데이터를 건드리지 않도록 Prisma 를 모킹한다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveDevice = vi.fn();
const findUnique = vi.fn();
const issueDeviceSessionNonce = vi.fn();
const consumeDeviceSessionNonce = vi.fn();
const encodeDeviceSessionCookie = vi.fn();

vi.mock('@/lib/auth/device', () => ({
  resolveDevice: (...args: unknown[]) => resolveDevice(...args),
}));

vi.mock('@/lib/db', () => ({
  prisma: { familyMember: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

vi.mock('./nonce', () => ({
  issueDeviceSessionNonce: (...args: unknown[]) => issueDeviceSessionNonce(...args),
  consumeDeviceSessionNonce: (...args: unknown[]) => consumeDeviceSessionNonce(...args),
}));

vi.mock('./session-token', () => ({
  encodeDeviceSessionCookie: (...args: unknown[]) => encodeDeviceSessionCookie(...args),
}));

const { POST, GET } = await import('./route');

const DEVICE_TOKEN = 'test-device-token-aaaaaaaaaaaaaaaa';

beforeEach(() => {
  resolveDevice.mockReset();
  findUnique.mockReset();
  issueDeviceSessionNonce.mockReset();
  consumeDeviceSessionNonce.mockReset();
  encodeDeviceSessionCookie.mockReset();
  vi.stubEnv('APP_URL', 'http://localhost:3000');
});

function postRequest(headerOverrides: Record<string, string | undefined> = {}): Request {
  const headers = new Headers({ authorization: `Bearer ${DEVICE_TOKEN}` });
  for (const [key, value] of Object.entries(headerOverrides)) {
    if (value === undefined) headers.delete(key);
    else headers.set(key, value);
  }
  return new Request('http://localhost/api/auth/device-session', { method: 'POST', headers });
}

function getRequest(query: string): Request {
  return new Request(`http://localhost/api/auth/device-session${query}`, { method: 'GET' });
}

describe('POST /api/auth/device-session — 인증', () => {
  it('Authorization 헤더가 없으면 401', async () => {
    const response = await POST(postRequest({ authorization: undefined }));

    expect(response.status).toBe(401);
    expect(issueDeviceSessionNonce).not.toHaveBeenCalled();
  });

  it('폐기된(또는 무효한) 디바이스 토큰 → 401 ★', async () => {
    // 폐기는 web/src/app/(family)/family/devices/actions.ts 가 tokenHash 를
    // sentinel 값으로 덮어써서 구현한다 — 그러면 resolveDevice() 의
    // findUnique 가 더 이상 매치되지 않아 항상 null 을 돌려준다. 이 라우트
    // 입장에서는 "무효한 토큰"과 동일하게 관찰된다.
    resolveDevice.mockResolvedValue(null);

    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    expect(issueDeviceSessionNonce).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/device-session — 정상 발급', () => {
  it('유효한 토큰이면 nonce 를 실은 url 을 200 으로 돌려준다', async () => {
    resolveDevice.mockResolvedValue({ deviceId: 'device-1', memberId: 'member-1' });
    issueDeviceSessionNonce.mockResolvedValue({ nonce: 'abc123nonce', expiresAt: new Date() });

    const response = await POST(postRequest());
    const json = (await response.json()) as { url: string };

    expect(response.status).toBe(200);
    expect(json.url).toBe('http://localhost:3000/api/auth/device-session?t=abc123nonce');
    expect(issueDeviceSessionNonce).toHaveBeenCalledWith('member-1');
  });
});

describe('GET /api/auth/device-session — nonce 소모', () => {
  it('t 파라미터가 없으면 401', async () => {
    const response = await GET(getRequest(''));

    expect(response.status).toBe(401);
    expect(consumeDeviceSessionNonce).not.toHaveBeenCalled();
  });

  it('만료·재사용 등으로 무효한 nonce → 401', async () => {
    consumeDeviceSessionNonce.mockResolvedValue(null);

    const response = await GET(getRequest('?t=무효한논스'));

    expect(response.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('유효한 nonce 를 소모하면 세션 쿠키를 심고 / 로 리다이렉트한다', async () => {
    consumeDeviceSessionNonce.mockResolvedValue({ memberId: 'admin-member-id' });
    findUnique.mockResolvedValue({ name: '김도현' });
    encodeDeviceSessionCookie.mockResolvedValue({
      name: 'authjs.session-token',
      value: 'jwt-value',
      options: { httpOnly: true, sameSite: 'strict', path: '/', secure: false, maxAge: 2_592_000 },
    });

    const response = await GET(getRequest('?t=유효한논스'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost/');
    expect(response.headers.get('set-cookie')).toContain('authjs.session-token=jwt-value');
  });

  it('구성원 조회는 name 만 select 한다 — role 은 조회조차 하지 않는다 ★★', async () => {
    consumeDeviceSessionNonce.mockResolvedValue({ memberId: 'admin-member-id' });
    findUnique.mockResolvedValue({ name: '김도현' });
    encodeDeviceSessionCookie.mockResolvedValue({
      name: 'authjs.session-token',
      value: 'jwt-value',
      options: { httpOnly: true, sameSite: 'strict', path: '/', secure: false, maxAge: 2_592_000 },
    });

    await GET(getRequest('?t=유효한논스'));

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-member-id' },
      select: { name: true },
    });
    // select 에 role 이 없으니 Prisma 가 role 컬럼을 아예 실어오지 않는다.
    const call = findUnique.mock.calls[0]?.[0] as { select: Record<string, unknown> };
    expect(call.select).not.toHaveProperty('role');
  });

  it('nonce 소모 이후 구성원을 찾을 수 없으면(극단적인 경우) 401', async () => {
    consumeDeviceSessionNonce.mockResolvedValue({ memberId: 'ghost-member' });
    findUnique.mockResolvedValue(null);

    const response = await GET(getRequest('?t=유효한논스'));

    expect(response.status).toBe(401);
    expect(encodeDeviceSessionCookie).not.toHaveBeenCalled();
  });
});
