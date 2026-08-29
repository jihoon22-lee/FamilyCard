# FamilyCard WSL ext4 저장소 이관

## 개요

- 작업일: 2026-08-29
- 원본 경로: `/mnt/e/projects/FamilyCard`
- 새 경로: `/home/jihoon/projects/FamilyCard`
- 기준 리비전: `origin/main`의 `2ef48e669d203444c695d26e5935141a59cb3ca8`
- 결과: Git 관리 파일은 새 clone으로, 비공개 로컬 설정은 별도 복사로 이관했고 새
  경로에서 web 테스트·빌드와 Android 단위 테스트·APK 빌드를 확인했다.

## 배경

Windows 드라이브의 DrvFS 아래에서 여러 개발 세션을 동시에 실행할 때 파일 I/O와
의존성 디렉터리 접근 비용이 커졌다. Git 이력을 그대로 보존하면서 프로젝트 실행
루트를 WSL ext4로 옮기고, Git이 추적하지 않는 설정과 Docker named volume은 별도로
보존하는 방식으로 이관했다.

## 변경 사항

### 저장소와 로컬 설정

1. GitHub의 `origin/main`을 새 경로에 clone하고 원본·원격·clone의 커밋을 대조했다.
2. Git에서 제외된 루트 `.env`와 `android/local.properties`를 내용 변경 없이 옮기고
   권한을 `0600`으로 제한했다.
3. `web/.env`를 루트 `.env`를 가리키는 `../.env` 심볼릭 링크로 다시 만들었다.
4. Node 의존성은 복사하지 않고 프로젝트가 고정한 pnpm 9.15.9로 새로 설치했다.

```bash
corepack pnpm install --frozen-lockfile
cd web
corepack pnpm exec prisma generate
```

### PostgreSQL 서비스

- `familycard_postgres-data` named volume을 그대로 유지했다.
- `familycard-db` 컨테이너를 새 Compose 파일로 재생성해 Docker의 `config_files`와
  `working_dir` 레이블도 `/home/jihoon/projects/FamilyCard`를 가리키게 했다.
- 재생성 후 컨테이너가 `healthy`이고 Prisma migration 2개가 모두 적용된 상태임을
  확인했다.

### 문서와 기존 경로

- `docs/HANDOFF.md`, `docs/plan/phase-2.md`, `CHANGELOG.md`에 새 작업 경로를 반영했다.
- 기존 디렉터리를 참조하는 프로세스와 열린 파일이 각각 0개임을 확인한 후 영구
  삭제하지 않고 `/mnt/e/.Trash-1000/files/FamilyCard.2`로 옮겼다.
- 복구 메타데이터는 `/mnt/e/.Trash-1000/info/FamilyCard.2.trashinfo`에 남아 있다.

## 검증

| 대상 | 검증 | 결과 |
|---|---|---|
| Git | 원본 `main`, `origin/main`, 새 clone 리비전 대조 | 일치 |
| 비공개 설정 | 원본/새 파일 바이트 비교, 모드 확인 | 일치, `0600` |
| 환경 링크 | `readlink web/.env` | `../.env` |
| PostgreSQL | 컨테이너 health, named volume, Prisma migration | 정상, 기존 volume 유지, schema 최신 |
| Web 정적 검사 | `format:check`, `typecheck`, `lint` | 통과 |
| Web 테스트 | Vitest | 15 files, 129 tests 통과 |
| Web 빌드 | Next.js production build | 통과 |
| Android 단위 테스트 | `./gradlew app:testDebugUnitTest` | 통과 |
| Android APK | `./gradlew app:assembleDebug` | 통과, 10,419,707 bytes |

## 확인된 기존 과제

- 문서와 CI가 참조하는 `ktlintCheck` task는 현재 Gradle 프로젝트에 존재하지 않는다.
- `app:lintDebug`에는 이관 전 코드에도 있던 오류 2건이 남아 있다.
  - `SettingsScreen.kt:159`: minSdk 26에서 API 27 호출
  - `AndroidManifest.xml:5`: 전화 권한에 대응하는 선택적 telephony feature 선언 누락
- lint는 2 errors, 20 warnings, 2 hints로 실패하지만, 단위 테스트와 debug APK 빌드는
  별도로 정상 통과했다. 이관 범위를 벗어난 기능 수정은 이번 변경에 포함하지 않았다.

## 롤백

Git 관리 파일은 GitHub에서 언제든 다시 clone할 수 있다. 비공개 설정이 포함된 기존
전체 작업 트리도 E 드라이브의 휴지통에 남겨 두었으므로, 새 경로 검증이 끝날 때까지
휴지통을 비우지 않으면 수동 복구할 수 있다.
