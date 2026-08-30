# 07 — 권한과 가시성

## 요구사항

- 가족 구성원은 **본인 카드 통계만** 봅니다
- 관리자는 웹에서 **가족 전체**를 봅니다
- **관리자도 자기 폰 앱에서는 본인 것만** 봅니다

마지막 항목이 이 설계의 핵심입니다. 같은 사람이라도 **어느 화면으로 들어왔느냐에 따라 보이는 범위가 달라집니다.**

---

## 두 축: `role`과 `scope`

```
FamilyMember.role : MEMBER | ADMIN     — 그 사람이 누구인가 (영속)
Session.scope     : SELF | FAMILY      — 이번 세션이 무엇을 볼 수 있는가 (일시)
```

| 진입 경로 | role | scope | 보이는 것 |
|---|---|---|---|
| 앱 WebView (디바이스 토큰 교환) | 무관 | **항상 SELF** | 본인 카드만 |
| 웹 로그인 | MEMBER | SELF | 본인 카드만 |
| 웹 로그인 | **ADMIN** | **FAMILY** | **가족 전원** |

### scope는 role이 아니라 진입 경로로 먼저 결정된다

```
디바이스 토큰으로 들어옴?
  ├─ 예  →  scope = SELF          (role 을 보지 않음)
  └─ 아니오 (웹 로그인)
        └─ role == ADMIN  →  scope = FAMILY
           role == MEMBER →  scope = SELF
```

디바이스 세션 발급 코드에서 **`role`을 조회조차 하지 않습니다.** 조회하지 않으면 실수로 참조할 수도 없습니다.

→ [ADR 0005](../adr/0005-scope-by-entrypoint.md)

---

## 왜 이렇게 나눴나

### 폰 분실 시 피해 한정

가족용 앱이라 UX를 위해 앱은 로그인 화면 없이 바로 대시보드를 엽니다(디바이스 토큰 → 세션 교환). 편리한 만큼, **폰을 주운 사람이 앱을 열면 그대로 데이터를 봅니다.**

관리자 폰에서 앱이 가족 전체를 보여준다면, 관리자 폰 하나가 가족 전원의 금융 데이터로 통하는 열쇠가 됩니다. scope를 SELF로 묶으면 피해가 본인 데이터로 한정됩니다.

가족 전체를 보려면 **웹에서 비밀번호로 로그인**해야 합니다. 폰을 주운 사람은 그걸 통과할 수 없습니다.

### 권한 상승 경로를 아예 없앰

"디바이스 세션도 role이 ADMIN이면 FAMILY로" 같은 조건문이 있으면, 그게 곧 공격 표면입니다. 조건문이 없으면 뚫을 조건문도 없습니다.

---

## 구현: 조회 경로를 하나로

**모든 데이터 조회는 예외 없이 이 헬퍼를 거칩니다.**

```ts
// web/src/lib/auth/scope.ts

export async function visibleMemberIds(session: Session): Promise<string[]> {
  if (session.scope === 'FAMILY') {
    const members = await prisma.familyMember.findMany({ select: { id: true } });
    return members.map(m => m.id);
  }
  return [session.memberId];
}
```

사용:

```ts
// ✅ 이렇게
const txs = await prisma.transaction.findMany({
  where: {
    memberId: { in: await visibleMemberIds(session) },
    approvedAt: { gte: from, lte: to },
  },
});

// ❌ 절대 이렇게 하지 마세요
const txs = await prisma.transaction.findMany({
  where: { memberId: searchParams.get('memberId') },   // 클라이언트 입력을 신뢰
});
```

### 왜 헬퍼로 강제하는가

화면과 API가 수십 개로 늘어나면, 그중 하나에서 `where`를 손으로 쓰다가 `memberId` 조건을 빠뜨립니다. 그 순간 그 화면은 가족 전체 데이터를 노출합니다. 코드 리뷰로 잡기 어렵고(빠진 조건은 눈에 안 띕니다), 테스트로도 잘 안 걸립니다(개발자는 보통 자기 계정으로만 테스트합니다).

경로를 하나로 모으면 **감사할 지점도 하나**입니다.

→ [불변 규칙 2](../../AGENTS.md)

### 클라이언트 입력은 신뢰하지 않는다

API 라우트는 요청에서 `memberId`를 **받지 않습니다.** 소유자는 항상 세션에서 유도합니다.

관리자가 특정 구성원을 드릴다운하는 경우(Phase 5)에만 `memberId` 파라미터를 받는데, 이때도:

```ts
const visible = await visibleMemberIds(session);
if (!visible.includes(params.memberId)) {
  return new Response(null, { status: 403 });
}
```

**허용 목록에 있는지 확인한 뒤에** 사용합니다.

---

## 라우트 분리

```
web/src/app/
├── (app)/          scope 무관 — 본인 데이터만 다루는 화면
│   ├── page.tsx            대시보드
│   ├── cards/              카드별 상세
│   └── benefits/           실적
└── (family)/       ADMIN 전용 — 미들웨어에서 scope 검사
    ├── page.tsx            가족 매트릭스
    └── members/[id]/       구성원 드릴다운
```

`(family)` 그룹은 미들웨어에서 막습니다.

```ts
// web/src/middleware.ts
if (pathname.startsWith('/family')) {
  const session = await getSession(req);
  if (session?.scope !== 'FAMILY') {
    return NextResponse.redirect(new URL('/', req.url));
  }
}
```

**미들웨어는 1차 방어선일 뿐입니다.** `(family)` 안의 각 페이지와 API도 자체적으로 `visibleMemberIds()`를 거칩니다. 미들웨어 설정 실수 하나로 전부 뚫리면 안 됩니다.

---

## 디바이스 토큰

### 발급

관리자가 웹에서 구성원별로 발급합니다.

```
1. 관리자가 "새 기기 추가" → 구성원 선택
2. 서버가 32바이트 랜덤 토큰 생성
3. Device 레코드에 tokenHash 만 저장 (원문 저장 안 함)
4. 화면에 원문 토큰을 1회만 표시
5. 구성원이 앱 설정 탭에 직접 입력
```

**원문은 다시 볼 수 없습니다.** 잃어버리면 폐기하고 재발급합니다.

### 검증

```ts
const hash = sha256(token);
const device = await prisma.device.findUnique({ where: { tokenHash: hash } });
```

64자 hex 형식을 먼저 확인한 뒤 SHA-256 해시로 UNIQUE 조회합니다. DB에는 장기 토큰 원문이
없으며, 폐기 시각도 조회 결과에서 다시 확인합니다. 별도로 토큰 원문 문자열을 비교하는
코드를 두지 않습니다.

### 폐기

웹에서 기기를 폐기하면 `revokedAt`을 기록하고 토큰 해시를 재사용 불가능한 값으로
바꿉니다. 수집 API와 새 세션 교환은 즉시 `401`이 됩니다.

디바이스 세션 JWT에는 `entrypoint: DEVICE`와 `deviceId`를 담습니다. 보호 조회에서
`getAppSession()`이 해당 기기가 아직 활성이고 같은 구성원 소유인지 다시 확인하므로,
폐기 전에 발급된 WebView 쿠키도 다음 요청부터 세션으로 인정되지 않습니다.

---

## 세션 교환 (앱 → WebView)

앱이 WebView를 열 때 로그인 화면을 보여주지 않기 위한 흐름입니다.

```
1. 앱 → POST /api/auth/device-session  (Authorization: Bearer <deviceToken>)
2. 서버 → { url: "https://<서버>/api/auth/device-session?t=<nonce>" }
        nonce: 랜덤, 60초 만료(DEVICE_SESSION_NONCE_TTL), 1회용
3. 앱이 WebView 에 그 URL 로드
4. 서버가 nonce 소모 → scope=SELF 세션 쿠키 발급 → 대시보드로 리다이렉트
```

### nonce를 쓰는 이유

디바이스 토큰을 URL에 직접 넣으면 안 됩니다. URL은 로그·브라우저 히스토리·리퍼러 헤더에 남고, 디바이스 토큰은 **장기 자격증명**이라 한 번 새면 폐기할 때까지 계속 유효합니다.

nonce는 60초 뒤 만료되고 1회만 쓰이므로, 유출돼도 거의 쓸모가 없습니다.

nonce 레코드에는 발급한 `deviceId`도 저장합니다. nonce 발급과 소비 사이에 기기가
폐기되면 쿠키를 만들지 않습니다. nonce가 소비된 뒤에도 위의 디바이스 세션 활성
검사가 계속 적용됩니다.

---

## 위협 모델

| 위협 | 대응 |
|---|---|
| 폰 분실 → 앱으로 데이터 열람 | scope=SELF라 본인 데이터만. 웹에서 기기 폐기 |
| 디바이스 토큰 유출 | 해당 구성원 데이터만 노출. 즉시 폐기 가능 |
| 세션 URL 유출 (로그·히스토리) | nonce 60초 만료 + 1회용 |
| 가족 구성원이 타인 데이터 조회 시도 | `visibleMemberIds()` — API에 직접 요청해도 차단 |
| 외부에서 서버 직접 접근 | Tailscale. **공유기 포트포워딩 금지** |
| 카카오톡 개인 대화 유출 | 앱이 화이트리스트 외 알림을 저장조차 안 함 → [08](08-android-app.md) |
| DB 파일 유출 (NAS 도난) | 자가호스팅의 한계. NAS 디스크 암호화 권장 |
| 로그에 금융정보 잔존 | 로그 레벨과 무관하게 수집 제목·본문·항목 ID를 기록하지 않음 |

### 명시적으로 다루지 않는 것

- **가족 구성원 간 완전한 상호 불신** — 관리자는 설계상 전원의 데이터를 봅니다. 가정 내 신뢰를 전제합니다
- **서버 침해 시 데이터 암호화** — DB 레벨 암호화는 넣지 않습니다. 자가호스팅 + Tailscale로 노출면을 줄이는 쪽을 택했습니다. 필요하면 NAS 볼륨 암호화로 대응하세요

---

## 세션 쿠키

```ts
{
  httpOnly: true,      // JS 접근 차단
  sameSite: 'strict',  // CSRF 방어
  secure: true,        // HTTPS 전용 (개발 환경 제외)
  maxAge: 30일,
}
```

`sameSite: strict`가 WebView에서도 정상 동작합니다. 앱은 같은 호스트만 로드하기 때문입니다(→ [08](08-android-app.md)).

---

## 테스트 (필수)

권한 관련 변경은 **반드시 테스트를 동반합니다.**

```
✅ MEMBER 웹 로그인 → 세션 scope = SELF
✅ ADMIN  웹 로그인 → 세션 scope = FAMILY
✅ ADMIN 디바이스 토큰으로 세션 발급 → scope = SELF ★
✅ MEMBER 세션으로 /family 접근 → 리다이렉트 또는 403
✅ MEMBER 세션으로 API 에 타인 memberId 전달 → 403 또는 빈 결과 ★
✅ visibleMemberIds(SELF)   → [본인]
✅ visibleMemberIds(FAMILY) → [전원]
✅ 만료된 nonce 로 세션 교환 시도 → 401
✅ 이미 쓴 nonce 재사용 → 401
✅ 폐기된 디바이스 토큰 → 401
✅ nonce 발급 후 기기 폐기 → 쿠키 발급 거부
✅ 기존 디바이스 세션 발급 후 기기 폐기 → 다음 보호 조회에서 거부 ★
```

★ 두 항목이 이 문서의 핵심 주장을 지키는 테스트입니다. 반드시 넣으세요.

---

## 관련 문서

- [ADR 0005](../adr/0005-scope-by-entrypoint.md) — 이 결정의 배경
- [02-ingest](02-ingest.md) — 디바이스 토큰 인증
- [08-android-app](08-android-app.md) — WebView 보안 설정
