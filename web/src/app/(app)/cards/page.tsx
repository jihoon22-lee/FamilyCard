import Link from 'next/link';
import { observedCards, observedCardLabel } from '@/lib/observed-cards';
import { requireSession } from '@/lib/auth/session';
import { visibleMemberIds } from '@/lib/auth/scope';
import { prisma } from '@/lib/db';
import { listCards } from '@/lib/cards';
import { dayInput } from '@/lib/time';
import { ActionForm } from '@/components/forms/ActionForm';
import { saveCardAction, saveAliasAction, linkObservedCardAction } from './actions';
const input = 'border-input rounded-md border bg-transparent px-3 py-2';
function CardFields({
  card,
  discovered,
}: {
  card?: Awaited<ReturnType<typeof listCards>>[number];
  discovered?: { issuer: string | null; token: string | null };
}) {
  return (
    <>
      <label>
        카드사 코드
        <input
          name="issuer"
          defaultValue={card?.issuer ?? discovered?.issuer ?? ''}
          placeholder="예: KB, SHINHAN"
          maxLength={40}
          required
          className={input}
        />
      </label>
      <label>
        카드 이름
        <input
          name="nickname"
          defaultValue={card?.nickname ?? ''}
          maxLength={80}
          required
          className={input}
        />
      </label>
      <label>
        직접 확인한 카드 끝 4자리
        <input
          name="last4"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          defaultValue={
            card?.last4 ??
            (/^\d{4}$/.test(discovered?.token ?? '') ? (discovered?.token ?? '') : '')
          }
          required
          className={input}
        />
      </label>
      <label>
        종류
        <select name="cardType" defaultValue={card?.cardType ?? 'CREDIT'} className={input}>
          <option value="CREDIT">신용</option>
          <option value="DEBIT">체크</option>
        </select>
      </label>
      <label>
        결제일
        <input
          name="statementDay"
          type="number"
          min={1}
          max={31}
          defaultValue={card?.statementDay ?? 14}
          required
          className={input}
        />
      </label>
      <label>
        <input name="isActive" type="checkbox" defaultChecked={card?.isActive ?? true} /> 사용 중
      </label>
      <details>
        <summary>유효 기간 (재발급·해지 구분)</summary>
        <label>
          시작일
          <input
            name="validFrom"
            type="date"
            defaultValue={dayInput(card?.validFrom ?? null)}
            className={input}
          />
        </label>
        <label>
          종료일 (이 날짜부터 제외)
          <input
            name="validTo"
            type="date"
            defaultValue={dayInput(card?.validTo ?? null)}
            className={input}
          />
        </label>
      </details>
      <button type="submit" className="bg-primary text-primary-foreground rounded-md px-4 py-2">
        저장
      </button>
    </>
  );
}
export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ memberId?: string; issuer?: string; token?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession(),
    visible = await visibleMemberIds(session);
  const [cards, members, observed] = await Promise.all([
    listCards(session),
    prisma.familyMember.findMany({
      where: { id: { in: visible } },
      select: { id: true, name: true },
    }),
    observedCards(session),
  ]);
  const discovered = observed.find(
    (g) => g.memberId === params.memberId && g.issuer === params.issuer && g.token === params.token,
  );
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">카드 관리</h1>
        <Link href="/" className="underline">
          대시보드
        </Link>
      </header>
      <p className="text-muted-foreground text-sm">
        카드별 집계의 기준입니다. 끝번호가 겹치거나 식별이 모호하면 자동으로 고르지 않습니다.
        비활성화해도 기존 거래는 유지됩니다.
      </p>
      <section id="observed" className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">알림에서 발견한 카드</h2>
        <p className="text-muted-foreground text-sm">
          카드사와 알림에 표시된 번호로 묶었습니다. 가려진 번호는 그대로 표시합니다. 같은 표기의
          서로 다른 카드가 있을 수 있으니 사용 내역을 확인하고 연결해주세요. 금액은 전체 기간의
          확인된 순사용액입니다.
        </p>
        {!observed.length && <p>연결할 알림 묶음이 없습니다.</p>}
        {observed.map((group) => {
          const candidates = cards.filter(
            (c) => c.memberId === group.memberId && c.issuer === group.issuer && c.isActive,
          );
          return (
            <div key={group.key} className="my-4 rounded-md border p-3">
              <h3 className="font-semibold">
                {session.scope === 'FAMILY' ? `${group.memberName} · ` : ''}
                {observedCardLabel(group.issuer, group.token)}
              </h3>
              <p>
                {group.count}건 ·{' '}
                {group.hasKnownApproval
                  ? `${group.net.toLocaleString('ko-KR')}원`
                  : '확인된 승인금액 없음'}
              </p>
              {group.issuer && (
                <Link
                  href={`/transactions?${new URLSearchParams({ issuer: group.issuer, token: group.token ?? '', memberId: group.memberId })}`}
                  className="underline"
                >
                  이 표기의 사용 내역
                </Link>
              )}
              {group.issuer && group.token?.trim() ? (
                candidates.length ? (
                  <ActionForm action={linkObservedCardAction}>
                    <input type="hidden" name="memberId" value={group.memberId} />
                    <input type="hidden" name="issuer" value={group.issuer} />
                    <input type="hidden" name="token" value={group.token} />
                    <label>
                      실제 카드{' '}
                      <select name="cardId" required defaultValue="" className={input}>
                        <option value="" disabled>
                          연결할 카드 선택
                        </option>
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nickname} ({c.last4})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="rounded-md border px-3 py-2" type="submit">
                      기존 내역과 이후 알림 연결
                    </button>
                  </ActionForm>
                ) : (
                  <p>
                    <a
                      href={`/cards?${new URLSearchParams({ memberId: group.memberId, issuer: group.issuer ?? '', token: group.token ?? '' })}#new-card`}
                      className="underline"
                    >
                      실제 카드 등록
                    </a>{' '}
                    후 이 묶음에 연결할 수 있습니다.
                  </p>
                )
              ) : (
                <p className="text-sm">
                  번호가 없는 알림은 특정 카드로 일괄 연결하지 않습니다. 거래별로 카드를 지정할 수
                  있습니다.
                </p>
              )}
            </div>
          );
        })}
      </section>
      <section id="new-card" className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">새 카드</h2>
        <ActionForm action={saveCardAction}>
          <label>
            구성원
            <select name="memberId" defaultValue={discovered?.memberId} className={input}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <CardFields discovered={discovered} />
        </ActionForm>
      </section>
      {cards.map((card) => (
        <section key={card.id} className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">
            {card.member.name} · {card.nickname} ({card.last4}){!card.isActive ? ' · 비활성' : ''}
          </h2>
          <Link href={`/benefits?cardId=${encodeURIComponent(card.id)}`} className="underline">
            실적 추정치·규칙 설정
          </Link>
          <details>
            <summary>카드 수정</summary>
            <ActionForm action={saveCardAction}>
              <input type="hidden" name="id" value={card.id} />
              <input type="hidden" name="memberId" value={card.memberId} />
              <CardFields card={card} />
            </ActionForm>
          </details>
          <details className="mt-3">
            <summary>알림의 카드 표기 관리 ({card.aliases.length})</summary>
            <ul>
              {card.aliases.map((a) => (
                <li key={a.id} className="my-2 text-sm">
                  {a.token} · {dayInput(a.validFrom) || '시작 제한 없음'} ~{' '}
                  {dayInput(a.validTo) || '종료 제한 없음'}
                </li>
              ))}
            </ul>
            <ActionForm action={saveAliasAction}>
              <input type="hidden" name="cardId" value={card.id} />
              <label>
                원문에 표시된 카드 표기
                <input name="token" maxLength={100} required className={input} />
              </label>
              <label>
                유효 시작일
                <input name="validFrom" type="date" className={input} />
              </label>
              <label>
                유효 종료일
                <input name="validTo" type="date" className={input} />
              </label>
              <button type="submit" className="rounded-md border px-3 py-2">
                표기 저장
              </button>
            </ActionForm>
          </details>
        </section>
      ))}
    </main>
  );
}
