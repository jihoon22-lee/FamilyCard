// 디바이스 세션 토큰 인코딩 테스트.
//
// ★★ docs/plan/phase2-contract.md §7(B): "ADMIN 의 디바이스 토큰으로 세션
// 발급 → scope: 'SELF'". 이 프로젝트의 불변 규칙 3을 지키는 테스트다.
//
// buildDeviceSessionToken() 의 파라미터 타입(DeviceSessionMember)에는애초에
// role 필드가 없다 — 그래서 "ADMIN 구성원을 넘겨도 SELF 가 나오는지"를
// 굳이 role='ADMIN' 을 넘겨서 확인할 수조차 없다(타입에 없는 필드라
// 컴파일이 안 된다). 이 테스트는 그 사실 자체 — 이 함수가 role 을 받을
// 자리가 없다는 것 — 을 doc으로 남기고, 반환값의 scope 가 항상 'SELF'
// 이고 role 이 항상 'MEMBER'(최소 권한)로 고정되는지를 검증한다.
import { describe, expect, it, vi } from 'vitest';

const encode = vi.fn<(params: { token: { scope: string; role: string } }) => Promise<string>>();
encode.mockResolvedValue('encoded-jwt-value');

vi.mock('next-auth/jwt', () => ({
  encode: (...args: unknown[]) => encode(...(args as Parameters<typeof encode>)),
}));

const { buildDeviceSessionToken, encodeDeviceSessionCookie } = await import('./session-token');

describe('buildDeviceSessionToken — 불변 규칙 3 ★★', () => {
  it('scope 는 항상 SELF', () => {
    // 이 멤버가 실제로는 가족 ADMIN 이라 해도(예: 시드의 김도현), 이 함수는
    // role 을 받지 않으므로 그 사실을 알 방법이 없다 — 그래서 결과가 항상
    // SELF 다.
    const token = buildDeviceSessionToken({
      deviceId: 'device-admin',
      memberId: 'admin-member-id',
      memberName: '김도현',
    });

    expect(token.scope).toBe('SELF');
  });

  it('role 은 항상 MEMBER(최소 권한)로 고정된다', () => {
    const token = buildDeviceSessionToken({
      deviceId: 'device-admin',
      memberId: 'admin-member-id',
      memberName: '김도현',
    });

    expect(token.role).toBe('MEMBER');
  });

  it('memberId·memberName 은 입력을 그대로 담는다', () => {
    const token = buildDeviceSessionToken({
      deviceId: 'device-1',
      memberId: 'm-1',
      memberName: '김하은',
    });

    expect(token.memberId).toBe('m-1');
    expect(token.memberName).toBe('김하은');
    expect(token.deviceId).toBe('device-1');
    expect(token.entrypoint).toBe('DEVICE');
  });
});

describe('encodeDeviceSessionCookie', () => {
  it('ADMIN 소유 기기라도 인코딩되는 토큰의 scope 는 SELF', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-32-bytes-minimum-xxxxx');

    await encodeDeviceSessionCookie({
      deviceId: 'device-admin',
      memberId: 'admin-member-id',
      memberName: '김도현',
    });

    const call = encode.mock.calls[0]?.[0] as { token: { scope: string; role: string } };
    expect(call.token.scope).toBe('SELF');
    expect(call.token.role).toBe('MEMBER');

    vi.unstubAllEnvs();
  });

  it('AUTH_SECRET 이 없으면 에러를 던진다(조용히 무자격 세션을 만들지 않는다)', async () => {
    vi.stubEnv('AUTH_SECRET', '');

    await expect(
      encodeDeviceSessionCookie({ deviceId: 'device-1', memberId: 'm-1', memberName: '김하은' }),
    ).rejects.toThrow('AUTH_SECRET');

    vi.unstubAllEnvs();
  });

  it('쿠키 이름·옵션은 authConfig 의 세션 쿠키 설정을 그대로 따른다', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-32-bytes-minimum-xxxxx');

    const cookie = await encodeDeviceSessionCookie({
      deviceId: 'device-1',
      memberId: 'm-1',
      memberName: '김하은',
    });

    expect(cookie.name).toBe('authjs.session-token'); // NODE_ENV!=production 이므로 __Secure- 접두사 없음
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe('strict');
    expect(cookie.value).toBe('encoded-jwt-value');

    vi.unstubAllEnvs();
  });
});
