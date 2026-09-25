import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { visibleMemberIds } from '@/lib/auth/scope';
import { prisma } from '@/lib/db';
import { listCards } from '@/lib/cards';
import { dayInput } from '@/lib/time';
import { ActionForm } from '@/components/forms/ActionForm';
import { saveCardAction, saveAliasAction } from './actions';
const input = 'border-input rounded-md border bg-transparent px-3 py-2';
function CardFields({ card }: { card?: Awaited<ReturnType<typeof listCards>>[number] }) {
  return (
    <>
      <label>
        카드사 코드
        <input
          name="issuer"
          defaultValue={card?.issuer ?? ''}
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
          defaultValue={card?.last4 ?? ''}
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
export default async function CardsPage() {
  const session = await requireSession(),
    visible = await visibleMemberIds(session);
  const [cards, members] = await Promise.all([
    listCards(session),
    prisma.familyMember.findMany({
      where: { id: { in: visible } },
      select: { id: true, name: true },
    }),
  ]);
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
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">새 카드</h2>
        <ActionForm action={saveCardAction}>
          <label>
            구성원
            <select name="memberId" className={input}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <CardFields />
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
