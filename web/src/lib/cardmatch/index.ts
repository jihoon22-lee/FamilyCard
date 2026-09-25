export interface CardCandidate {
  id: string;
  memberId: string;
  issuer: string;
  last4: string;
  nickname: string;
  isActive: boolean;
  validFrom?: Date | null;
  validTo?: Date | null;
  aliases?: Array<{ token: string; validFrom?: Date | null; validTo?: Date | null }>;
}
export type CardMatch =
  | { cardId: string; reason: null; candidates: string[] }
  | { cardId: null; reason: 'NO_CARD_TOKEN' | 'NO_CARD' | 'AMBIGUOUS_CARD'; candidates: string[] };
const within = (at: Date, from?: Date | null, to?: Date | null) =>
  (!from || at >= from) && (!to || at < to);
const normalized = (s: string) => s.replace(/\s+/g, '').toLocaleLowerCase('en-US');
export function matchCard(
  memberId: string,
  issuer: string,
  token: string,
  at: Date,
  cards: readonly CardCandidate[],
): CardMatch {
  const eligible = cards.filter(
    (c) =>
      c.memberId === memberId &&
      c.issuer === issuer &&
      within(at, c.validFrom, c.validTo) &&
      (c.isActive || c.validTo != null),
  );
  const decide = (found: readonly CardCandidate[]): CardMatch =>
    found.length === 1
      ? { cardId: found[0]!.id, reason: null, candidates: [found[0]!.id] }
      : {
          cardId: null,
          reason: found.length ? 'AMBIGUOUS_CARD' : 'NO_CARD',
          candidates: found.map((c) => c.id).sort(),
        };
  if (!token.trim()) return { cardId: null, reason: 'NO_CARD_TOKEN', candidates: [] };
  const aliases = eligible.filter((c) =>
    c.aliases?.some((a) => a.token === token && within(at, a.validFrom, a.validTo)),
  );
  if (aliases.length) return decide(aliases);
  if (/^[\d*xX·●○＊•\s()\-]+$/.test(token)) {
    const tail = token.replace(/[\s()\-]/g, '').slice(-4);
    if (tail.length !== 4 || !/[0-9]/.test(tail))
      return { cardId: null, reason: 'NO_CARD_TOKEN', candidates: [] };
    const matched = eligible.filter(
      (c) =>
        /^\d{4}$/.test(c.last4) &&
        [...tail].every((char, i) => /[*xX·●○＊•]/.test(char) || char === c.last4[i]),
    );
    return decide(matched);
  }
  return decide(
    eligible.filter((c) => c.nickname.trim() && normalized(token).includes(normalized(c.nickname))),
  );
}
