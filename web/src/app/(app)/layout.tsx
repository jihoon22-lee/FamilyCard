import type { ReactNode } from 'react';
import { AppNavigation } from '@/components/navigation/AppNavigation';

import { requireSession } from '@/lib/auth/session';

/**
 * scope=SELF 화면(앱 WebView + 일반 구성원 웹)의 진입점.
 * 세션이 없으면 requireSession()이 /login으로 리다이렉트합니다.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <>
      <AppNavigation session={session} />
      {children}
    </>
  );
}
