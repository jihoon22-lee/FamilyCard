# Phase 5 — 관리자 가족 대시보드 + 분석

> 버전 태그: `v0.5.0`

## 목표

관리자가 웹에서 **가족 전체**를 봅니다. `scope=FAMILY`가 처음 실제로 쓰이는 지점입니다.

## 완료 기준

- 관리자가 가족 × 카드 매트릭스를 봄
- **권한 테스트 전부 통과** — 특히 ADMIN 폰 앱에서 본인 것만 보이는지
- 카테고리 자동 분류가 동작

## 작업

### 가족 대시보드 (`/family`, ADMIN 전용)
- [ ] **가족 × 카드 매트릭스** — 행: 구성원, 열: 카드, 값: 사용액 + 실적 달성률
- [ ] 구성원별 합계 · 카드별 합계 · 가족 총액
- [ ] 구성원 드릴다운 (`/family/members/[id]`)
  - **`visibleMemberIds()`에 포함되는지 확인 후 조회** ★
- [ ] 실적 미달 임박 카드 (가족 전체 기준)
- [ ] 미확정 큐 적체 현황 — 구성원별로 몇 건이 방치 중인지
- [ ] 수집기 무응답 기기 경고

### 카테고리 분류
- [ ] `MerchantRule` 기반 자동 분류 (priority 순)
- [ ] 기본 카테고리 세트 시드 (식비 · 교통 · 쇼핑 · 공과금 · 의료 · 문화 · 기타)
- [ ] 미분류 건에 사용자가 카테고리 지정 → **`MerchantRule` 자동 생성**
- [ ] 카테고리 관리 화면

### 분석
- [ ] 전월 대비 · 전년 동월 대비 추이 차트
- [ ] 카테고리별 비중 (구성원별 / 가족 전체)
- [ ] 예산 설정 (`Budget` — 구성원/카테고리 조합)
- [ ] 예산 초과 경고

### 리포트
- [ ] 월간 리포트 내보내기 — 엑셀
- [ ] 월간 리포트 내보내기 — PDF

### 권한 테스트 ★ 이 Phase에서 가장 중요
- [ ] MEMBER 웹 로그인 → 본인 것만
- [ ] MEMBER 세션으로 `/family` 접근 → 리다이렉트 또는 403
- [ ] **MEMBER 세션으로 API에 타인 `memberId` 직접 전달 → 403 또는 빈 결과**
- [ ] ADMIN 웹 로그인 → 가족 전원
- [ ] **ADMIN 폰 앱 → 본인 것만** (scope가 진입 경로로 결정되는지)
- [ ] ADMIN 디바이스 토큰으로 세션 발급 → `scope: SELF`
- [ ] 만료된 nonce / 재사용 nonce → 401
- [ ] 폐기된 디바이스 토큰 → 401

## 설계 문서 참조

- [07-auth-scope](../design/07-auth-scope.md)
- [ADR 0005](../adr/0005-scope-by-entrypoint.md)

## 주의

### 드릴다운에서 `memberId`를 신뢰하지 않는다

가족 대시보드에서 구성원을 클릭하면 `memberId`가 URL에 들어갑니다. 이건 **클라이언트 입력**이므로 그대로 쓰면 안 됩니다.

```ts
// ✅
const visible = await visibleMemberIds(session);
if (!visible.includes(params.memberId)) return new Response(null, { status: 403 });

// ❌
const txs = await prisma.transaction.findMany({ where: { memberId: params.memberId } });
```

Phase 5는 `memberId`를 파라미터로 받는 **첫 화면**이라 이 실수가 처음 가능해지는 지점입니다.

### 미들웨어만 믿지 않는다

`/family/**`를 미들웨어에서 막지만, 그 안의 각 페이지와 API도 자체적으로 `visibleMemberIds()`를 거칩니다. 미들웨어 `matcher` 설정 실수 하나로 전부 뚫리면 안 됩니다.

### 가족 데이터를 다루는 첫 화면

Phase 4까지는 모든 화면이 본인 데이터만 다뤘습니다. 여기서 처음으로 타인 데이터가 화면에 올라옵니다. 권한 테스트를 **기능 구현과 같은 커밋에** 넣으세요.

## 다음

[Phase 6 — 보정 · 운영](phase-6.md)
