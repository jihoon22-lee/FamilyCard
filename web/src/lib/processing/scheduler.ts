import { prisma } from '@/lib/db';
import { processBatch } from './index';
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
      if (admin)
        await processBatch({
          memberId: admin.id,
          name: '',
          role: 'ADMIN',
          scope: 'FAMILY',
          entrypoint: 'WEB',
        });
    } catch {
      console.error('processing_cycle_failed');
    } finally {
      setTimeout(() => void cycle(), 15000).unref();
    }
  }
  setTimeout(() => void cycle(), 1000).unref();
}
