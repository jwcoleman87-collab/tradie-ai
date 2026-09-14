import type { Action, Upload } from './contracts';

export type DraftSections = {
  structured: boolean;
  caption: string;
  imageReference: string;
  notes: string;
};

const previewImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const fileId = '[\\da-f]{8}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{12}';

function previewImage(upload: Upload) {
  return upload.status === 'ready' && previewImageTypes.has(upload.mime_type);
}

function exactImageReference(reference: string, uploads: Upload[]) {
  const normalized = reference.trim().replace(/[.]$/, '').toLocaleLowerCase();
  const id = normalized.match(
    new RegExp(`^(?:trusted\\s+file\\s+ID\\s*:?\\s*)?(${fileId})$`, 'i'),
  )?.[1];
  return uploads.find(
    (upload) =>
      previewImage(upload) &&
      (upload.id.toLowerCase() === id?.toLowerCase() ||
        upload.filename.toLocaleLowerCase() === normalized),
  );
}

/**
 * Resolve only ready images already present in this authenticated snapshot.
 * This lets every display surface turn a model's trusted ID (or exact file
 * name) back into the real image without fetching an unknown reference.
 */
export function referencedImageUploads(text: string, uploads: Upload[]) {
  const normalized = text.toLocaleLowerCase();
  const referencedIds = new Set(
    [
      ...text.matchAll(
        new RegExp(
          `trusted\\s+(?:app\\s+)?(?:image\\s+)?(?:file|attachment)\\s+(?:ID|reference)\\s*:?\\s*(${fileId})`,
          'gi',
        ),
      ),
    ].map((match) => match[1].toLowerCase()),
  );

  return uploads
    .map((file) => {
      if (!previewImage(file)) return null;
      const idIndex = referencedIds.has(file.id.toLowerCase())
        ? normalized.indexOf(file.id.toLowerCase())
        : -1;
      const filenameIndex = file.filename
        ? normalized.indexOf(file.filename.toLocaleLowerCase())
        : -1;
      const index =
        idIndex < 0
          ? filenameIndex
          : filenameIndex < 0
            ? idIndex
            : Math.min(idIndex, filenameIndex);
      return index < 0 ? null : { file, index };
    })
    .filter((match): match is { file: Upload; index: number } => Boolean(match))
    .sort((left, right) => left.index - right.index)
    .map(({ file }) => file);
}

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
    return exactImageReference(action.payload.imageFileId, uploads);
  }
  const text = [action.payload.body, action.payload.message]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  const mentioned = referencedImageUploads(text, uploads)[0];
  if (mentioned) return mentioned;
  if (typeof action.payload.body !== 'string') return;
  return exactImageReference(
    draftSections(action.payload.body).imageReference,
    uploads,
  );
}
