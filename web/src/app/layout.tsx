import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FamilyCard',
  description: '가족 카드 사용금액 · 전월실적 추정 대시보드',
};

// 주 사용처가 안드로이드 앱 WebView(폰 화면)이므로 확대/축소 제스처 대신
// 레이아웃 자체를 모바일 뷰포트에 맞춥니다.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
