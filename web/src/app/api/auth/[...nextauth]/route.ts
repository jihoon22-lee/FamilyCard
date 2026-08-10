// Auth.js 가 필요로 하는 엔드포인트(/api/auth/*). 미들웨어 matcher 에서
// 이 경로를 제외하고 있다 — 여기를 막으면 로그인 자체가 불가능해진다.
import { handlers } from '@/lib/auth/auth';

export const { GET, POST } = handlers;
