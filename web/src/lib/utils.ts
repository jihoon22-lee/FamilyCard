import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind 클래스 병합 헬퍼 (shadcn/ui 표준).
 * 조건부 클래스와 충돌하는 유틸리티 클래스를 정리합니다.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
