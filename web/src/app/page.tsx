import { Button } from '@/components/ui/button';

// Phase 1 스캐폴딩 placeholder. 실제 대시보드/인증 화면은 다음 웨이브에서 구현합니다.
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center sm:gap-6 sm:p-10">
      <h1 className="text-xl font-semibold sm:text-2xl">FamilyCard</h1>
      <p className="text-muted-foreground max-w-xs text-sm sm:max-w-md sm:text-base">
        프로젝트 스캐폴딩 단계입니다. 로그인과 대시보드는 다음 웨이브에서 구현됩니다.
      </p>
      <Button variant="outline" size="sm" disabled>
        준비 중
      </Button>
    </main>
  );
}
