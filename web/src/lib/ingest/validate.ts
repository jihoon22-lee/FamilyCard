// 건별 유효성 검사 — docs/plan/phase2-contract.md §2 "건별 유효성 검사".
//
// 여기서 걸러진 건은 저장하지 않고 `rejected` 로 센다. 배치 안의 다른 건에는
// 영향을 주지 않는다 — 이 함수는 항목 하나만 보고 항목 하나만 판정한다.
// 배치 단위 로직(반복·집계)은 ingest.ts 에 있다.
//
// 파싱은 하지 않는다(Phase 3 의 몫). 여기서 하는 일은 "저장해도 되는
// 형태인가"를 판정하는 것뿐이다.
import type { MessageSource } from '@prisma/client';

const MAX_BODY_LENGTH = 4000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // 5분 — 기기 시계가 조금 앞서는 것은 허용
const MAX_PAST_YEARS = 5;

// 앱이 보낼 수 있는 값은 NOTIFICATION | SMS 뿐이다. MANUAL/STATEMENT 는
// 다른 입력 경로(수기 입력, 명세서 업로드)를 위해 스키마에 존재하는
// 값이라 이 엔드포인트에서는 받지 않는다.
const ALLOWED_SOURCES: ReadonlySet<string> = new Set(['NOTIFICATION', 'SMS']);

export type IngestSource = Extract<MessageSource, 'NOTIFICATION' | 'SMS'>;

export interface ValidatedIngestMessage {
  source: IngestSource;
  packageName: string;
  title: string;
  body: string;
  receivedAt: Date;
}

export type ValidationResult =
  { ok: true; value: ValidatedIngestMessage } | { ok: false; reason: string };

function reject(reason: string): ValidationResult {
  return { ok: false, reason };
}

function isTooFarInFuture(receivedAt: Date, now: Date): boolean {
  return receivedAt.getTime() - now.getTime() > FUTURE_TOLERANCE_MS;
}

function isTooFarInPast(receivedAt: Date, now: Date): boolean {
  const oldestAllowed = new Date(now.getTime());
  oldestAllowed.setUTCFullYear(oldestAllowed.getUTCFullYear() - MAX_PAST_YEARS);
  return receivedAt.getTime() < oldestAllowed.getTime();
}

/**
 * 배치 안의 메시지 하나를 검사한다.
 *
 * @param raw JSON.parse 로 얻은 값 그대로. 타입을 아직 신뢰할 수 없다
 * @param now 판정 기준 시각. 항상 실제 호출부에서는 `new Date()`를 넘기고,
 *   테스트에서는 고정된 시각을 넘겨 "미래/과거" 판정을 결정적으로 검증한다
 */
export function validateIngestMessage(raw: unknown, now: Date): ValidationResult {
  if (typeof raw !== 'object' || raw === null) {
    return reject('invalid_shape');
  }

  const message = raw as Record<string, unknown>;

  if (typeof message.source !== 'string' || !ALLOWED_SOURCES.has(message.source)) {
    return reject('invalid_source');
  }

  if (typeof message.packageName !== 'string' || message.packageName.length === 0) {
    return reject('invalid_package_name');
  }

  // title 은 비어 있어도 된다 — 카드사 알림 중에는 제목 없이 오는 것도
  // 있다. 타입만 확인한다.
  if (typeof message.title !== 'string') {
    return reject('invalid_title');
  }

  if (typeof message.body !== 'string' || message.body.length === 0) {
    return reject('empty_body');
  }

  if (message.body.length > MAX_BODY_LENGTH) {
    return reject('body_too_long');
  }

  if (typeof message.receivedAt !== 'string') {
    return reject('invalid_received_at');
  }

  const receivedAt = new Date(message.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) {
    return reject('invalid_received_at');
  }

  if (isTooFarInFuture(receivedAt, now)) {
    return reject('received_at_in_future');
  }

  if (isTooFarInPast(receivedAt, now)) {
    return reject('received_at_too_old');
  }

  return {
    ok: true,
    value: {
      source: message.source as IngestSource,
      packageName: message.packageName,
      title: message.title,
      body: message.body,
      receivedAt,
    },
  };
}
