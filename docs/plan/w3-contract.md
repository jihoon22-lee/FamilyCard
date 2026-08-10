# Phase 1 Wave 3 — 인터페이스 계약

W3-A(Auth + scope)와 W3-B(UI 셸)를 **병렬로** 진행하기 위한 경계면 정의다.
두 작업이 서로의 완성을 기다리지 않고 진행할 수 있도록, 공유하는 함수
시그니처·폼 필드명·파일 소유권을 미리 고정한다.

두 작업을 나눠 맡길 경우 이 문서를 **양쪽에 그대로** 전달한다.

> **선행 조건**: Phase 1 W1(스캐폴딩)·W2(스키마) 완료 — `main` 에 머지됨.
> 관련 스키마: `FamilyMember.name`(UNIQUE, 로그인 아이디 겸용),
> `FamilyMember.passwordHash`(bcrypt). `bcryptjs` 는 이미 설치돼 있다.

## 1. 세션 타입 — `web/src/lib/auth/types.ts`

```ts
export type MemberRole = 'MEMBER' | 'ADMIN';
export type SessionScope = 'SELF' | 'FAMILY';

export interface AppSession {
  memberId: string;
  name: string;
  role: MemberRole;
  scope: SessionScope;
}
```

## 2. 서버에서 세션 얻기 — `web/src/lib/auth/session.ts`

```ts
/** 세션이 없으면 null. 서버 컴포넌트/라우트 핸들러에서 사용 */
export async function getAppSession(): Promise<AppSession | null>;

/** 세션이 없으면 /login 으로 redirect. 보호된 페이지에서 사용 */
export async function requireSession(): Promise<AppSession>;

/** scope !== 'FAMILY' 이면 / 로 redirect. (family) 그룹에서 사용 */
export async function requireFamilyScope(): Promise<AppSession>;
```

## 3. 가시성 헬퍼 — `web/src/lib/auth/scope.ts`

```ts
export async function visibleMemberIds(session: AppSession): Promise<string[]>;
```
- `scope === 'FAMILY'` → 전체 멤버 id
- 그 외 → `[session.memberId]`

## 4. 인증 액션 — `web/src/lib/auth/actions.ts` (Server Actions)

W3-B의 폼이 이걸 호출한다. 반환 형태를 고정한다.

```ts
export type AuthResult = { ok: true } | { ok: false; error: string };

export async function signInAction(formData: FormData): Promise<AuthResult>;
export async function signUpAction(formData: FormData): Promise<AuthResult>;
export async function signOutAction(): Promise<void>;
```

### 폼 필드 이름 (FormData 키) — 고정

| 액션 | 필드 |
|---|---|
| signIn | `name`, `password` |
| signUp | `name`, `password`, `inviteCode` |

`error`는 **한국어 사용자 표시 문구**로 반환한다.
예: `"이름 또는 비밀번호가 올바르지 않습니다."`, `"초대 코드가 올바르지 않습니다."`

성공 시 리다이렉트는 **액션 내부에서** 수행한다 (`redirect('/')`).

## 5. 라우트 구조 — 고정

```
web/src/app/
├── layout.tsx              루트 레이아웃
├── login/page.tsx          로그인          (W3-B)
├── signup/page.tsx         가입            (W3-B)
├── (app)/
│   ├── layout.tsx          requireSession() (W3-B)
│   └── page.tsx            빈 대시보드      (W3-B)
├── (family)/
│   ├── layout.tsx          requireFamilyScope() (W3-B)
│   └── family/page.tsx     빈 가족 화면     (W3-B)
└── api/
    ├── health/route.ts     (W1 완료)
    └── auth/[...nextauth]/route.ts  (W3-A)
```

주의: `(family)` 그룹 안의 실제 경로는 `/family` 다.
미들웨어가 `/family/**` 를 검사한다.

## 6. 미들웨어 — `web/src/middleware.ts` (W3-A)

- `/family/**` → `scope !== 'FAMILY'` 이면 `/` 로 리다이렉트
- `/login`, `/signup`, `/api/health` 는 공개
- 그 외 → 세션 없으면 `/login` 으로

미들웨어는 1차 방어선. `(family)/layout.tsx` 의 `requireFamilyScope()` 가 2차.

## 7. 첫 가입자가 ADMIN

`signUpAction`에서 `FamilyMember` 테이블이 비어 있으면 `role: 'ADMIN'`,
아니면 `'MEMBER'`. 경쟁 조건은 트랜잭션으로 처리.

## 8. 담당 분리 — 파일 충돌 방지

| 파일 | 담당 |
|---|---|
| `src/lib/auth/**` | **W3-A 전용** |
| `src/middleware.ts` | **W3-A 전용** |
| `src/app/api/auth/**` | **W3-A 전용** |
| `src/app/(app)/**`, `src/app/(family)/**` | **W3-B 전용** |
| `src/app/login/**`, `src/app/signup/**` | **W3-B 전용** |
| `src/app/layout.tsx` | **W3-B 전용** |
| `src/components/**` | **W3-B 전용** |

W3-A는 `src/lib/auth/` 밖의 UI 파일을 만들지 않는다.
W3-B는 `src/lib/auth/`를 **import 만** 하고 수정하지 않는다.
(W3-B는 W3-A가 아직 안 끝났어도 위 시그니처를 신뢰하고 작업한다.)
