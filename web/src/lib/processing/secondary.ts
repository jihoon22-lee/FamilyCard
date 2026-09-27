import type { Prisma } from '@prisma/client';
export function isSecondary(raw: { source: string; packageName: string; originKind: string }) {
  return (
    raw.source === 'NOTIFICATION' &&
    raw.originKind === 'PAYMENT_APP' &&
    raw.packageName === 'viva.republica.toss'
  );
}
const dayRange = (date: Date) => {
  const start = Math.floor((date.getTime() + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000;
  return { gte: new Date(start), lt: new Date(start + 86400000) };
};
const normalized = (name: string) => name.replace(/\s+/g, '').toLowerCase();
/** A payment app is corroborating evidence, never a second approval. Re-evaluate when a
 * primary arrives: ambiguity restores REVIEW, making the final result independent of arrival order. */
export async function reconcileSecondary(
  tx: Prisma.TransactionClient,
  memberId: string,
  visible: string[],
  receivedAt: Date,
  issuer: string,
  approvedAt: Date,
) {
  const scope = { memberId: { in: visible }, AND: { memberId }, issuer };
  const secondaries = await tx.transaction.findMany({
    where: {
      ...scope,
      rawMessage: {
        source: 'NOTIFICATION',
        originKind: 'PAYMENT_APP',
        packageName: 'viva.republica.toss',
        OR: [
          { receivedAt: dayRange(receivedAt) },
          { receivedAt: dayRange(approvedAt) },
          {
            receivedAt: {
              gte: new Date(receivedAt.getTime() - 120000),
              lte: new Date(receivedAt.getTime() + 120000),
            },
          },
        ],
      },
    },
    include: { rawMessage: { include: { evidence: { include: { transaction: true } } } } },
    take: 101,
  });
  if (secondaries.length > 100) throw new Error('LEDGER_LIMIT');
  for (const secondary of secondaries) {
    const evidence = secondary.rawMessage.evidence;
    if (secondary.isManuallyEdited || evidence?.isManual || evidence?.transaction.isManuallyEdited)
      continue;
    const at = secondary.rawMessage.receivedAt.getTime();
    const candidates = await tx.transaction.findMany({
      where: {
        ...scope,
        state: 'CONFIRMED',
        txType: secondary.txType,
        amount: secondary.amount,
        currency: secondary.currency,
        OR: [
          { approvedAt: dayRange(secondary.approvedAt) },
          {
            rawMessage: { receivedAt: { gte: new Date(at - 120000), lte: new Date(at + 120000) } },
          },
        ],
        rawMessage: {
          originKind: { in: ['CARD_APP', 'KAKAO_CHANNEL', 'SMS_SENDER'] },
        },
      },
      include: { rawMessage: { select: { receivedAt: true } } },
      take: 101,
    });
    if (candidates.length > 100) throw new Error('LEDGER_LIMIT');
    const plausible = candidates.filter(
      (c) =>
        Math.abs(c.rawMessage.receivedAt.getTime() - at) <= 120000 ||
        (normalized(c.merchantName) &&
          normalized(c.merchantName) === normalized(secondary.merchantName)),
    );
    const matches = plausible.filter(
      (c) =>
        normalized(c.merchantName) &&
        normalized(c.merchantName) === normalized(secondary.merchantName) &&
        Math.abs(c.rawMessage.receivedAt.getTime() - at) <= 120000,
    );
    const target = matches.length === 1 ? matches[0] : null;
    // Explicit issuer-labelled payment notices still prove spending when no issuer evidence exists.
    // A nearby same-amount primary with a different/truncated merchant is ambiguous, not additive.
    const standalone = plausible.length === 0 && secondary.amount !== null;
    await tx.transaction.update({
      where: { id: secondary.id },
      data: {
        state: target ? 'MERGED' : standalone ? 'CONFIRMED' : 'REVIEW',
        mergedIntoId: target?.id ?? null,
        reviewReason: target || standalone ? null : 'SECONDARY_NOTIFICATION',
      },
    });
    await tx.transactionEvidence.upsert({
      where: { rawMessageId: secondary.rawMessageId },
      create: { rawMessageId: secondary.rawMessageId, transactionId: target?.id ?? secondary.id },
      update: { transactionId: target?.id ?? secondary.id },
    });
    await tx.rawMessage.update({
      where: { id: secondary.rawMessageId },
      data: {
        parseStatus: target || standalone ? 'PARSED' : 'NEEDS_CARD',
        parseReason: target || standalone ? null : 'SECONDARY_NOTIFICATION',
      },
    });
  }
}
