function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Only supported narrative fields; never concatenate button labels, URLs or arbitrary JSON strings. */
export function narrative(body: string, source: string): string | null {
  if (source !== 'RCS' || !body.trimStart().startsWith('{')) return body;
  let root: Record<string, unknown> | null;
  try {
    root = object(JSON.parse(body));
  } catch {
    return null;
  }
  if (!root) return null;
  const content = object(object(object(root.message)?.generalPurposeCard)?.content);
  if (content && typeof content.description === 'string') {
    return [typeof content.title === 'string' ? content.title : '', content.description]
      .filter(Boolean)
      .join('\n');
  }
  // Provider legacy card field is plain text in the observed corpus, not serialized JSON.
  if (typeof root.card === 'string' && !/^\s*(https?:|\{|<)/i.test(root.card)) return root.card;
  return null;
}
