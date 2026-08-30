// POST /api/ingest의 건별 처리. 파싱은 하지 않고 RawMessage(PENDING)만 만든다.
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { computeDedupeHash } from '@/lib/ingest/dedupe';
import { isValidClientMessageId, validateIngestMessage } from '@/lib/ingest/validate';

export type IngestItemStatus = 'accepted' | 'duplicate' | 'rejected';

export interface IngestItemResult {
  clientMessageId: string;
  status: IngestItemStatus;
  reason?: string;
}

export interface IngestSummary {
  accepted: number;
  duplicates: number;
  rejected: number;
  results: IngestItemResult[];
}

function isDedupeConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * route.ts가 모든 항목의 clientMessageId 형식과 배치 내 유일성을 먼저
 * 확인한다. 이 방어는 HTTP 계층을 우회해 함수를 잘못 호출했을 때도 항목별
 * 응답의 상관관계가 깨지지 않게 한다.
 */
function requireClientMessageId(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('clientMessageId 사전 검증 없이 ingestMessages를 호출했습니다.');
  }
  const clientMessageId = (raw as Record<string, unknown>).clientMessageId;
  if (!isValidClientMessageId(clientMessageId)) {
    throw new Error('clientMessageId 사전 검증 없이 ingestMessages를 호출했습니다.');
  }
  return clientMessageId;
}

/** 배치 한 개를 순차 처리해 앞 항목의 충돌이 뒤 항목을 막지 않게 한다. */
export async function ingestMessages(
  deviceId: string,
  rawMessages: unknown[],
  now: Date = new Date(),
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    results: [],
  };

  for (const raw of rawMessages) {
    const clientMessageId = requireClientMessageId(raw);
    const validated = validateIngestMessage(raw, now);
    if (!validated.ok) {
      summary.rejected += 1;
      summary.results.push({
        clientMessageId,
        status: 'rejected',
        reason: validated.reason,
      });
      continue;
    }

    const { source, packageName, title, body, receivedAt } = validated.value;
    const dedupeHash = computeDedupeHash({ deviceId, clientMessageId });

    try {
      await prisma.rawMessage.create({
        data: {
          deviceId,
          clientMessageId,
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
      summary.results.push({ clientMessageId, status: 'accepted' });
    } catch (error) {
      if (isDedupeConflict(error)) {
        summary.duplicates += 1;
        summary.results.push({ clientMessageId, status: 'duplicate' });
        continue;
      }
      throw error;
    }
  }

  return summary;
}
