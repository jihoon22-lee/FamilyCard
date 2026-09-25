function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function widgetNarrative(layout: unknown): string | null {
  const texts: string[] = [];
  let nodes = 0,
    length = 0;
  function visit(value: unknown, depth: number) {
    if (++nodes > 128 || depth > 8) throw new Error('layout bounds');
    const node = object(value);
    if (!node) return;
    if (node.action || node.onClick || node.clickAction) return;
    if (node.widget === 'TextView' && typeof node.text === 'string') {
      if (/^\s*(https?:|<)/i.test(node.text)) throw new Error('unsupported text markup');
      length += node.text.length;
      if (length > 16000) throw new Error('text bounds');
      texts.push(node.text);
    } else if (node.widget === 'LinearLayout' && Array.isArray(node.children)) {
      for (const child of node.children) visit(child, depth + 1);
    }
  }
  try {
    visit(layout, 0);
    return texts.length ? texts.filter(Boolean).join('\n') : null;
  } catch {
    return null;
  }
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
  // Observed Samsung legacy cards put the narrative in TextView nodes; `card` is format metadata.
  if (root.layout !== undefined) return widgetNarrative(root.layout);
  // A simple card-only text payload has no widget layout or actions to interpret.
  if (typeof root.card === 'string' && !/^\s*(https?:|\{|<)/i.test(root.card)) return root.card;
  return null;
}
