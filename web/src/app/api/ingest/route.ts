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
import { ingestMessages, isValidClientMessageId } from '@/lib/ingest';

// .env.example 의 기본값과 맞춘다. 환경변수가 없거나 값이 이상하면(0 이하,
// 숫자 아님) 이 기본값으로 안전하게 떨어진다 — 상한이 없어지는 쪽보다는
// 안전하다.
const DEFAULT_MAX_BATCH_SIZE = 200;
// 개별 필드 최대 길이의 200건이 JSON escape 최악 조건에서도 들어오도록 둔다.
// 배치 상한과 요청 바이트 상한이 서로 모순되면 유효한 큐가 413에 영구 정체된다.
const DEFAULT_MAX_REQUEST_BYTES = 6_000_000;

function resolveMaxBatchSize(): number {
  const raw = process.env.INGEST_MAX_BATCH_SIZE;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BATCH_SIZE;
}

function resolveMaxRequestBytes(): number {
  const raw = process.env.INGEST_MAX_REQUEST_BYTES;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUEST_BYTES;
}

function isIngestRequestBody(value: unknown): value is { messages: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  return Array.isArray((value as { messages?: unknown }).messages);
}

function hasCorrelatableMessageIds(messages: unknown[]): boolean {
  const ids = new Set<string>();
  for (const raw of messages) {
    if (typeof raw !== 'object' || raw === null) return false;
    const clientMessageId = (raw as Record<string, unknown>).clientMessageId;
    if (!isValidClientMessageId(clientMessageId) || ids.has(clientMessageId)) return false;
    ids.add(clientMessageId);
  }
  return true;
}

type BodyReadResult =
  { ok: true; text: string } | { ok: false; error: 'invalid_body' | 'request_too_large' };

/**
 * Content-Length가 없거나 거짓이어도 최대 크기를 넘는 순간 읽기를 중단한다.
 * request.text()로 전부 메모리에 올린 뒤 검사하면 상한이 메모리 보호 역할을
 * 하지 못하므로 원시 바이트 스트림을 기준으로 센다.
 */
async function readBoundedBody(request: Request, maxBytes: number): Promise<BodyReadResult> {
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: 'request_too_large' };
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { ok: true, text: chunks.join('') };
  } catch {
    return { ok: false, error: 'invalid_body' };
  } finally {
    reader.releaseLock();
  }
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

  const maxRequestBytes = resolveMaxRequestBytes();
  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return NextResponse.json({ error: 'request_too_large' }, { status: 413 });
  }

  const body = await readBoundedBody(request, maxRequestBytes);
  if (!body.ok) {
    const status = body.error === 'request_too_large' ? 413 : 400;
    return NextResponse.json({ error: body.error }, { status });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.text) as unknown;
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
  // 항목별 결과를 폰의 정확한 큐 행에 적용하려면 모든 ID가 형식에 맞고 배치
  // 안에서 유일해야 한다. 상관관계가 불가능한 요청은 건별 reject가 아니라
  // 요청 전체를 거부해 클라이언트가 어떤 원문도 삭제하지 않게 한다.
  if (!hasCorrelatableMessageIds(messages)) {
    return NextResponse.json({ error: 'invalid_client_message_ids' }, { status: 400 });
  }

  const summary = await ingestMessages(device.deviceId, messages);

  // 본문(body)·제목(title)은 절대 로그에 남기지 않는다 — 남으면 카드 알림
  // 원문이 로그 파일에 쌓인다. deviceId·건수·결과만 남긴다.
  console.info('[ingest] 배치 처리 완료', {
    deviceId: device.deviceId,
    requested: messages.length,
    accepted: summary.accepted,
    duplicates: summary.duplicates,
    rejected: summary.rejected,
  });

  return NextResponse.json(summary, { status: 200 });
}
