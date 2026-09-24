# S02-A — 의존성 보안 기준선

검증일: 2026-09-25. [단계별 계획](../plan/staged-execution-plan.md)의 첫 서버 구현 작업입니다.

## 확인과 수정

수정 전 감사 보고서 기준 전체 경고는 12건(Critical 2 / High 7 / Moderate 3),
운영용 의존성 경고는 9건(Critical 2 / High 6 / Moderate 1)이었습니다.
이는 실제 공격 성공이나 동일 개수의 운영 취약 경로를 뜻하지 않습니다.

| 패키지 | 이전 | 적용 | 범위 |
|---|---|---|---|
| next / eslint-config-next | 15.5.23 | 15.5.24 | Next.js 런타임 / 대응 린트 설정 |
| sharp | 0.35.3 | 0.35.4 | standalone 이미지에 포함 |
| mysql2 | 3.15.3 | 3.24.4 | 보안 하한 3.23.1, Prisma CLI/peer 트리, standalone에는 없음 |
| fast-uri | 3.1.5 | 3.1.6 | Prisma 개발 도구/ajv 트리, 검사한 standalone에는 없음 |
| vitest / coverage-v8 / mocker | 4.1.10 | 4.1.11 | 테스트 도구 |
| js-yaml | 4.3.1 | 4.3.2 | 린트 도구 |

현재 런타임은 Linux 컨테이너입니다. Windows 파일시스템 조건의 Next.js 공지와 AVIF 이미지
최적화 조건의 공지를 구분해 검토했습니다. 불필요한 major 변경 없이 보안 수정 버전으로
올렸으며, 전이 의존성의 override는 필요한 major 범위로 제한했습니다.

`mysql2`는 실제 앱의 PostgreSQL 연결 드라이버를 대체하는 변경이 아닙니다.
`js-yaml`은 4.x 범위만 보정해 3.x 소비자에게 major 변경을 강제하지 않습니다.

## 검증 결과

- 전체·운영용 `pnpm audit` 모두 알려진 취약점 경고 0건.
- `pnpm test`: 150 tests 통과. typecheck/lint/format 검사 통과.
- Prisma Client 생성, frozen-lockfile Docker standalone 빌드 통과.
- 격리 복원 DB를 사용하는 새 이미지에서 health/login, 무인증 수집 거부, 4,000자보다 긴
  가공 RCS 신규 수집·동일 ID 재전송, 디바이스 세션, 일회용 nonce, SELF 분리,
  폐기한 토큰·기존 세션 거부를 HTTP로 검증.
- 운영 배포 후 health/login/APK 200, 무인증 ingest 401, APK 해시 일치.
  컨테이너 내부의 Next.js 15.5.24 / sharp 0.35.4 확인.
- 기준 원문 944건을 배포 전후 복원본과 비교: 누락 0, 원문 필드 변경 0.
- 배포 직후 web 메모리 약 67MiB. 단기 관찰이며 장기 메모리 안정성을 확정하지 않음.

테스트 컨테이너와 임시 자격증명 파일은 정리했습니다. 검증 DB에는 기존 복원 원문과 가공
RCS 2건이 남아 있고, 가공 검증 기기는 폐기했습니다. 해당 DB를 seed/reset 대상으로 쓰거나
Git으로 복사하지 않습니다.

## 재검사와 회귀 방지

```bash
cd web
corepack pnpm audit:security
corepack pnpm audit:security:prod
```

CI web 작업에 전체 의존성 High/Critical 감사 관문을 추가했습니다. 감사 서비스 오류도
무시하지 않습니다. 알려진 취약점 목록은 바뀔 수 있으므로 이 문서의 0건은 검증일 기준입니다.

배포 직전 이미지의 로컬 복구 태그는 `familycard-web:before-security-20260925`입니다.
DB migration은 없었습니다. 긴급 이미지 복귀 시 기존 보안 경고가 다시 포함된다는 점을
기록하고 정상 수정 이미지로 재전환합니다.

## 근거

- [Next.js AVIF 이미지 최적화 보안 공지](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)
- [Next.js Windows 파일시스템 보안 공지](https://github.com/advisories/GHSA-p293-qw3h-jr36)
- [sharp/libheif 공지](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)
- [mysql2 인증 공지](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)
- [mysql2 압축 처리 공지](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)
- [fast-uri 공지](https://github.com/advisories/GHSA-5jgf-p345-68v8)
- [Vitest 공지](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)
- [js-yaml 공지](https://github.com/advisories/GHSA-2883-xcg3-v3hh)
