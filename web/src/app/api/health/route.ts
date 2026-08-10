import { NextResponse } from 'next/server';

// docker-compose 헬스체크와 배포 스모크 테스트가 이 엔드포인트를 사용합니다.
// 인증을 거치지 않으므로 여기서는 DB 등 외부 의존성 상태를 노출하지 않습니다.
export function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
