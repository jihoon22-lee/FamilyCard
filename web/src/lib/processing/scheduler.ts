import { prisma } from '@/lib/db';
import { processBatch } from './index';
import { advanceRun } from '@/lib/reprocessing';
const globalState = globalThis as unknown as { familycardProcessorStarted?: boolean };
export function startProcessor(): void {
  if (globalState.familycardProcessorStarted) return;
  globalState.familycardProcessorStarted = true;
  async function cycle() {
    try {
      const admin = await prisma.familyMember.findFirst({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      if (admin) {
        const session = {
          memberId: admin.id,
          name: '',
          role: 'ADMIN' as const,
          scope: 'FAMILY' as const,
          entrypoint: 'WEB' as const,
        };
        try {
          await advanceRun(session);
        } catch {
          console.error('reprocessing_cycle_failed');
        }
        await processBatch(session);
      }
    } catch {
      console.error('processing_cycle_failed');
    } finally {
      setTimeout(() => void cycle(), 15000).unref();
    }
  }
  setTimeout(() => void cycle(), 1000).unref();
}
