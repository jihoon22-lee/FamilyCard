// lib/ingest 공개 API. route.ts 와 테스트는 원칙적으로 이 파일을 통해
// 들여온다 — AGENTS.md "파일·네이밍: 라이브러리 모듈은 index.ts로 공개 API를
// 명시하고 내부 구현은 숨기기".
//
// (단, dedupe.ts·validate.ts 의 순수 함수 유닛 테스트는 대상 파일을 직접
// import 한다 — 내부 구현을 정밀하게 검증하는 테스트라 우회할 이유가 없다.)
export { ingestMessages } from '@/lib/ingest/ingest';
export type { IngestSummary } from '@/lib/ingest/ingest';

export { computeDedupeHash, truncateToMinute } from '@/lib/ingest/dedupe';
export type { DedupeHashInput } from '@/lib/ingest/dedupe';

export { validateIngestMessage } from '@/lib/ingest/validate';
export type { IngestSource, ValidatedIngestMessage, ValidationResult } from '@/lib/ingest/validate';
