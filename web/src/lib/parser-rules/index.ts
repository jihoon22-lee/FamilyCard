import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { AppSession } from '@/lib/auth/types';
import { visibleMemberIds } from '@/lib/auth/scope';
import { visibleRawWhere } from '@/lib/raw';
import { parseMessage, validatePatterns, narrative, type ParsingRule } from '@/lib/parser';
import { InputError } from '@/lib/cards';
import { serializable } from '@/lib/database';
export function requireRuleAdmin(session: AppSession) {
  if (session.scope !== 'FAMILY' || session.role !== 'ADMIN' || session.entrypoint !== 'WEB')
    throw new InputError('관리자 웹에서만 규칙을 변경할 수 있습니다.');
}
export interface RuleInput {
  id?: string;
  expectedVersion?: number;
  issuer: string;
  action: string;
  priority: number;
  isActive: boolean;
  matchPattern: string;
  extractPattern: string;
  fieldMap: unknown;
  sampleText: string;
  sampleReceivedAt: string;
  confirmed: boolean;
}
function normalized(
  input: RuleInput,
): ParsingRule & { sampleText: string; sampleReceivedAt: string } {
  const issuer = input.issuer.trim().toUpperCase();
  if (
    !/^[A-Z0-9_-]{1,40}$/.test(issuer) ||
    !['PARSE', 'IGNORE'].includes(input.action) ||
    !Number.isInteger(input.priority) ||
    Math.abs(input.priority) > 100000 ||
    input.sampleText.length > 16000 ||
    JSON.stringify(input.fieldMap ?? null).length > 8000
  )
    throw new InputError('카드사·우선순위·샘플·필드 매핑을 확인해주세요.');
  const rule = {
    ...input,
    issuer,
    id: input.id ?? 'preview',
    version: input.expectedVersion ?? 1,
    action: input.action as 'PARSE' | 'IGNORE',
  };
  if (!validatePatterns(rule))
    throw new InputError('정규식 형식 또는 길이/반복 한도를 확인해주세요.');
  if (
    input.fieldMap === null ||
    typeof input.fieldMap !== 'object' ||
    Array.isArray(input.fieldMap)
  )
    throw new InputError('필드 매핑은 JSON 객체여야 합니다.');
  return rule;
}
function configuration(rule: ReturnType<typeof normalized>): Prisma.InputJsonObject {
  return {
    issuer: rule.issuer,
    action: rule.action,
    priority: rule.priority,
    isActive: rule.isActive,
    matchPattern: rule.matchPattern,
    extractPattern: rule.extractPattern,
    fieldMap: rule.fieldMap as Prisma.InputJsonValue,
    sampleText: rule.sampleText,
    sampleReceivedAt: rule.sampleReceivedAt,
  };
}
export async function previewRule(
  session: AppSession,
  input: RuleInput,
  db: PrismaClient = prisma,
) {
  requireRuleAdmin(session);
  const rule = normalized(input),
    scope = await visibleRawWhere(session);
  const receivedAt = new Date(input.sampleReceivedAt);
  if (!Number.isFinite(receivedAt.getTime()))
    throw new InputError('샘플 수신 시각을 확인해주세요.');
  const result = parseMessage({ body: input.sampleText, source: 'MANUAL', receivedAt }, [
    { ...rule, isActive: true },
  ]);
  const raws = await db.rawMessage.findMany({
    where: { AND: [scope, { parseStatus: { in: ['FAILED', 'NEEDS_CARD'] } }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { body: true, title: true, source: true, receivedAt: true },
  });
  let parsed = 0,
    ignored = 0,
    matchedFailed = 0;
  for (const raw of raws) {
    const r = parseMessage(raw, [{ ...rule, isActive: true }]);
    if (r.status === 'PARSED') parsed++;
    else if (r.status === 'IGNORED') ignored++;
    else if (r.ruleId) matchedFailed++;
  }
  return { result, checked: raws.length, parsed, ignored, matchedFailed };
}
export async function saveRule(session: AppSession, input: RuleInput, db: PrismaClient = prisma) {
  requireRuleAdmin(session);
  const rule = normalized(input);
  if (input.isActive) {
    if (!input.confirmed || !input.sampleText.trim())
      throw new InputError('샘플 결과를 확인한 후 활성화해주세요.');
    const receivedAt = new Date(input.sampleReceivedAt);
    if (!Number.isFinite(receivedAt.getTime()))
      throw new InputError('샘플 수신 시각을 확인해주세요.');
    const result = parseMessage({ body: input.sampleText, source: 'MANUAL', receivedAt }, [
      { ...rule, isActive: true },
    ]);
    if (result.status === 'FAILED')
      throw new InputError('샘플 해석에 실패한 규칙은 활성화할 수 없습니다.');
  }
  const visible = await visibleMemberIds(session);
  if (!visible.includes(session.memberId)) throw new InputError('관리자 세션을 확인해주세요.');
  return serializable(db, async (tx) => {
    const previous = input.id ? await tx.parserRule.findUnique({ where: { id: input.id } }) : null;
    if (input.id && (!previous || previous.version !== input.expectedVersion))
      throw new InputError('다른 변경이 있습니다. 새로고침 후 다시 확인해주세요.');
    if (
      input.isActive &&
      (await tx.parserRule.count({
        where: { isActive: true, ...(previous ? { id: { not: previous.id } } : {}) },
      })) >= 256
    )
      throw new InputError('활성 규칙은 최대 256개입니다.');
    const data = {
      issuer: rule.issuer,
      action: rule.action,
      priority: rule.priority,
      isActive: rule.isActive,
      matchPattern: rule.matchPattern,
      extractPattern: rule.extractPattern,
      fieldMap: rule.fieldMap as Prisma.InputJsonValue,
      sampleText: rule.sampleText,
      version: (previous?.version ?? 0) + 1,
    };
    const saved = previous
      ? await tx.parserRule.update({ where: { id: previous.id }, data })
      : await tx.parserRule.create({ data });
    await tx.parserRuleRevision.create({
      data: { ruleId: saved.id, version: saved.version, configuration: configuration(rule) },
    });
    await tx.reviewDecision.create({
      data: {
        memberId: session.memberId,
        actorMemberId: session.memberId,
        action: 'SAVE_PARSER_RULE',
        entityId: saved.id,
        before: previous ? { version: previous.version } : undefined,
        after: { version: saved.version, isActive: saved.isActive },
      },
    });
    return saved;
  });
}
export async function restoreRule(
  session: AppSession,
  id: string,
  version: number,
  expectedVersion: number,
  db: PrismaClient = prisma,
) {
  requireRuleAdmin(session);
  const revision = await db.parserRuleRevision.findUnique({
    where: { ruleId_version: { ruleId: id, version } },
  });
  if (
    !revision ||
    !revision.configuration ||
    typeof revision.configuration !== 'object' ||
    Array.isArray(revision.configuration)
  )
    throw new InputError('이력을 찾을 수 없습니다.');
  const c = revision.configuration;
  // Rollback always creates an inactive new version; preview is required before activation again.
  return saveRule(
    session,
    {
      id,
      expectedVersion,
      issuer: String(c.issuer ?? ''),
      action: String(c.action ?? 'PARSE'),
      priority: Number(c.priority),
      isActive: false,
      matchPattern: String(c.matchPattern ?? ''),
      extractPattern: String(c.extractPattern ?? ''),
      fieldMap: c.fieldMap ?? {},
      sampleText: String(c.sampleText ?? ''),
      sampleReceivedAt: String(c.sampleReceivedAt ?? new Date().toISOString()),
      confirmed: false,
    },
    db,
  );
}
export async function rulePageData(session: AppSession, rawId?: string, db: PrismaClient = prisma) {
  requireRuleAdmin(session);
  const scope = await visibleRawWhere(session);
  const [rules, raw] = await Promise.all([
    db.parserRule.findMany({
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      take: 500,
      include: { revisions: { orderBy: { version: 'desc' }, take: 20 } },
    }),
    rawId
      ? db.rawMessage.findFirst({
          where: { ...scope, id: rawId },
          select: { title: true, body: true, source: true, receivedAt: true },
        })
      : null,
  ]);
  return { rules, raw };
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Inactive structural starting point only. Never guesses issuer/card/transaction type. */
export function draftPattern(raw: { title: string; body: string; source: string }) {
  const body = narrative(raw.body, raw.source);
  if (body === null) return { pattern: '^$', fieldMap: {}, sample: '' };
  const sample = [raw.title, body].filter(Boolean).join('\n').slice(0, 16000);
  // Keep punctuation/spacing while generalizing digit sequences. Candidate fields need human mapping.
  let pattern = '^',
    cursor = 0,
    index = 0;
  for (const match of sample.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    pattern += escape(sample.slice(cursor, match.index)) + `(?<number${++index}>[0-9][0-9,.]*)`;
    cursor = match.index + match[0].length;
  }
  pattern += escape(sample.slice(cursor)) + '$';
  return { pattern: pattern.length <= 2048 ? pattern : '^$', fieldMap: {}, sample };
}
