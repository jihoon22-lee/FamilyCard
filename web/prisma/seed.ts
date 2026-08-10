// 개발용 시드 데이터.
//
// 실행 경로: `prisma migrate dev`/`migrate reset` → prisma.config.ts의
// `migrations.seed`, 또는 `pnpm db:seed` → package.json의 db:seed 스크립트.
// 둘 다 결국 이 파일을 tsx로 직접 실행한다.
//
// 멱등성: 두 번 실행해도 행이 늘어나지 않아야 한다. cuid는 실행마다 달라지므로
// id로는 upsert할 수 없다. 그래서 자연키로 "있으면 갱신, 없으면 생성"한다.
//   - Card:         @@unique([memberId, issuer, last4])
//   - FamilyMember: name @unique (로그인 아이디를 겸하므로 유니크)
//   - Category:     name @unique
//   셋 다 스키마에 실제 유니크 제약이 있어 prisma.upsert()를 그대로 쓴다.
//
// AGENTS.md 불변 규칙 7: 아래 이름·카드번호·가맹점은 전부 가공된 가짜다.
//
// tsx는 Next.js와 달리 .env를 암묵적으로 읽지 않는다. prisma.config.ts와
// 같은 이유로 여기서도 명시적으로 로드한다 (CI에서는 DATABASE_URL이 이미
// 프로세스 환경 변수로 주입되므로 .env가 없어도 조용히 스킵된다).
import 'dotenv/config';

import { CardType, FamilyRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { prisma } from '../src/lib/db';

// 개발 편의용 고정 비밀번호. 운영 데이터에는 절대 쓰지 않는다.
// 시드는 개발/테스트 환경에서만 실행된다.
const DEV_PASSWORD = 'devpassword';

async function main(): Promise<void> {
  // ── FamilyMember ──────────────────────────────────────────────
  // 권한 테스트에 ADMIN·MEMBER 둘 다 필요하다 (AGENTS.md 불변 규칙 3 —
  // role과 scope 판정이 헷갈리지 않는지 두 역할로 확인할 수 있어야 함).
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const admin = await prisma.familyMember.upsert({
    where: { name: '김도현' },
    update: { role: FamilyRole.ADMIN, displayColor: '#2563EB' },
    create: {
      name: '김도현',
      passwordHash,
      role: FamilyRole.ADMIN,
      displayColor: '#2563EB', // blue-600
    },
  });
  const member = await prisma.familyMember.upsert({
    where: { name: '김하은' },
    update: { role: FamilyRole.MEMBER, displayColor: '#F97316' },
    create: {
      name: '김하은',
      passwordHash,
      role: FamilyRole.MEMBER,
      displayColor: '#F97316', // orange-500
    },
  });

  // ── Card ──────────────────────────────────────────────────────
  // admin: SHINHAN 카드 2장을 의도적으로 뒷자리가 비슷하게 배치한다
  // (1234 / 1834). Phase 3 카드매칭에서 알림에 마스킹된 "1*34"가 오면
  // 이 두 장이 모두 후보로 잡히는 실패 케이스를 재현하기 위한 데이터다.
  // → docs/design/04-card-matching.md
  await prisma.card.upsert({
    where: {
      memberId_issuer_last4: { memberId: admin.id, issuer: 'SHINHAN', last4: '1234' },
    },
    update: {},
    create: {
      memberId: admin.id,
      issuer: 'SHINHAN',
      nickname: '신한 딥드림',
      last4: '1234',
      cardType: CardType.CREDIT,
      statementDay: 14,
    },
  });
  await prisma.card.upsert({
    where: {
      memberId_issuer_last4: { memberId: admin.id, issuer: 'SHINHAN', last4: '1834' },
    },
    update: {},
    create: {
      memberId: admin.id,
      issuer: 'SHINHAN',
      nickname: '신한 처음카드',
      last4: '1834',
      cardType: CardType.CREDIT,
      statementDay: 14,
    },
  });
  await prisma.card.upsert({
    where: {
      memberId_issuer_last4: { memberId: admin.id, issuer: 'KB', last4: '5678' },
    },
    update: {},
    create: {
      memberId: admin.id,
      issuer: 'KB',
      nickname: 'KB 국민 마이핏',
      last4: '5678',
      cardType: CardType.DEBIT,
      statementDay: 25,
    },
  });

  // member: 서로 다른 카드사 2장 (충돌 없는 정상 매칭 케이스).
  await prisma.card.upsert({
    where: {
      memberId_issuer_last4: { memberId: member.id, issuer: 'SAMSUNG', last4: '4321' },
    },
    update: {},
    create: {
      memberId: member.id,
      issuer: 'SAMSUNG',
      nickname: '삼성 taptap O',
      last4: '4321',
      cardType: CardType.CREDIT,
      statementDay: 5,
    },
  });
  await prisma.card.upsert({
    where: {
      memberId_issuer_last4: { memberId: member.id, issuer: 'HYUNDAI', last4: '9012' },
    },
    update: {},
    create: {
      memberId: member.id,
      issuer: 'HYUNDAI',
      nickname: '현대 ZERO Edition2',
      last4: '9012',
      cardType: CardType.CREDIT,
      statementDay: 20,
    },
  });

  // ── Category ──────────────────────────────────────────────────
  const categoryNames = ['식비', '교통', '쇼핑', '공과금', '의료', '문화', '기타'];
  for (const name of categoryNames) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }

  console.log('시드 완료:');
  console.log(`  FamilyMember: ${admin.name}(ADMIN), ${member.name}(MEMBER)`);
  console.log(`  Card: admin 3장(SHINHAN x2 뒷자리 유사 + KB), member 2장`);
  console.log(`  Category: ${categoryNames.join(', ')}`);
}

main()
  .catch((error: unknown) => {
    console.error('시드 실패:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
