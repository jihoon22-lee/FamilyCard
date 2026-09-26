import Link from 'next/link';
import type { SpendingStatus } from '@/lib/spending-status';
export function SpendingNotice({ status }: { status: SpendingStatus }) {
  if (status.state === 'CALCULATED') return null;
  return (
    <div className="my-2 text-sm">
      <p>
        {status.state === 'EMPTY'
          ? '알림이 수집되고 거래로 분석되면 사용액을 표시합니다.'
          : status.state === 'UNAVAILABLE'
            ? '수집된 내역의 분석·확인이 끝나지 않아 사용액을 아직 계산할 수 없습니다. 사용액이 0원이라는 뜻은 아닙니다.'
            : '분석된 내역의 잠정 합계입니다. 미분석·확인 필요 내역이 반영되면 금액이 달라질 수 있습니다.'}
      </p>
      {status.unresolvedRaw > 0 && (
        <p>
          전체 기간 미분석·확인 필요 원문 {status.unresolvedRaw.toLocaleString('ko-KR')}건.
          승인·취소·중복 여부를 확인한 뒤 합산합니다.
        </p>
      )}
      <p>
        카드 등록만으로 분석이 완료되지는 않습니다. 알림 형식에 맞는 해석 규칙도 설정해야 합니다.
      </p>
      <div className="mt-2 flex gap-4">
        <Link href="/raw" className="underline">
          수집 원문 확인
        </Link>
        <Link href="/cards" className="underline">
          카드 설정
        </Link>
        <Link href="/review" className="underline">
          분석·확인할 내역
        </Link>
      </div>
    </div>
  );
}
