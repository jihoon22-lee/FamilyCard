# 0.3.0 운영 배포 결과 (2026-09-26)

## 배포 범위

사용자 최신 배포 지시를 ADR 0024에 기록하고 앱/서버 0.3.0, Android code 8로 한 번 갱신했습니다.
PR #50 필수 CI 성공 후 병합한 `650082e`에 v0.3.0 태그를 발행했습니다.
미확인 실기기·백업 암호 별도 보관·한 사이클 정확도는 후속 조건이며 Phase 7/1.0 완료 선언이 아닙니다.

## 검증

- Web 268 tests/typecheck/lint/format, Android 102 tests/lint/release build, Python 24 tests, actionlint 통과.
- 새 운영 백업 원문 990건 격리 복원·13 migrations 적용, 원문 누락/변경 0. 약 10초.
- 기존 설치 APK와 패키지/인증서 일치, code 7→8 상승, 비디버그 release APK 확인.
- 격리 후보 HTTP 화면 10개, DEVICE SELF, 웹 세션 철회와 DEVICE 비영향, 가입 닫힘, 다운로드 해시 확인.
- 운영 전환 직전 재백업·원문 기준선 994건 확보 및 AUTH_SECRET 동일성 확인.
- 운영 DB migrations 적용 후 web만 교체. DB 컨테이너/다른 프로젝트는 재시작하지 않았습니다.
- 운영 HTTPS 인증 화면 7개, DEVICE SELF, APK/JSON 동일 해시·code 8 확인. 기준 원문 994건 누락/변경 0.
- 운영 web 메모리 약 117MiB, 제한 512MiB/V8 old-space 256MiB. 감시 오류/경고 없음. 장기 누수 보장은 아님.
- CD run 36212131762: android-apk/web-image/release 모두 성공. 로컬 서명 APK를 고정 manifest로 검증하고
  GHCR web/migrate 0.3.0과 GitHub prerelease를 발행했습니다. 개인 키는 GitHub에 전송하지 않았습니다.

## 산출물·복구 기준

- [v0.3.0 릴리스](https://github.com/jihoon22-lee/FamilyCard/releases/tag/v0.3.0)
- APK SHA-256: `714057c6ab1760064f8d52d4c9471d859cf91fe199effb3fc17bed0484ed7a0c`.
- 로컬 운영 이미지는 같은 검증 소스로 빌드한 `familycard-web:0.3.0`이며 `familycard-web:latest`도 같은 이미지를 가리킵니다.
  현재 집 서버는 기존 로컬 Compose를 유지하며 `.env`의 FAMILYCARD_VERSION=0.3.0도 기록했습니다.
- 이전 이미지 `familycard-web:before-0.3.0`, 이전 APK `data/releases/before-0.3.0/` 보존.
  기존 `familycard-web:before-security-20260925`와 모든 실제 백업/복원 DB도 보존했습니다.
- private 증거: `data/verification/release-0.3.0-baseline.json`, `release-0.3.0-live-before.json`,
  `release-0.3.0-smoke.json`, `release-0.3.0-deployed.json`. 실제 값/비밀은 Git에 넣지 않습니다.

## 사용자 후속 작업

기존 앱 위에 APK를 덮어쓰기 설치하고 설정/큐/수집을 확인합니다. 기존 웹 쿠키는 다시 로그인합니다.
실제 카드/파싱 규칙/실적 조건을 검토 등록하기 전 자동 처리와 알림 스케줄러는 false를 유지합니다.
재부팅·개인정보/RCS·가족 커버리지·백업 암호 별도 보관과 실제 명세서 대조는 미확인으로 남깁니다.
