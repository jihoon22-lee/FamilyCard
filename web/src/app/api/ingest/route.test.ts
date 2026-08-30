// POST /api/ingest 통합 테스트.
//
// Prisma 만 모킹하고, 인증 해석(resolveDevice) → 건별 검증 → 저장까지
// 실제 코드 경로를 그대로 태운다. docs/plan/phase2-contract.md §7 의 A 항목
// 전부를 이 파일에서 HTTP 계층 기준으로 검증한다.
//
// 개발 DB(localhost:5433)의 시드 데이터를 건드리지 않도록 Prisma 를
// 모킹한다.
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();
const update = vi.fn();
const create = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    device: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
    rawMessage: {
      create: (...args: unknown[]) => create(...args),
    },
  },
}));

const { POST } = await import('@/app/api/ingest/route');

// 실제 토큰(generateDeviceToken)은 hex 문자열이라 항상 ASCII 다. Authorization
// 헤더 값은 ByteString 이어야 하므로 테스트 토큰도 ASCII 로 둔다.
const DEVICE_TOKEN = 'a'.repeat(64);
const ENDPOINT = 'http://localhost/api/ingest';
let messageSequence = 0;

function nextClientMessageId(): string {
  messageSequence += 1;
  return `00000000-0000-4000-8000-${messageSequence.toString().padStart(12, '0')}`;
}

function buildRequest(
  bodyText: string,
  headerOverrides: Record<string, string | undefined> = {},
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    authorization: `Bearer ${DEVICE_TOKEN}`,
  });
  for (const [key, value] of Object.entries(headerOverrides)) {
    if (value === undefined) headers.delete(key);
    else headers.set(key, value);
  }
  return new Request(ENDPOINT, { method: 'POST', headers, body: bodyText });
}

function jsonRequest(
  body: unknown,
  headerOverrides: Record<string, string | undefined> = {},
): Request {
  return buildRequest(JSON.stringify(body), headerOverrides);
}

// 가공된 샘플. 실제 카드 알림 원문을 쓰지 않는다 (AGENTS.md 불변 규칙 7).
function sampleMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientMessageId: nextClientMessageId(),
    source: 'NOTIFICATION',
    originKind: 'CARD_APP',
    packageName: 'com.example.testcard',
    title: '테스트카드 승인',
    body: '홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점',
    receivedAt: '2026-08-10T05:20:00.000Z',
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on dedupeHash', {
    code: 'P2002',
    clientVersion: '7.9.1',
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  findUnique.mockReset();
  update.mockReset();
  create.mockReset();
  messageSequence = 0;
  findUnique.mockResolvedValue({ id: 'device-1', memberId: 'member-1' });
  update.mockResolvedValue({});
});

describe('POST /api/ingest — 인증', () => {
  it('Authorization 헤더가 없으면 401', async () => {
    const response = await POST(jsonRequest({ messages: [] }, { authorization: undefined }));

    expect(response.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('일치하는 기기가 없는 토큰이면 401', async () => {
    findUnique.mockResolvedValue(null);

    const response = await POST(jsonRequest({ messages: [sampleMessage()] }));

    expect(response.status).toBe(401);
    // 인증에 실패했으니 lastSeenAt 을 갱신할 기기 자체가 없다.
    expect(update).not.toHaveBeenCalled();
  });
});

describe('POST /api/ingest — 기본 수집', () => {
  it('정상 메시지 1건 → 200 {accepted:1, duplicates:0, rejected:0}', async () => {
    create.mockResolvedValue({ id: 'raw-1' });

    const response = await POST(jsonRequest({ messages: [sampleMessage()] }));
    const json = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });
    expect(json).toMatchObject({
      results: [
        {
          clientMessageId: '00000000-0000-4000-8000-000000000001',
          status: 'accepted',
        },
      ],
    });
  });

  it('인증된 요청은 매번 Device.lastSeenAt 을 갱신한다', async () => {
    create.mockResolvedValue({ id: 'raw-1' });

    await POST(jsonRequest({ messages: [sampleMessage()] }));

    expect(update).toHaveBeenCalledWith({
      where: { id: 'device-1' },
      data: { lastSeenAt: expect.any(Date) },
    });
  });
});

describe('POST /api/ingest — 멱등성(같은 요청 재전송) ★', () => {
  it('같은 요청을 다시 보내면 accepted:0, duplicates:1', async () => {
    const message = sampleMessage();

    create.mockResolvedValueOnce({ id: 'raw-1' });
    const first = await POST(jsonRequest({ messages: [message] }));
    expect(await first.json()).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });

    create.mockRejectedValueOnce(p2002());
    const second = await POST(jsonRequest({ messages: [message] }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ accepted: 0, duplicates: 1, rejected: 0 });
  });
});

describe('POST /api/ingest — 건별 유효성 검사', () => {
  it('미래 시각(5분 초과)은 rejected:1', async () => {
    const sixMinutesLater = new Date(Date.now() + 6 * 60 * 1000).toISOString();

    const response = await POST(
      jsonRequest({ messages: [sampleMessage({ receivedAt: sixMinutesLater })] }),
    );
    const json = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ accepted: 0, duplicates: 0, rejected: 1 });
    expect(json).toMatchObject({
      results: [{ status: 'rejected', reason: 'received_at_in_future' }],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('4000자를 초과하는 본문은 rejected:1', async () => {
    const response = await POST(
      jsonRequest({ messages: [sampleMessage({ body: 'a'.repeat(4001) })] }),
    );
    const json = (await response.json()) as unknown;

    expect(json).toMatchObject({ accepted: 0, duplicates: 0, rejected: 1 });
  });
});

describe('POST /api/ingest — 요청 형식 오류(400)', () => {
  it('JSON 파싱 불가 → 400', async () => {
    const response = await POST(buildRequest('{ 이건 JSON 이 아님'));

    expect(response.status).toBe(400);
  });

  it('messages 가 배열이 아니면 → 400', async () => {
    const response = await POST(jsonRequest({ messages: '배열아님' }));

    expect(response.status).toBe(400);
  });

  it('messages 필드 자체가 없으면 → 400', async () => {
    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
  });

  it('clientMessageId가 없거나 배치 안에서 중복이면 요청 전체를 400으로 거부한다', async () => {
    const withoutId = sampleMessage({ clientMessageId: undefined });
    expect((await POST(jsonRequest({ messages: [withoutId] }))).status).toBe(400);

    const duplicateId = '11111111-1111-4111-8111-111111111111';
    const duplicateResponse = await POST(
      jsonRequest({
        messages: [
          sampleMessage({ clientMessageId: duplicateId }),
          sampleMessage({ clientMessageId: duplicateId }),
        ],
      }),
    );
    expect(duplicateResponse.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('POST /api/ingest — 배치 크기 상한(413)', () => {
  it('요청 전체 바이트 상한을 넘으면 JSON 파싱 전에 413으로 거부한다', async () => {
    vi.stubEnv('INGEST_MAX_REQUEST_BYTES', '100');

    const response = await POST(jsonRequest({ messages: [sampleMessage()] }));

    expect(response.status).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });

  it('201건을 보내면 요청 전체를 413 으로 거부한다', async () => {
    const messages = Array.from({ length: 201 }, () => sampleMessage());

    const response = await POST(jsonRequest({ messages }));

    expect(response.status).toBe(413);
    // 요청 전체 거부이므로 단 한 건도 저장을 시도하면 안 된다.
    expect(create).not.toHaveBeenCalled();
  });

  it('정확히 200건은 통과한다 (경계값)', async () => {
    create.mockResolvedValue({ id: 'raw' });
    const messages = Array.from({ length: 200 }, (_, i) => sampleMessage({ body: `결제 ${i}건` }));

    const response = await POST(jsonRequest({ messages }));

    expect(response.status).toBe(200);
  });
});

describe('POST /api/ingest — 부분 실패는 배치 전체를 죽이지 않는다 ★', () => {
  it('정상 2건 + 잘못된 1건 → {accepted:2, rejected:1} (전체 실패 아님)', async () => {
    create.mockResolvedValue({ id: 'raw' });

    const response = await POST(
      jsonRequest({
        messages: [
          sampleMessage({ body: '첫 번째 정상 결제 10,000원' }),
          sampleMessage({ source: 'MANUAL' }), // 형식 오류 — 이 엔드포인트는 NOTIFICATION/SMS 만 허용
          sampleMessage({ body: '두 번째 정상 결제 20,000원' }),
        ],
      }),
    );
    const json = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ accepted: 2, duplicates: 0, rejected: 1 });
  });
});

describe('POST /api/ingest — 로그에 본문을 남기지 않는다', () => {
  it('처리 로그에 알림 본문·제목이 포함되지 않는다', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    create.mockResolvedValue({ id: 'raw-1' });

    const secretBody = '홍길동님 999,999원 일시불 08/10 14:23 절대로그에남으면안됨가맹점';
    await POST(jsonRequest({ messages: [sampleMessage({ body: secretBody, title: '비밀제목' })] }));

    const loggedText = infoSpy.mock.calls.map((call) => JSON.stringify(call)).join('\n');
    expect(loggedText).not.toContain(secretBody);
    expect(loggedText).not.toContain('비밀제목');

    infoSpy.mockRestore();
  });
});
