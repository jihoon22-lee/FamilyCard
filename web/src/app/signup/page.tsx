import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignUpForm } from '@/components/auth/signup-form';

export const metadata: Metadata = {
  title: '가입 · FamilyCard',
};

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">가입하기</CardTitle>
          <CardDescription>가족에게 받은 초대 코드로 가입하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />
          <p className="text-muted-foreground mt-6 text-center text-sm">
            이미 계정이 있으신가요?{' '}
            <Link
              href="/login"
              className="text-foreground font-medium underline underline-offset-4"
            >
              로그인
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
