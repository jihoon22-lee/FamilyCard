import { NextResponse } from 'next/server';
import { resolveDevice } from '@/lib/auth/device';
import { prisma } from '@/lib/db';
import { parseDeviceStatus } from '@/lib/device-status';

export async function POST(request: Request): Promise<NextResponse> {
  const device = await resolveDevice(request.headers.get('authorization'));
  if (!device) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  let input: unknown;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel().catch(() => undefined);
        return NextResponse.json({ error: 'request_too_large' }, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  } finally {
    reader.releaseLock();
  }
  const status = parseDeviceStatus(input);
  if (!status) return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  try {
    const result = await prisma.device.updateMany({
      where: { id: device.deviceId, memberId: device.memberId, revokedAt: null },
      data: { statusReportedAt: new Date(), statusSnapshot: status },
    });
    if (!result.count) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json({ ok: true });
  } catch {
    console.error('device_status_write_failed');
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
