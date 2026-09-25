import { RE2JS } from 're2js';
import { narrative } from './normalize';
import { convertFields } from './convert';
import type { ParsingRule, ParseResult } from './types';
export type { ParsingRule, ParseResult, ParsedFields, ParseReason } from './types';
export { money, monthDay } from './convert';
export { narrative } from './normalize';

const cache = new Map<string, RE2JS>();
/** Bound compiled patterns as well as message size; avoid backtracking and unbounded native allocations. */
function compile(pattern: string): RE2JS {
  if (pattern.length > 2048 || pattern.length === 0 || /[})]\{/.test(pattern))
    throw new Error('pattern bounds');
  let expansion = 0;
  for (const match of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    expansion += Math.max(Number(match[1]), Number(match[2] || match[1]));
    if (expansion > 1024) throw new Error('repeat expansion');
  }
  let compiled = cache.get(pattern);
  if (!compiled) {
    compiled = RE2JS.compile(pattern, RE2JS.DOTALL);
    if (cache.size >= 8) cache.delete(cache.keys().next().value!);
    cache.set(pattern, compiled);
  }
  return compiled;
}

export function validatePatterns(
  rule: Pick<ParsingRule, 'matchPattern' | 'extractPattern' | 'action'>,
): boolean {
  try {
    compile(rule.matchPattern);
    if (rule.action === 'PARSE') compile(rule.extractPattern);
    return true;
  } catch {
    return false;
  }
}

export function parseMessage(
  raw: { body: string; title?: string; source: string; receivedAt: Date },
  rules: readonly ParsingRule[],
): ParseResult {
  if (raw.body.length > 64000 || (raw.title?.length ?? 0) > 1000)
    return { status: 'FAILED', reason: 'INPUT_TOO_LARGE' };
  const text = narrative(raw.body, raw.source);
  if (text === null) return { status: 'FAILED', reason: 'UNSUPPORTED_FORMAT' };
  if (text.length > 16000) return { status: 'FAILED', reason: 'INPUT_TOO_LARGE' };
  const input = [raw.title ?? '', text].filter(Boolean).join('\n');
  const active = rules
    .filter((r) => r.isActive)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  if (active.length > 256) return { status: 'FAILED', reason: 'INVALID_RULE' };
  for (const rule of active) {
    const meta = { ruleId: rule.id, ruleVersion: rule.version };
    try {
      if (!compile(rule.matchPattern).matcher(input).find()) continue;
      if (rule.action === 'IGNORE') return { status: 'IGNORED', reason: 'RULE_IGNORED', ...meta };
      const pattern = compile(rule.extractPattern),
        match = pattern.matcher(input);
      if (!match.find()) return { status: 'FAILED', reason: 'EXTRACTION_FAILED', ...meta };
      const groups: Record<string, string | null> = Object.create(null);
      for (const name of Object.keys(pattern.namedGroups())) groups[name] = match.group(name);
      try {
        return {
          status: 'PARSED',
          ...meta,
          fields: convertFields(rule.fieldMap, groups, rule.issuer, raw.receivedAt),
        };
      } catch {
        return { status: 'FAILED', reason: 'INVALID_FIELDS', ...meta };
      }
    } catch {
      return { status: 'FAILED', reason: 'INVALID_RULE', ...meta };
    }
  }
  return { status: 'FAILED', reason: 'NO_RULE' };
}
