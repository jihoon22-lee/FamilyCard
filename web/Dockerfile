# syntax=docker/dockerfile:1
#
# 멀티스테이지 Dockerfile — 두 개의 최종 타깃을 제공합니다.
#   dev  → docker-compose.yml (로컬 개발, 소스는 bind mount)
#   prod → docker-compose.prod.yml / cd.yml (Next.js standalone 런타임)
#
# pnpm 버전은 리포 전체 기준(AGENTS.md: pnpm 9)과 맞춰 corepack으로 고정합니다.

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=9.15.9

# ─────────────────────────────────────────────────────────────
# base — 공통 베이스 이미지
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
# sharp 등 네이티브 모듈이 필요로 하는 glibc 호환 레이어 (Next.js 공식 권장)
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ─────────────────────────────────────────────────────────────
# deps — 의존성만 설치 (레이어 캐시 극대화)
# ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────
# dev — 로컬 개발 타깃
#
# docker-compose.yml 이 ./web 을 /app 에 bind mount 하면서
# node_modules 는 named volume 으로 컨테이너 것을 유지합니다.
# 그래서 여기서는 의존성 설치까지만 해두면 됩니다.
# ─────────────────────────────────────────────────────────────
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

# ─────────────────────────────────────────────────────────────
# builder — 프로덕션 빌드
#
# prisma/schema.prisma 가 추가되면(Phase 1 후속 웨이브) build 전에
#   RUN pnpm prisma generate
# 를 이 스테이지에 추가하세요. 지금은 스키마가 없어 생략합니다.
# ─────────────────────────────────────────────────────────────
FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ─────────────────────────────────────────────────────────────
# prod — 최소 런타임 이미지 (Next.js standalone 출력)
#
# cd.yml 이 이 타깃을 빌드해 GHCR 에 올리고, docker-compose.prod.yml 이
# 그 이미지를 그대로 pull 해서 씁니다.
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS prod
ENV NODE_ENV=production
WORKDIR /app

# ⚠️ Phase 1 후속 웨이브(Prisma) 주의
# 이 스테이지는 base 가 아니라 node:alpine 에서 직접 시작하므로
# base 의 libc6-compat 이 없습니다. Prisma 쿼리 엔진은 네이티브
# 바이너리라 alpine 에서 아래가 필요합니다.
#   RUN apk add --no-cache libc6-compat openssl
# 스키마를 추가할 때 함께 넣으세요. 안 넣으면 이미지는 빌드되지만
# 런타임에 엔진 로드가 실패합니다.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
