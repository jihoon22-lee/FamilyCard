import { prisma } from '@/lib/db';
import { evaluateAlerts } from './index';
import { deliverPush } from './push';
const state = globalThis as unknown as { familycardAlertsStarted?: boolean };
export function startAlerts() {
  if (state.familycardAlertsStarted) return;
  state.familycardAlertsStarted = true;
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
          await evaluateAlerts(session);
        } catch {
          console.error('alert_evaluation_failed');
        }
        await deliverPush(session);
      }
    } catch {
      console.error('alerts_cycle_failed');
    } finally {
      setTimeout(() => void cycle(), 3600000).unref();
    }
  }
  setTimeout(() => void cycle(), 60000).unref();
}
