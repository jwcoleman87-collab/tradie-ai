import type { Action, Upload } from './contracts';

export type DraftSections = {
  structured: boolean;
  caption: string;
  imageReference: string;
  notes: string;
};

export function draftSections(body: string): DraftSections {
  const fallback = {
    structured: false,
    caption: body,
    imageReference: '',
    notes: '',
  };
  const text = body.replace(/\r\n?/g, '\n').trim();
  const heading = /^(?:\*\*)?(Caption|Image|Notes):(?:\*\*)?[ \t]*(.*)$/i;
  const lines = text.split('\n');
  if (!/^Caption$/i.test(lines[0]?.match(heading)?.[1] || '')) return fallback;
  const sections: Record<string, string[]> = {};
  let current = '';
  let previous = -1;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(heading);
    // Only a new paragraph can introduce another labelled section.
    if (match && (index === 0 || !lines[index - 1].trim())) {
      const key = match[1].toLowerCase();
      const order = ['caption', 'image', 'notes'].indexOf(key);
      if (order <= previous) return fallback;
      previous = order;
      current = key;
      sections[key] = [match[2]];
    } else {
      sections[current].push(lines[index]);
    }
  }
  const caption = sections.caption?.join('\n').trim();
  if (!caption) return fallback;
  return {
    structured: true,
    caption,
    imageReference: sections.image?.join('\n').trim() || '',
    notes: sections.notes?.join('\n').trim() || '',
  };
}

export function proposalImage(
  action: Pick<Action, 'action_type' | 'payload'>,
  uploads: Upload[],
): Upload | undefined {
  if (typeof action.payload.imageFileId === 'string') {
    return uploads.find((file) => file.id === action.payload.imageFileId);
  }
  if (
    action.action_type !== 'draft.save' ||
    typeof action.payload.body !== 'string'
  )
    return;
  const reference = draftSections(action.payload.body).imageReference;
  const match = reference.match(
    /^(?:trusted\s+file\s+ID\s*:?\s*)?([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\.?$/i,
  );
  if (!match) return;
  return uploads.find(
    (file) =>
      file.id.toLowerCase() === match[1].toLowerCase() &&
      file.status === 'ready' &&
      ['image/jpeg', 'image/png', 'image/webp'].includes(file.mime_type),
  );
}
