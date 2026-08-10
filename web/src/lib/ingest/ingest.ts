// POST /api/ingest 의 핵심 처리 로직 — HTTP 계층(route.ts)과 분리해 Request/
// Response 객체 없이 곧장 이 함수를 유닛 테스트할 수 있게 한다.
//
// 파싱은 하지 않는다. 전부 parseStatus: PENDING 으로 저장만 한다
// (docs/plan/phase2-contract.md §0 — 실제 알림 원문을 보기 전에 정규식을
// 짜면 Phase 3 에서 전부 다시 써야 한다).
//
// ── 부분 실패가 배치 전체를 죽이면 안 된다 ────────────────────────────
// accepted + duplicates + rejected 는 보낸 개수와 반드시 같아야 한다. 앱이
// 이 합계로 로컬 큐를 비울지 판단하므로, 어긋나면 앱이 무한 재전송에 빠진다
// (docs/design/02-ingest.md, AGENTS.md 세션 종료 절차가 아니라 이 파이프라인
// 자체의 핵심 불변식이다). 그래서 Promise.all 로 한꺼번에 던지지 않고
// **건별로 순차** 처리한다 — 앞 건의 실패가 뒤 건의 검사·삽입에 영향을 주면
// 안 된다.
//
// UNIQUE 충돌(P2002)과 사전 검증 실패("형식 오류")만 이 함수 안에서
// 흡수한다. 그 외의 예상 밖의 저장 오류(DB 연결 끊김 등)는 여기서 삼키지
// 않고 그대로 던진다 — dedupeHash 덕분에 배치 재전송이 멱등하므로, 원인
// 불명의 오류는 "이 항목을 영구히 거부"가 아니라 "요청 전체를 다시
// 시도해달라"(route.ts 가 500 으로 응답)로 처리하는 편이 유실 방지라는
// 이 시스템의 제1 목표에 더 맞는다. 형식이 명백히 잘못된 건만 앱이
// 포기해도 되는 rejected 로 분류한다.
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { computeDedupeHash } from '@/lib/ingest/dedupe';
import { validateIngestMessage } from '@/lib/ingest/validate';

export interface IngestSummary {
  accepted: number;
  duplicates: number;
  rejected: number;
}

function isDedupeConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * 배치 하나를 처리한다. 배치 크기 상한(413)은 이 함수를 부르기 전에
 * route.ts 가 검사한다 — 여기서는 "이미 통과한 배치"만 다룬다.
 *
 * @param deviceId  인증된 기기. 소유자(memberId)는 이 함수가 모른다 — 소유자는
 *   항상 Device 를 통해서만 유도되고, RawMessage 는 memberId 컬럼을 갖지
 *   않는다(Device.memberId 조인으로만 알 수 있다)
 * @param rawMessages JSON.parse 로 얻은 배열 원소. 타입을 아직 신뢰하지 않는다
 * @param now 판정 기준 시각. 테스트가 아니면 항상 기본값(현재 시각)을 쓴다
 */
export async function ingestMessages(
  deviceId: string,
  rawMessages: unknown[],
  now: Date = new Date(),
): Promise<IngestSummary> {
  const summary: IngestSummary = { accepted: 0, duplicates: 0, rejected: 0 };

  for (const raw of rawMessages) {
    const validated = validateIngestMessage(raw, now);
    if (!validated.ok) {
      summary.rejected += 1;
      continue;
    }

    const { source, packageName, title, body, receivedAt } = validated.value;
    const dedupeHash = computeDedupeHash({ deviceId, packageName, title, body, receivedAt });

    try {
      await prisma.rawMessage.create({
        data: {
          deviceId,
          source,
          packageName,
          title,
          body,
          receivedAt,
          dedupeHash,
          parseStatus: 'PENDING',
        },
      });
      summary.accepted += 1;
    } catch (error) {
      if (isDedupeConflict(error)) {
        summary.duplicates += 1;
        continue;
      }
      throw error;
    }
  }

  return summary;
}
