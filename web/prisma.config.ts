// Prisma 7 설정 파일.
//
// Prisma 7부터 datasource.url을 schema.prisma에 직접 쓰는 것을 지원하지
// 않습니다 (에러 P1012: "The datasource property `url` is no longer
// supported in schema files."). 연결 문자열과 시드 명령은 이 파일에서
// 공급합니다.
//
// dotenv를 명시적으로 로드하는 이유: Prisma CLI가 더 이상 .env를 암묵적으로
// 읽지 않습니다 (schema의 url = env(...) 패턴이 사라졌기 때문). CI에서는
// DATABASE_URL이 이미 프로세스 환경 변수로 주입되므로 .env 파일이 없어도
// dotenv/config가 조용히 스킵합니다.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `prisma migrate dev`/`migrate reset`이 마이그레이션 적용 후 자동으로
    // 실행하는 시드 명령. package.json의 db:seed 스크립트와 별개로,
    // Prisma CLI가 이 위치에서 시드 명령을 찾습니다 (구버전의
    // package.json "prisma.seed" 필드는 v7에서 더 이상 읽히지 않음).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
    // Prisma 7 에서 shadow DB URL 은 CLI 플래그(--shadow-database-url)가
    // 제거되고 이 자리로만 공급됩니다. CI 의 "스키마 ↔ 마이그레이션 정합성"
    // 스텝(prisma migrate diff --from-migrations)이 이 값을 필요로 합니다.
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
