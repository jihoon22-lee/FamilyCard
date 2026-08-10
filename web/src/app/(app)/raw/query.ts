// `/raw` 원문 목록 조회.
//
// 반드시 visibleMemberIds(session) 경유(AGENTS.md 불변 규칙 2). RawMessage
// → Device → memberId 로 이어지므로 where 절을
// `device: { memberId: { in: visible } } }` 로 건다.
//
// → docs/plan/phase2-contract.md §5
import type { MessageSource } from '@prisma/client';

import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';

export const RAW_MESSAGE_PAGE_SIZE = 20;

export interface RawMessageListItem {
  id: string;
  source: MessageSource;
  packageName: string;
  title: string;
  body: string;
  receivedAt: Date;
  memberName: string;
}

export interface RawMessageListParams {
  page: number;
  packageName?: string | null;
}

export interface RawMessageListResult {
  items: RawMessageListItem[];
  totalCount: number;
  totalPages: number;
  page: number;
}

function buildWhere(visible: string[], packageName?: string | null) {
  return {
    device: { memberId: { in: visible } },
    ...(packageName ? { packageName } : {}),
  };
}

/**
 * `/raw` 화면의 조회. scope=SELF 세션은 본인 기기의 원문만, scope=FAMILY
 * 세션(관리자 웹 로그인)은 가족 전원의 원문을 본다 — 그 구분은
 * visibleMemberIds() 안에서만 일어나고 여기서는 그 결과를 그대로 쓴다.
 */
export async function fetchRawMessages(
  session: AppSession,
  params: RawMessageListParams,
): Promise<RawMessageListResult> {
  const visible = await visibleMemberIds(session);
  const where = buildWhere(visible, params.packageName);
  const page = Math.max(1, params.page);

  const [totalCount, rows] = await Promise.all([
    prisma.rawMessage.count({ where }),
    prisma.rawMessage.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * RAW_MESSAGE_PAGE_SIZE,
      take: RAW_MESSAGE_PAGE_SIZE,
      select: {
        id: true,
        source: true,
        packageName: true,
        title: true,
        body: true,
        receivedAt: true,
        device: { select: { member: { select: { name: true } } } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / RAW_MESSAGE_PAGE_SIZE));

  return {
    items: rows.map((row) => ({
      id: row.id,
      source: row.source,
      packageName: row.packageName,
      title: row.title,
      body: row.body,
      receivedAt: row.receivedAt,
      memberName: row.device.member.name,
    })),
    totalCount,
    totalPages,
    page,
  };
}

/** 패키지명 필터 드롭다운에 쓸, 현재 보이는 범위 안의 고유 패키지명 목록. */
export async function fetchDistinctPackageNames(session: AppSession): Promise<string[]> {
  const visible = await visibleMemberIds(session);

  const rows = await prisma.rawMessage.findMany({
    where: { device: { memberId: { in: visible } } },
    distinct: ['packageName'],
    select: { packageName: true },
    orderBy: { packageName: 'asc' },
  });

  return rows.map((row) => row.packageName);
}
