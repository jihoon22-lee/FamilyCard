import { describe, it, expect } from 'vitest';
import { draftPattern, requireRuleAdmin } from './index';
import { validatePatterns } from '@/lib/parser';
describe('parser rule boundaries', () => {
  it('rejects ADMIN phones and MEMBER web sessions', () => {
    for (const session of [
      { role: 'ADMIN', scope: 'SELF', entrypoint: 'DEVICE' },
      { role: 'MEMBER', scope: 'SELF', entrypoint: 'WEB' },
    ] as const)
      expect(() => requireRuleAdmin({ ...session, memberId: 'test', name: '' })).toThrow();
    expect(() =>
      requireRuleAdmin({
        memberId: 'test',
        name: '',
        role: 'ADMIN',
        scope: 'FAMILY',
        entrypoint: 'WEB',
      }),
    ).not.toThrow();
  });
  it('proposes structural groups without assigning guessed financial meanings', () => {
    const draft = draftPattern({
      title: '',
      body: '[가공카드] 1234 테스트 12,000원 08/10',
      source: 'SMS',
    });
    expect(draft.fieldMap).toEqual({});
    expect(draft.pattern).toContain('(?<number1>');
    expect(
      validatePatterns({
        matchPattern: draft.pattern,
        extractPattern: draft.pattern,
        action: 'PARSE',
      }),
    ).toBe(true);
    expect(draft.pattern).not.toContain('12,000');
  });
});
