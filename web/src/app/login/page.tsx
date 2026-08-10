import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: '로그인 · FamilyCard',
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">로그인</CardTitle>
          <CardDescription>가족 구성원 이름과 비밀번호로 로그인하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
          <p className="text-muted-foreground mt-6 text-center text-sm">
            아직 계정이 없으신가요?{' '}
            <Link
              href="/signup"
              className="text-foreground font-medium underline underline-offset-4"
            >
              가입하기
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
