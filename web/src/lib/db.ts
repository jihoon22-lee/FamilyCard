// Prisma 클라이언트 싱글턴.
//
// Next.js 개발 모드는 파일을 고칠 때마다 모듈을 새로 평가합니다(HMR). 매번
// `new PrismaClient()`를 호출하면 그때마다 커넥션 풀이 새로 생겨 곧
// "too many connections"로 DB가 죽습니다. 그래서 인스턴스를 globalThis에
// 캐싱해 모듈이 다시 로드돼도 재사용합니다. 프로덕션(빌드된 서버)에서는
// 모듈이 한 번만 평가되므로 캐싱이 사실상 no-op이지만, 재기동 시 오래된
// 인스턴스를 붙들지 않도록 개발 모드에서만 globalThis에 남겨둡니다.
//
// Prisma 7부터 드라이버 어댑터가 필수입니다(schema.prisma에 datasource.url을
// 쓸 수 없어진 것과 같은 변화의 연장선 — web/prisma.config.ts 주석 참고).
// 어댑터 없이 `new PrismaClient()`만 호출하면 쿼리 시점에 에러가 납니다.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL이 설정되지 않았습니다. web/.env를 확인하세요.');
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
