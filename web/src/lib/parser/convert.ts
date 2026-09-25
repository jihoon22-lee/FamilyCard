import type { ParsedFields } from './types';
const DAY = 86400000;
const KST = 9 * 3600000;
export function money(value: string, scale = 0): number {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) throw new Error('invalid scale');
  const text = value.trim().replace(/원$/, '').trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) throw new Error('invalid money');
  const [whole, decimal = ''] = text.replaceAll(',', '').split('.');
  if (decimal.length > scale) throw new Error('fraction precision');
  const amount = BigInt(whole!) * 10n ** BigInt(scale) + BigInt(decimal.padEnd(scale, '0') || '0');
  if (amount > 2147483647n) throw new Error('amount range');
  return Number(amount);
}

export function monthDay(
  month: string,
  day: string,
  time: string | undefined,
  reference: Date,
): string {
  const m = Number(month),
    d = Number(day);
  if (!/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day) || !Number.isFinite(reference.getTime()))
    throw new Error('date');
  const match = time === undefined ? null : /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (time !== undefined && !match) throw new Error('time');
  const h = Number(match?.[1] ?? 0),
    min = Number(match?.[2] ?? 0),
    sec = Number(match?.[3] ?? 0);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || sec > 59)
    throw new Error('date range');
  let year = new Date(reference.getTime() + KST).getUTCFullYear();
  const create = (y: number) => Date.UTC(y, m - 1, d, h, min, sec) - KST;
  if (create(year) > reference.getTime() + DAY) year--;
  const result = new Date(create(year));
  const local = new Date(result.getTime() + KST);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== m - 1 || local.getUTCDate() !== d)
    throw new Error('invalid calendar date');
  return result.toISOString();
}

function strictIso(text: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) throw new Error('ISO date');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw new Error('ISO bounds');
  const zone = match[7]!;
  if (
    zone !== 'Z' &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4, 6)) > 59 ||
      (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4, 6)) !== 0))
  )
    throw new Error('offset');
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error('ISO date');
  return date.toISOString();
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('field map');
  return value as Record<string, unknown>;
}

/** Data-only mapping: no eval, arbitrary property assignment or floating point amounts. */
export function convertFields(
  fieldMap: unknown,
  groups: Record<string, string | null>,
  issuer: string,
  receivedAt: Date,
): ParsedFields {
  const map = record(fieldMap);
  if (Object.keys(map).length > 16) throw new Error('too many mappings');
  const allowed = new Set([
    'amount',
    'txType',
    'approvedAt',
    'originalApprovedAt',
    'merchant',
    'merchantName',
    'cardToken',
    'installment',
    'installmentMonths',
    'currency',
    'foreignAmount',
    'foreignScale',
    'approvalReference',
  ]);
  const values: Record<string, unknown> = Object.create(null);
  let precision: ParsedFields['timePrecision'] = 'RECEIVED';
  for (const [rawKey, input] of Object.entries(map)) {
    if (!allowed.has(rawKey)) throw new Error('unknown field');
    const key =
      rawKey === 'merchant'
        ? 'merchantName'
        : rawKey === 'installment'
          ? 'installmentMonths'
          : rawKey;
    const config = record(input);
    const from = typeof config.from === 'string' ? config.from : rawKey;
    const text = groups[from];
    if (config.type === 'const') {
      values[key] = config.value;
      continue;
    }
    if (config.type === 'received_at') {
      values[key] = receivedAt.toISOString();
      continue;
    }
    if (config.type === 'datetime_md') {
      if (
        !Array.isArray(config.from) ||
        config.from.length < 2 ||
        config.from.length > 3 ||
        config.from.some((x) => typeof x !== 'string')
      )
        throw new Error('date mapping');
      const [m, d, t] = config.from as string[];
      const time = t ? (groups[t] ?? undefined) : undefined;
      if (t && !time) throw new Error('missing time');
      values[key] = monthDay(groups[m!] ?? '', groups[d!] ?? '', time, receivedAt);
      if (key === 'approvedAt')
        precision = time ? (time.length === 8 ? 'SECOND' : 'MINUTE') : 'DAY';
      continue;
    }
    if (config.type === 'datetime_iso') {
      if (!text) throw new Error('missing time');
      values[key] = strictIso(text);
      if (key === 'approvedAt') precision = 'SECOND';
      continue;
    }
    if (text == null) throw new Error('missing capture');
    if (config.type === 'money') values[key] = money(text);
    else if (config.type === 'foreign_money') {
      const scale = config.scale;
      if (typeof scale !== 'number') throw new Error('foreign scale');
      values[key] = money(text, scale);
      values.foreignScale = scale;
    } else if (config.type === 'installment') {
      if (text === '일시불') values[key] = 0;
      else {
        const match = /^(\d{1,2})(?:개월)?$/.exec(text);
        if (!match) throw new Error('installment');
        values[key] = Number(match[1]);
      }
    } else if (config.type === 'text') values[key] = config.trim === false ? text : text.trim();
    else if (config.type === 'card_token') values[key] = text;
    else throw new Error('unknown transform');
  }
  const amount = values.amount ?? null;
  if (
    amount !== null &&
    (!Number.isInteger(amount) || typeof amount !== 'number' || amount < 0 || amount > 2147483647)
  )
    throw new Error('amount');
  const currency = values.currency ?? 'KRW';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new Error('currency');
  const foreignAmount = values.foreignAmount ?? null,
    foreignScale = values.foreignScale ?? null;
  if (
    foreignAmount !== null &&
    (typeof foreignAmount !== 'number' ||
      !Number.isInteger(foreignAmount) ||
      foreignAmount < 0 ||
      foreignAmount > 2147483647 ||
      typeof foreignScale !== 'number' ||
      !Number.isInteger(foreignScale) ||
      foreignScale < 0 ||
      foreignScale > 6)
  )
    throw new Error('foreign amount');
  if (amount === null && (currency === 'KRW' || foreignAmount === null))
    throw new Error('missing amount');
  if (values.txType !== 'APPROVAL' && values.txType !== 'CANCELLATION') throw new Error('txType');
  if (typeof values.approvedAt !== 'string' || !Number.isFinite(Date.parse(values.approvedAt)))
    throw new Error('approvedAt');
  strictIso(values.approvedAt);
  if (Date.parse(values.approvedAt) > receivedAt.getTime() + DAY)
    throw new Error('future approval');
  const string = (key: string, max: number) => {
    const value = values[key] ?? '';
    if (typeof value !== 'string' || value.length > max || value.includes('\0'))
      throw new Error('text');
    return value;
  };
  const installment = values.installmentMonths ?? 0;
  if (
    typeof installment !== 'number' ||
    !Number.isInteger(installment) ||
    installment < 0 ||
    installment > 99
  )
    throw new Error('installment');
  const original = values.originalApprovedAt ?? null;
  if (
    original !== null &&
    (typeof original !== 'string' ||
      !Number.isFinite(Date.parse(original)) ||
      Date.parse(original) > Date.parse(values.approvedAt) + DAY)
  )
    throw new Error('original date');
  if (typeof original === 'string') strictIso(original);
  return {
    issuer,
    amount: amount as number | null,
    txType: values.txType,
    approvedAt: values.approvedAt,
    originalApprovedAt: original as string | null,
    timePrecision: precision,
    merchantName: string('merchantName', 300),
    cardToken: string('cardToken', 100),
    installmentMonths: installment,
    currency,
    foreignAmount: foreignAmount as number | null,
    foreignScale: foreignScale as number | null,
    approvalReference: string('approvalReference', 100) || null,
  };
}
