import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 네이티브 <label>을 감싼 shadcn/ui 스타일 라벨.
 * Radix Label(@radix-ui/react-label)은 설치돼 있지 않아 순수 시맨틱 요소로 대체합니다.
 */
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
