export type ReplyBlock =
  | { kind: 'text'; text: string }
  | { kind: 'field'; label: string; value: string }
  | { kind: 'list'; items: string[] };

export type ReplySection = {
  id: string;
  title: string;
  kind:
    | 'business'
    | 'connections'
    | 'rates'
    | 'records'
    | 'rules'
    | 'gaps'
    | 'next'
    | 'answer';
  blocks: ReplyBlock[];
};

function sectionKind(title: string): ReplySection['kind'] {
  if (/\b(gaps?|missing|unknown|don[’']t yet know)\b/i.test(title))
    return 'gaps';
  if (/\b(next|next steps?|prepare next)\b/i.test(title)) return 'next';
  if (/\b(connect(?:ions?|ed|ivity)?|integrations?)\b/i.test(title))
    return 'connections';
  if (/\b(rules?|requirements?|conditions?|guardrails?)\b/i.test(title))
    return 'rules';
  if (/\b(rates?|pricing|prices?|charges?|travel bands?)\b/i.test(title))
    return 'rates';
  if (/\b(records?|jobs?|quotes?|bookings?)\b/i.test(title)) return 'records';
  if (/\b(business|profile|company)\b/i.test(title)) return 'business';
  return 'answer';
}

const bullet = /^[-*+][ \t]+(.+)$/;
const fence = /^ {0,3}(`{3,}|~{3,})/;

function heading(line: string, following?: string): string | undefined {
  const markdown = line.match(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
  const bold = line.match(/^\*\*([^*]+)\*\*:?[ \t]*$/);
  const explicit = markdown?.[1] || bold?.[1];
  if (explicit) return explicit.replace(/:[ \t]*$/, '').trim();
  // A colon alone is not enough to turn a sentence into a section.
  if (
    following &&
    bullet.test(following) &&
    line.length <= 200 &&
    !/^\s/.test(line) &&
    !line.includes('://') &&
    line.endsWith(':')
  )
    return line.slice(0, -1).trim() || undefined;
}

function field(
  text: string,
): Extract<ReplyBlock, { kind: 'field' }> | undefined {
  const match = text.match(
    /^(?:\*\*([^*\n]+):\*\*|\*\*([^*\n]+)\*\*:|([\p{L}][\p{L}\p{N} '&/().–—_-]{0,89}):)[ \t]+(\S[\s\S]*)$/u,
  );
  if (!match) return;
  const label = (match[1] || match[2] || match[3]).trim();
  if (/\s[-–—]\s/.test(label)) return;
  return {
    kind: 'field',
    label,
    value: match[4],
  };
}

// These are labels, never business values. Only an explicit sequence of familiar
// fields can make a spaced hyphen act as an inline bullet separator.
const compactLabels = new Set(
  [
    'name',
    'business name',
    'base location',
    'service area',
    'services',
    'brand summary',
    'managed pack',
    'website',
    'email',
    'phone',
    'abn',
    'google calendar',
    'facebook page',
    'google ads',
    'minimum charge',
    'hourly rate',
    'hourly on-site rate',
    'after-hours rate',
    'travel bands',
    'quote limit',
    'variations',
    'booking rule',
    'pre-start requirements',
  ].map((label) => label.toLowerCase()),
);

function compactLabel(label: string): boolean {
  return compactLabels.has(label.toLowerCase().replace(/\s+\([^)]*\)$/, ''));
}

function compactFields(text: string): string[] {
  const first = field(text);
  if (!first || !compactLabel(first.label) || text.includes('\n'))
    return [text];
  const boundaries: number[] = [];
  let brackets = 0;
  let parentheses = 0;
  let codeTicks = 0;
  let quote = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '`' && !quote) {
      const ticks = text.slice(index).match(/^`+/)![0].length;
      if (!codeTicks) codeTicks = ticks;
      else if (codeTicks === ticks) codeTicks = 0;
      index += ticks - 1;
      continue;
    }
    if (codeTicks) continue;
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (
      char === '"' ||
      char === '“' ||
      ((char === "'" || char === '‘') &&
        (index === 0 || /\s|[([{]/.test(text[index - 1])))
    ) {
      quote = char === '“' ? '”' : char === '‘' ? '’' : char;
      continue;
    }
    if (char === '[') brackets++;
    if (char === ']') brackets = Math.max(0, brackets - 1);
    if (char === '(') parentheses++;
    if (char === ')') parentheses = Math.max(0, parentheses - 1);
    if (!brackets && !parentheses && text.startsWith(' - ', index)) {
      const candidate = field(text.slice(index + 3));
      if (candidate && compactLabel(candidate.label)) boundaries.push(index);
    }
  }
  // Unclosed markup or quotations make the intended grouping uncertain.
  if (brackets || parentheses || codeTicks || quote) return [text];
  const parts: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    parts.push(text.slice(start, boundary));
    start = boundary + 3;
  }
  parts.push(text.slice(start));
  return parts;
}

function blocksFromLines(lines: string[]): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index++;
      continue;
    }
    const opening = lines[index].match(fence)?.[1];
    if (opening) {
      const start = index++;
      while (index < lines.length) {
        const closing = lines[index++].match(
          /^ {0,3}(`{3,}|~{3,})[ \t]*$/,
        )?.[1];
        if (closing?.[0] === opening[0] && closing.length >= opening.length)
          break;
      }
      blocks.push({ kind: 'text', text: lines.slice(start, index).join('\n') });
      continue;
    }
    const item = lines[index].match(bullet);
    if (item) {
      const content = [item[1]];
      index++;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !bullet.test(lines[index]) &&
        !fence.test(lines[index])
      )
        content.push(lines[index++]);
      for (const part of compactFields(content.join('\n'))) {
        const parsed = field(part);
        if (parsed) blocks.push(parsed);
        else {
          const last = blocks.at(-1);
          if (last?.kind === 'list') last.items.push(part);
          else blocks.push({ kind: 'list', items: [part] });
        }
      }
      continue;
    }
    const parsed = field(lines[index]);
    if (
      parsed &&
      (index + 1 === lines.length ||
        !lines[index + 1].trim() ||
        bullet.test(lines[index + 1]) ||
        field(lines[index + 1]))
    ) {
      blocks.push(parsed);
      index++;
      continue;
    }
    const start = index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !bullet.test(lines[index]) &&
      !fence.test(lines[index])
    )
      index++;
    blocks.push({ kind: 'text', text: lines.slice(start, index).join('\n') });
  }
  return blocks;
}

/** Organize explicit source structure without summarizing or filling any gaps. */
export function parseChatSections(text: string): ReplySection[] {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  if (!text.trim()) return [];
  const sections: ReplySection[] = [];
  let title = 'Answer';
  let content: string[] = [];
  let explicitHeading = false;
  let activeFence = '';
  const finish = () => {
    if (!explicitHeading && !content.some((line) => line.trim())) return;
    sections.push({
      id: `section-${sections.length + 1}`,
      title,
      kind: explicitHeading ? sectionKind(title) : 'answer',
      blocks: blocksFromLines(content),
    });
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = line.match(fence)?.[1];
    if (activeFence) {
      content.push(line);
      if (
        marker?.[0] === activeFence[0] &&
        marker.length >= activeFence.length &&
        /^ {0,3}(?:`+|~+)[ \t]*$/.test(line)
      )
        activeFence = '';
      continue;
    }
    if (marker) {
      activeFence = marker;
      content.push(line);
      continue;
    }
    let next = index + 1;
    while (next < lines.length && !lines[next].trim()) next++;
    const found = heading(line, lines[next]);
    if (found) {
      finish();
      title = found;
      explicitHeading = true;
      content = [];
    } else content.push(line);
  }
  finish();
  return sections;
}
