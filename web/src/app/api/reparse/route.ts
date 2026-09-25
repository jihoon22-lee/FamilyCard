import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { createPreview, applyPreview, listRuns } from '@/lib/reprocessing';
import { InputError } from '@/lib/cards';
export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ runs: await listRuns(session) });
}
export async function POST(request: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(process.env.APP_URL ?? request.url).origin)
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new InputError('요청이 비었습니다.');
    const decoder = new TextDecoder();
    let text = '',
      size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return NextResponse.json({ error: 'too_large' }, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new InputError('요청 형식 오류');
    const b = body as Record<string, unknown>;
    if (b.dryRun === false) {
      if (typeof b.previewId !== 'string') throw new InputError('완료된 미리보기 ID가 필요합니다.');
      return NextResponse.json(
        await applyPreview(session, b.previewId, b.acknowledgeBreak === true),
        { status: 202 },
      );
    }
    for (const key of ['issuer', 'status', 'from', 'to'])
      if (b[key] !== undefined && typeof b[key] !== 'string')
        throw new InputError('필터 형식 오류');
    return NextResponse.json(
      await createPreview(session, {
        issuer: b.issuer as string | undefined,
        status: b.status as string | undefined,
        from: b.from as string | undefined,
        to: b.to as string | undefined,
      }),
      { status: 202 },
    );
  } catch (e) {
    if (e instanceof InputError || e instanceof SyntaxError)
      return NextResponse.json(
        { error: e instanceof InputError ? e.message : 'invalid_json' },
        { status: 400 },
      );
    console.error('reparse_request_failed');
    return NextResponse.json({ error: 'request_failed' }, { status: 500 });
  }
}
