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
//
// ── 왜 Proxy 로 감쌌나 ────────────────────────────────────────────────
// 예전에는 모듈을 import 하는 순간 클라이언트를 만들었습니다. 그러면
// `next build` 가 페이지 데이터를 수집하며 이 모듈을 평가할 때도
// DATABASE_URL 을 요구하게 됩니다. Docker 이미지 빌드에는 .env 가 없으므로
// (.dockerignore 가 제외) 빌드가 통째로 실패했습니다:
//
//   [Error: Failed to collect configuration for /]
//     cause: Error: DATABASE_URL이 설정되지 않았습니다.
//
// 빌드가 런타임 설정을 요구하는 것 자체가 잘못이라, 첫 사용 시점까지
// 생성을 미룹니다. 이러면 빌드는 DB 설정 없이 통과하고, 설정이 빠진 채
// 실제 요청이 들어왔을 때는 여전히 아래의 친절한 에러가 납니다.
// (Dockerfile 에 더미 DATABASE_URL 을 넣는 우회책도 있지만, 그건 빌드와
//  런타임 설정이 얽힌 상태를 그대로 둔 채 증상만 가립니다.)
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

function getPrismaClient(): PrismaClient {
  const client = globalForPrisma.prisma ?? createPrismaClient();

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);

    // `prisma.$transaction(...)` 처럼 메서드를 꺼내 호출할 때 this 가
    // 끊기지 않도록 묶어서 돌려줍니다. 모델 델리게이트
    // (`prisma.familyMember`)는 객체라 그대로 나갑니다.
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
