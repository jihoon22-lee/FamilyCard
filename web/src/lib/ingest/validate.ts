// 건별 유효성 검사 — docs/plan/phase2-contract.md §2 "건별 유효성 검사".
//
// 여기서 걸러진 건은 저장하지 않고 `rejected` 로 센다. 배치 안의 다른 건에는
// 영향을 주지 않는다 — 이 함수는 항목 하나만 보고 항목 하나만 판정한다.
// 배치 단위 로직(반복·집계)은 ingest.ts 에 있다.
//
// 파싱은 하지 않는다(Phase 3 의 몫). 여기서 하는 일은 "저장해도 되는
// 형태인가"를 판정하는 것뿐이다.
import type { CaptureOriginKind, MessageSource } from '@prisma/client';

const MAX_BODY_LENGTH = 4000;
const MAX_PACKAGE_NAME_LENGTH = 255;
const MAX_TITLE_LENGTH = 500;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // 5분 — 기기 시계가 조금 앞서는 것은 허용
const MAX_PAST_YEARS = 5;

// 앱이 보낼 수 있는 값은 NOTIFICATION | SMS 뿐이다. MANUAL/STATEMENT 는
// 다른 입력 경로(수기 입력, 명세서 업로드)를 위해 스키마에 존재하는
// 값이라 이 엔드포인트에서는 받지 않는다.
const ALLOWED_SOURCES: ReadonlySet<string> = new Set(['NOTIFICATION', 'SMS']);
const ALLOWED_ORIGIN_KINDS: ReadonlySet<string> = new Set([
  'CARD_APP',
  'PAYMENT_APP',
  'KAKAO_CHANNEL',
  'SMS_SENDER',
  // Android v2 큐를 보존 마이그레이션한 항목만 이 값으로 전송한다.
  'UNKNOWN_APP',
]);
const KAKAO_PACKAGE = 'com.kakao.talk';

export type IngestSource = Extract<MessageSource, 'NOTIFICATION' | 'SMS'>;
export type IngestOriginKind = Extract<
  CaptureOriginKind,
  'CARD_APP' | 'PAYMENT_APP' | 'KAKAO_CHANNEL' | 'SMS_SENDER' | 'UNKNOWN_APP'
>;

export interface ValidatedIngestMessage {
  clientMessageId: string;
  source: IngestSource;
  originKind: IngestOriginKind;
  packageName: string;
  title: string;
  body: string;
  receivedAt: Date;
}

const CLIENT_MESSAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export function isValidClientMessageId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_MESSAGE_ID_PATTERN.test(value);
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

function parseIso8601(value: string): Date | null {
  const match = ISO_8601_PATTERN.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  if (!yearText || !monthText || !dayText || !hourText || !minuteText || !secondText || !zone) {
    return null;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return null;
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

  if (!isValidClientMessageId(message.clientMessageId)) {
    return reject('invalid_client_message_id');
  }

  if (typeof message.source !== 'string' || !ALLOWED_SOURCES.has(message.source)) {
    return reject('invalid_source');
  }

  if (typeof message.originKind !== 'string' || !ALLOWED_ORIGIN_KINDS.has(message.originKind)) {
    return reject('invalid_origin_kind');
  }

  const source = message.source as IngestSource;
  const originKind = message.originKind as IngestOriginKind;
  const validSourceOrigin =
    (source === 'SMS' && originKind === 'SMS_SENDER') ||
    (source === 'NOTIFICATION' && originKind !== 'SMS_SENDER');
  if (!validSourceOrigin) {
    return reject('invalid_source_origin');
  }

  if (
    typeof message.packageName !== 'string' ||
    message.packageName.trim().length === 0 ||
    message.packageName.length > MAX_PACKAGE_NAME_LENGTH ||
    message.packageName.includes('\u0000')
  ) {
    return reject('invalid_package_name');
  }

  const isKakaoPackage = message.packageName.trim() === KAKAO_PACKAGE;
  if (source === 'NOTIFICATION' && (originKind === 'KAKAO_CHANNEL') !== isKakaoPackage) {
    return reject('invalid_origin_identifier');
  }

  // title 은 비어 있어도 된다 — 카드사 알림 중에는 제목 없이 오는 것도
  // 있다. 타입만 확인한다.
  if (typeof message.title !== 'string') {
    return reject('invalid_title');
  }
  if (message.title.length > MAX_TITLE_LENGTH) {
    return reject('title_too_long');
  }
  if (message.title.includes('\u0000')) {
    return reject('invalid_title');
  }
  if (originKind === 'KAKAO_CHANNEL' && message.title.trim().length === 0) {
    return reject('invalid_origin_identifier');
  }

  if (typeof message.body !== 'string' || message.body.trim().length === 0) {
    return reject('empty_body');
  }

  if (message.body.length > MAX_BODY_LENGTH) {
    return reject('body_too_long');
  }
  if (message.body.includes('\u0000')) {
    return reject('invalid_body');
  }

  if (typeof message.receivedAt !== 'string') {
    return reject('invalid_received_at');
  }

  const receivedAt = parseIso8601(message.receivedAt);
  if (!receivedAt) {
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
      clientMessageId: message.clientMessageId,
      source,
      originKind,
      packageName: message.packageName,
      title: message.title,
      body: message.body,
      receivedAt,
    },
  };
}
