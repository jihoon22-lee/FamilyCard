// POST /api/ingest — 안드로이드 앱이 캡처한 알림·문자 원문을 받는다.
//
// 파싱하지 않는다. 전부 parseStatus: PENDING 으로 저장만 한다(Phase 3 이
// 파서다). 이 라우트는 "빨리 받고 끝"이 목표다 — 앱이 배터리를 아끼려면
// 네트워크를 오래 붙잡으면 안 된다(docs/design/02-ingest.md "저장 후").
//
// → docs/plan/phase2-contract.md §2
import { NextResponse } from 'next/server';

import { resolveDevice } from '@/lib/auth/device';
import { prisma } from '@/lib/db';
import { ingestMessages } from '@/lib/ingest';

// .env.example 의 기본값과 맞춘다. 환경변수가 없거나 값이 이상하면(0 이하,
// 숫자 아님) 이 기본값으로 안전하게 떨어진다 — 상한이 없어지는 쪽보다는
// 안전하다.
const DEFAULT_MAX_BATCH_SIZE = 200;

function resolveMaxBatchSize(): number {
  const raw = process.env.INGEST_MAX_BATCH_SIZE;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BATCH_SIZE;
}

function isIngestRequestBody(value: unknown): value is { messages: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  return Array.isArray((value as { messages?: unknown }).messages);
}

export async function POST(request: Request): Promise<NextResponse> {
  const device = await resolveDevice(request.headers.get('authorization'));
  if (!device) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 이후 단계(JSON 파싱, 배치 크기)에서 400/413 으로 끝나더라도 "이 기기가
  // 방금 유효한 토큰으로 서버에 닿았다"는 사실 자체가 무응답 감지(Phase 6,
  // DEVICE_SILENCE_WARN_DAYS)에 중요한 신호라 인증 통과 직후 갱신한다.
  await prisma.device.update({
    where: { id: device.deviceId },
    data: { lastSeenAt: new Date() },
  });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!isIngestRequestBody(payload)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { messages } = payload;
  const maxBatchSize = resolveMaxBatchSize();
  if (messages.length > maxBatchSize) {
    return NextResponse.json({ error: 'batch_too_large' }, { status: 413 });
  }

  const summary = await ingestMessages(device.deviceId, messages);

  // 본문(body)·제목(title)은 절대 로그에 남기지 않는다 — 남으면 카드 알림
  // 원문이 로그 파일에 쌓인다. deviceId·건수·결과만 남긴다.
  console.info('[ingest] 배치 처리 완료', {
    deviceId: device.deviceId,
    requested: messages.length,
    ...summary,
  });

  return NextResponse.json(summary, { status: 200 });
}
