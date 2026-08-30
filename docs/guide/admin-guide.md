# 관리자 가이드

서버 설치·운영과 가족 계정 관리를 담당하는 사람을 위한 문서입니다.

> **현재 개발 상태**: Phase 2는 실기기 검증 전입니다. 공개 릴리스는 아직 `v0.1.0`이고,
> main의 운영 Compose가 요구하는 migration 이미지는 다음 릴리스부터 제공됩니다. 지금
> 새 운영 설치를 만들지 말고, 실제 카드 알림 수집용 `v0.2.0`은 개인정보 canary와 서명
> 배포를 끝낸 뒤에만 만듭니다.

---

## 1. 서버 설치 (NAS / 집 서버)

### 필요한 것

- Docker + Docker Compose가 도는 장비 (NAS, 미니PC, 라즈베리파이 4 이상)
- 상시 전원 · 네트워크
- Tailscale 계정 (무료)

### 설치

```bash
git clone https://github.com/jihoon22-lee/FamilyCard.git
cd FamilyCard

cp .env.example .env
```

`.env`를 열어 아래를 채웁니다.

```bash
# 반드시 바꿀 것
FAMILYCARD_VERSION=<배포할 태그에서 v를 뺀 값>
POSTGRES_PASSWORD=<긴 랜덤 문자열>
AUTH_SECRET=<openssl rand -base64 32 결과>
INVITE_CODE=<가족에게만 알려줄 코드>

# Tailscale Serve가 표시한 주소 (아래 2번에서 확인)
APP_URL=https://<device-name>.<your-tailnet>.ts.net
AUTH_URL=https://<device-name>.<your-tailnet>.ts.net
```

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# 헬스체크
curl http://localhost:3000/api/health
```

### 첫 관리자 계정

초대 코드로 가입한 **첫 번째 계정이 자동으로 ADMIN**이 됩니다. 이후 가입자는 MEMBER입니다.

---

## 2. Tailscale 설정

**공유기 포트포워딩은 하지 마세요.** 인증 없이 인터넷에 노출됩니다.

```bash
# 서버에 Tailscale 설치
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 로컬 3000 포트를 tailnet 안에서만 HTTPS로 제공
sudo tailscale serve --bg localhost:3000
tailscale serve status
```

명령 출력의 `https://<device-name>.<your-tailnet>.ts.net` 주소를 `APP_URL`과
`AUTH_URL`에 그대로 넣습니다. 최신 문법은
[Tailscale Serve 공식 문서](https://tailscale.com/docs/reference/tailscale-cli/serve)를 기준으로 합니다.

**`tailscale funnel`은 쓰지 마세요.** Funnel은 서비스를 인터넷 전체에 공개하고, 같은
포트에서 Serve와 동시에 쓸 수 없습니다. 기존 Funnel이 있으면
`tailscale funnel status`와 `tailscale serve status`를 먼저 확인한 뒤 별도 경로·포트를
계획하세요. FamilyCard는 tailnet 안에서만 제공해야 합니다.

가족 폰에도 Tailscale 앱을 깔고 같은 계정으로 로그인시킵니다. 그래야 밖에서도 접속됩니다.

> **APP_URL과 앱 설정의 서버 주소가 정확히 같아야 합니다.** WebView가 그 호스트 외의 URL 로드를 차단하기 때문입니다.

---

## 3. 가족 계정과 기기 등록

### 계정

1. 가족에게 `INVITE_CODE`를 알려줌
2. 각자 웹에서 가입
3. 관리자 화면에서 이름·색상 확인

### 카드 등록

가족에게 받은 정보로 카드를 등록합니다.

| 항목 | 주의 |
|---|---|
| 카드사 | |
| **뒤 4자리** | **실물 카드를 보고 정확히.** 알림에서 추측하지 말 것 |
| 카드 이름 | **카드사 앱 표시명과 비슷하게.** 번호 없는 알림을 이걸로 구분 |
| 결제일 | 실적 사이클이 결제일 기준인 카드에 필요 |

> 같은 카드사에 뒷자리가 비슷한 카드가 여러 장이면 마스킹된 알림 매칭이 자주 실패합니다. 미확정 큐에서 한 번씩 지정해주면 학습됩니다.

### 기기 토큰 발급

1. 관리자 화면 → **기기 관리** → 새 기기 추가
2. 구성원 선택 → 토큰이 **1회만** 표시됨
3. 즉시 복사해 가족 앱 설정의 기기 토큰 칸에 붙여넣기

**토큰 원문은 다시 볼 수 없습니다.** 놓쳤으면 폐기하고 재발급하세요.

QR 생성·스캔은 아직 구현되지 않았습니다.

### 가족별 수집 대상 등록

패키지명이나 발신번호를 관리자가 코드에 넣지 않습니다. 각 가족이 자기 폰의 FamilyCard
**설정 → 수집 대상**에서 카드사 앱, 토스·카카오페이·네이버페이 같은 결제/자산 앱,
카카오 공식 채널, SMS 발신자를 추가·삭제합니다. USB/ADB 연결은 필요하지 않습니다.
앱 선택 화면은 검색과 다중 선택을 제공하고 국내 주요 공식 금융 앱을 먼저 보여줍니다.
추천은 자동 허용이 아니며 사용자가 최종 확인한 앱만 저장됩니다.

관리자는 첫 실기기 배포 때 다음만 함께 확인합니다.

- 선택한 앱이 공식 금융 앱인지(등록 앱의 모든 알림 본문이 수집 대상)
- 카카오 공식 채널 제목이 알림에 표시되는 값과 정확히 같은지
- 일반 카카오 대화와 개인 SMS가 pending 및 `/raw` 건수를 늘리지 않는지
- 카드사 앱과 결제 앱이 같은 결제를 동시에 알리면 `/raw`에 출처가 다른 두 원문으로 남는지

대상을 삭제해도 이미 수집된 `RawMessage`는 삭제되지 않습니다. 실제 원문·가맹점·금액은
메신저나 이슈로 받지 말고 권한이 적용된 `/raw`에서만 확인합니다.

### 기기 폐기

폰 분실·교체 시 **기기 관리에서 폐기**하면 토큰, 아직 쓰지 않은 nonce, 이미 발급된
WebView 디바이스 세션이 모두 무효가 됩니다.

앱 세션은 `scope: SELF`라 그 구성원 데이터만 노출되지만, 그래도 바로 폐기하세요.

---

## 4. 실적 규칙 튜닝

**처음에는 오차가 나는 게 정상입니다.** 카드사의 실적 제외 기준이 약관에 다 적혀 있지 않기 때문입니다.

### 튜닝 절차

```
1. 카드사 앱에서 전월실적 확인          예: 신한 딥드림 284,300원
2. FamilyCard 의 추정치 확인            예: 291,000원
3. 차이 6,700원의 원인 추적
   → 실적 화면에서 "제외된 건" 목록을 펼침
   → 카드사는 뺐는데 우리는 안 뺀 항목을 찾음
   → 예: 통신비 6,700원이 실적에 포함돼 있음
4. 카드 실적 규칙 편집 → TELECOM 제외 체크
5. 다시 대조
```

### 카드마다 갈리는 항목

아래 다섯은 카드에 따라 인정하기도, 안 하기도 합니다. **카드별 체크박스**로 조정하세요.

- 도시가스 / 전기 / 수도 / 이동통신 / 인터넷

### 거의 모든 카드에서 제외되는 항목 (기본 체크)

국세·지방세 · 4대보험 · 상품권 구매 · 선불충전 · 아파트관리비 · 후불교통 · 대학등록금

### 취소 차감 정책

3월 결제를 4월에 취소했을 때 어느 달 실적에서 뺄지가 카드사마다 다릅니다.

- `DEDUCT_FROM_ORIGINAL` (기본값) — 원거래 달에서 차감
- `DEDUCT_FROM_CANCEL_PERIOD` — 취소한 달에서 차감

기본값으로 두고, 카드사 수치와 계속 어긋나면 바꿔보세요.

---

## 5. 업데이트

### 서버

```bash
cd FamilyCard
git pull
# 배포할 릴리스 번호로 .env의 FAMILYCARD_VERSION 변경
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

운영 Compose는 같은 버전의 `familycard-migrate` 이미지를 먼저 실행해
`prisma migrate deploy`가 성공한 뒤에만 web을 시작합니다. migration 실패 시 web이 새
스키마로 뜨지 않으므로 다음 로그를 먼저 확인합니다.

```bash
docker compose -f docker-compose.prod.yml logs migrate
```

### 자동 업데이트

이 프로젝트는 web과 migration 이미지를 같은 **명시 버전**으로 맞춰야 하므로 Watchtower의
`latest` 자동 교체를 권장하지 않습니다. 릴리스 노트를 확인하고 `FAMILYCARD_VERSION`을
직접 올린 뒤 위 명령으로 배포하세요.

### 안드로이드 앱

태그를 push하면 CD가 릴리스 APK를 만들고 서명을 검증합니다. signing secret이 구성된 경우
같은 APK를 **GitHub Release에 첨부하고 web 이미지의**
`/downloads/familycard.apk`에도 넣습니다. NAS에서 새 web 이미지를 배포한 뒤 가족은 앱의
**설정 → 앱 업데이트 → 최신 APK 받기**로 다운로드할 수 있습니다.

Android 보안상 다운로드 뒤 설치 확인은 가족이 직접 눌러야 합니다. `versionCode`가 더
높고 기존 앱과 application ID·서명키가 같아야 덮어쓰기 설치됩니다. 서명 오류가 나면 앱을
삭제하지 말고 배포 artifact와 키를 먼저 확인하세요.

현재 개발 서버에 같은 PC의 debug APK를 게시할 때는 다음 명령을 씁니다. 생성된 APK는
Git에 커밋되지 않습니다.

```bash
cd android
./gradlew publishDebugApk
# https://<개발 서버>/downloads/familycard.apk
```

이 다운로드 기능이 없는 구버전은 위 고정 주소를 폰 브라우저에 한 번 직접 입력해 새 APK를
설치합니다. 그다음 버전부터 앱 설정 버튼을 쓸 수 있습니다.

> **APK 재배포가 필요한 경우는 권한·캡처 로직이 바뀔 때뿐입니다.** 화면·파서·실적 규칙 변경은 서버만 올리면 됩니다.

---

## 6. 안드로이드 서명 키

### 최초 생성

```bash
keytool -genkey -v -keystore familycard.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias familycard
```

### ⚠️ 반드시 백업하세요

**키를 잃어버리면 덮어쓰기 업데이트가 불가능합니다.** 가족 전원이 앱을 지우고 다시 깔아야 하고, 그 과정에서 **아직 서버로 안 올라간 결제 내역이 사라집니다.**

`familycard.jks`와 비밀번호를 안전한 곳(암호화된 외장 저장소, 비밀번호 관리자)에 보관하세요. **저장소에는 절대 커밋하지 마세요** — `.gitignore`에 등록돼 있습니다.

### CI에서 서명하기

GitHub Secrets에 등록하면 CD가 릴리스 APK를 자동으로 빌드합니다.

```bash
base64 -w0 familycard.jks   # 이 값을 KEYSTORE_BASE64 에
```

| Secret | 값 |
|---|---|
| `KEYSTORE_BASE64` | 위 base64 문자열 |
| `KEYSTORE_PASSWORD` | keystore 비밀번호 |
| `KEY_ALIAS` | `familycard` |
| `KEY_PASSWORD` | 키 비밀번호 |

### 키를 GitHub에 두기 싫다면

CD 워크플로우의 `build-apk` 잡을 비활성화하고 로컬에서 빌드하세요.

```bash
cd android
export KEYSTORE_FILE=/안전한/절대경로/familycard.jks
export KEYSTORE_PASSWORD='<keystore 비밀번호>'
export KEY_ALIAS=familycard
export KEY_PASSWORD='<키 비밀번호>'
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

가족에게는 이 파일을 직접 전달합니다.

---

## 7. 백업

### 자동 백업

```bash
# /etc/cron.daily/familycard-backup
#!/bin/sh
cd /path/to/FamilyCard
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U familycard familycard | gzip > "./backups/$(date +%F).sql.gz"

# 30일 이상 된 백업 삭제
find ./backups -name '*.sql.gz' -mtime +30 -delete
```

`./backups`는 `docker-compose.prod.yml`에서 컨테이너에 마운트돼 있습니다. **저장소에 커밋되지 않도록** `.gitignore`에 등록돼 있습니다.

덤프에는 카드 알림 원문과 거래내역이 평문으로 들어 있습니다. NAS 밖에 복사할 때는 반드시
암호화하고, 복호화 키는 백업 파일과 다른 위치에 보관하세요.

### 복구

```bash
gunzip -c backups/2026-08-10.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U familycard familycard
```

### ⚠️ 복구를 실제로 한 번 해보세요

백업 스크립트가 돈다는 것과 그 백업으로 복구가 된다는 것은 다릅니다. **한 번도 복구해보지 않은 백업은 백업이 아닙니다.**

운영 DB를 덮어쓰지 말고 별도 테스트 DB/볼륨에 덤프를 복원한 뒤 migration status와
앱 health check를 확인하세요.

---

## 8. 트러블슈팅

### 특정 가족의 데이터가 며칠째 안 올라옴

가장 흔한 원인 순서대로:

1. **배터리 최적화** — 폰이 앱을 잠재움. 앱 설정 탭에서 예외 확인
2. **알림 접근 권한 꺼짐** — OS 업데이트 후 풀리는 경우가 있음
3. **카드사 알림 설정** — 최소 금액이 다시 5만원으로 돌아갔을 수 있음
4. **토큰 폐기됨** — 기기 관리에서 확인

관리자 화면의 **수집기 무응답 경고**(Phase 6)로 미리 잡을 수 있습니다.

### 미확정 큐가 계속 쌓임

- **카드 미확정** — 등록 안 된 카드일 수 있습니다. 새 카드를 만들었는지 확인
- **파싱 실패** — 카드사가 알림 문구를 바꿨을 수 있습니다. 파서 규칙 화면에서 "이 문구로 규칙 만들기"로 대응

규칙을 추가한 뒤 **재파싱**을 돌리면 밀려 있던 건이 한꺼번에 풀립니다. 반드시 `dryRun`으로 먼저 확인하세요 — `wouldBreak`가 0이 아니면 기존에 잘 되던 게 깨지는 것입니다.

### 실적이 카드사와 크게 다름

위 **4. 실적 규칙 튜닝** 참고. 제외된 건 목록을 열어 원인을 찾는 것이 시작입니다.

미확정 건이 많으면 실적이 실제보다 적게 나옵니다 — 미확정 건은 실적에 안 들어가기 때문입니다.

### 앱에서 "연결할 수 없습니다"

1. 서버가 떠 있는지 — `docker compose ps`
2. 가족 폰의 Tailscale이 켜져 있는지
3. 앱 설정의 서버 주소가 `APP_URL`과 정확히 같은지

### 디스크가 찼음

```bash
docker system prune -a        # 안 쓰는 이미지 정리
du -sh backups/               # 오래된 백업 확인
```

`RawMessage`는 삭제하지 않는 것이 원칙이지만, 텍스트라 용량이 크지 않습니다(월 수백 건 × 수백 바이트). 대개 도커 이미지나 백업이 원인입니다.

---

## 9. 보안 점검 목록

정기적으로 확인하세요.

- [ ] 공유기 포트포워딩이 열려 있지 않은가 (**절대 금지**)
- [ ] 수집 로그에 제목·본문이 없는가 (수집 경로는 로그 레벨과 무관하게 원문 기록 금지)
- [ ] 쓰지 않는 기기 토큰이 남아 있지 않은가
- [ ] `.env`가 저장소에 커밋되지 않았는가
- [ ] keystore 백업이 있는가
- [ ] 백업이 실제로 복구되는가

---

## 관련 문서

- [설계 문서](../design/00-overview.md) — 시스템 구조
- [권한 모델](../design/07-auth-scope.md) — 위협 모델
- [실적 엔진](../design/06-benefit-engine.md) — 제외 항목 상세
- [사용자 가이드](user-guide.md) — 가족에게 안내할 내용
