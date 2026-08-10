import type { ReactNode } from 'react';

import { requireFamilyScope } from '@/lib/auth/session';

/**
 * scope=FAMILY 전용 화면(관리자 웹)의 진입점.
 * 미들웨어가 1차 방어선, requireFamilyScope()가 2차 방어선이다 — scope가
 * FAMILY가 아니면 /로 리다이렉트한다.
 */
export default async function FamilyLayout({ children }: { children: ReactNode }) {
  await requireFamilyScope();

  return <>{children}</>;
}
