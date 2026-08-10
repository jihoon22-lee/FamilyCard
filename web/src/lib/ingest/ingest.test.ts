// ingestMessages 배치 처리 유닛 테스트.
//
// 핵심 불변식: accepted + duplicates + rejected 는 항상 보낸 개수와 같아야
// 한다. 앱이 이 합계로 로컬 큐를 비울지 판단하므로, 어긋나면 앱이 무한
// 재전송에 빠진다 (docs/plan/phase2-contract.md §2).
//
// 개발 DB(localhost:5433)의 시드 데이터를 건드리지 않도록 Prisma 를
// 모킹한다.
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: { rawMessage: { create: (...args: unknown[]) => create(...args) } },
}));

const { ingestMessages } = await import('@/lib/ingest/ingest');

// 기준 시각 고정 — validate.ts 의 미래/과거 판정이 결정적으로 동작하게 한다.
const NOW = new Date('2026-08-10T05:23:07Z');

// 가공된 샘플. 실제 카드 알림 원문을 쓰지 않는다 (AGENTS.md 불변 규칙 7).
function sampleMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'NOTIFICATION',
    packageName: 'com.example.testcard',
    title: '테스트카드 승인',
    body: '홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점',
    receivedAt: '2026-08-10T05:20:00Z',
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
  create.mockReset();
});

describe('ingestMessages — 기본 수집', () => {
  it('정상 메시지 1건 → accepted:1', async () => {
    create.mockResolvedValue({ id: 'raw-1' });

    const summary = await ingestMessages('device-1', [sampleMessage()], NOW);

    expect(summary).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    expect(create).toHaveBeenCalledOnce();
  });

  it('parseStatus 는 항상 PENDING 으로 저장한다 (파싱하지 않는다)', async () => {
    create.mockResolvedValue({ id: 'raw-1' });

    await ingestMessages('device-1', [sampleMessage()], NOW);

    const data = create.mock.calls[0]?.[0]?.data;
    expect(data.parseStatus).toBe('PENDING');
  });

  it('memberId 는 저장 데이터 어디에도 없다 — 소유자는 device 조인으로만 유도된다', async () => {
    create.mockResolvedValue({ id: 'raw-1' });

    await ingestMessages('device-1', [sampleMessage()], NOW);

    const data = create.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty('memberId');
  });

  it('요청에 memberId 필드가 섞여 있어도 무시한다', async () => {
    create.mockResolvedValue({ id: 'raw-1' });

    await ingestMessages('device-1', [sampleMessage({ memberId: '남의-member-id' })], NOW);

    const data = create.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty('memberId');
    expect(data.deviceId).toBe('device-1');
  });
});

describe('ingestMessages — 멱등성(같은 요청 재전송)', () => {
  it('같은 메시지를 다시 보내면 UNIQUE 충돌 → accepted:0, duplicates:1', async () => {
    create.mockRejectedValue(p2002());

    const summary = await ingestMessages('device-1', [sampleMessage()], NOW);

    expect(summary).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
  });

  it('배치 안에 새 메시지와 중복 메시지가 섞여 있으면 각각 옳게 센다', async () => {
    create.mockResolvedValueOnce({ id: 'raw-1' }).mockRejectedValueOnce(p2002());

    const summary = await ingestMessages(
      'device-1',
      [sampleMessage({ body: '새 결제 15,000원' }), sampleMessage({ body: '이미 저장된 결제' })],
      NOW,
    );

    expect(summary).toEqual({ accepted: 1, duplicates: 1, rejected: 0 });
  });
});

// 잘못된 토큰(401) 검증은 route.test.ts 의 몫이다 — 인증은 route.ts
// (resolveDevice)의 책임이고, ingestMessages 는 이미 인증된 deviceId 를
// 받는다는 전제로 동작한다.

describe('ingestMessages — 건별 유효성 검사(rejected)', () => {
  it('미래 시각(5분 초과)은 저장하지 않고 rejected 로 센다', async () => {
    const sixMinutesLater = new Date(NOW.getTime() + 6 * 60 * 1000).toISOString();

    const summary = await ingestMessages(
      'device-1',
      [sampleMessage({ receivedAt: sixMinutesLater })],
      NOW,
    );

    expect(summary).toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
    expect(create).not.toHaveBeenCalled();
  });

  it('4000자 초과 본문은 rejected 로 센다', async () => {
    const summary = await ingestMessages(
      'device-1',
      [sampleMessage({ body: 'a'.repeat(4001) })],
      NOW,
    );

    expect(summary).toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('ingestMessages — 부분 실패는 배치 전체를 죽이지 않는다 ★', () => {
  it('정상 2건 + 잘못된 1건 → accepted:2, rejected:1 (배치 전체 실패 아님)', async () => {
    create.mockResolvedValue({ id: 'raw-ok' });

    const summary = await ingestMessages(
      'device-1',
      [
        sampleMessage({ body: '첫 번째 정상 결제 10,000원' }),
        sampleMessage({ body: '' }), // 빈 본문 — 형식 오류
        sampleMessage({ body: '두 번째 정상 결제 20,000원' }),
      ],
      NOW,
    );

    expect(summary).toEqual({ accepted: 2, duplicates: 0, rejected: 1 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('합계는 언제나 보낸 개수와 같다', async () => {
    create
      .mockResolvedValueOnce({ id: 'raw-1' }) // 정상
      .mockRejectedValueOnce(p2002()); // 중복

    const messages = [
      sampleMessage({ body: '정상 결제' }),
      sampleMessage({ body: '중복 결제' }),
      sampleMessage({ source: 'MANUAL' }), // 형식 오류 — MANUAL 은 허용 안 함
    ];

    const summary = await ingestMessages('device-1', messages, NOW);

    expect(summary.accepted + summary.duplicates + summary.rejected).toBe(messages.length);
  });

  it('앞 건의 UNIQUE 충돌이 뒤 건의 저장을 막지 않는다', async () => {
    create.mockRejectedValueOnce(p2002()).mockResolvedValueOnce({ id: 'raw-2' });

    const summary = await ingestMessages(
      'device-1',
      [sampleMessage({ body: '이미 저장된 결제' }), sampleMessage({ body: '새 결제' })],
      NOW,
    );

    expect(summary).toEqual({ accepted: 1, duplicates: 1, rejected: 0 });
  });
});

describe('ingestMessages — 예상 밖의 저장 오류', () => {
  it('P2002 가 아닌 오류는 삼키지 않고 다시 던진다', async () => {
    create.mockRejectedValue(new Error('DB 연결 끊김'));

    await expect(ingestMessages('device-1', [sampleMessage()], NOW)).rejects.toThrow(
      'DB 연결 끊김',
    );
  });
});
