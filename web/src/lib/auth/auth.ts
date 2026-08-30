// Auth.js v5 전체 인스턴스 — Credentials provider 를 포함한다.
//
// 이 파일은 Prisma 를 끌어들이므로 **미들웨어에서 import 하면 안 된다.**
// 미들웨어는 config.ts 만 가지고 별도 인스턴스를 만든다.
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/db';
import { authConfig } from '@/lib/auth/config';
import { scopeForWebLogin } from '@/lib/auth/scope';

// bcrypt 형식의 유효한 더미 해시. 어떤 평문과도 일치하지 않는다.
// (cost 10 으로 생성 — 실제 계정 해시와 같은 비용이라야 시간차가 줄어든다.)
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.LMGmnVjRPCkkzBrxvJmVlBw0mLwe';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      // 이 프로젝트의 로그인 아이디는 이메일이 아니라 FamilyMember.name 이다
      // (가족 단위라 이메일을 요구할 이유가 없다). name 은 스키마에서
      // UNIQUE 이므로 계정을 하나로 특정할 수 있다.
      credentials: {
        name: { label: '이름', type: 'text' },
        password: { label: '비밀번호', type: 'password' },
      },

      async authorize(credentials) {
        const name = typeof credentials?.name === 'string' ? credentials.name.trim() : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';

        if (!name || !password) return null;

        const member = await prisma.familyMember.findUnique({ where: { name } });

        // 계정이 없을 때도 비밀번호 비교와 비슷한 비용을 쓰도록 더미 해시와
        // 대조한다. 응답 시간 차이로 "그 이름이 존재하는지"가 새어나가는 것을
        // 줄이기 위한 것이다. (호출자도 실패 사유를 구분하지 않는다 —
        // actions.ts 의 signInAction 주석 참고.)
        if (!member) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }

        const matches = await bcrypt.compare(password, member.passwordHash);
        if (!matches) return null;

        return {
          id: member.id,
          memberId: member.id,
          name: member.name,
          role: member.role,
          // 여기가 웹 로그인 경로다. 디바이스 토큰 경로(Phase 2)는 이 함수를
          // 쓰지 않고 항상 SELF 로 발급한다.
          scope: scopeForWebLogin(member.role),
          entrypoint: 'WEB',
        };
      },
    }),
  ],
});
