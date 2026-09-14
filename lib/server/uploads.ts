import { AppError, requireValue } from './errors';
import { isHeifUpload, uploadMime } from '../upload-mime';
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const allowedMime = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
];
export function safeFilename(name: string) {
  return (
    name
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .replace(/^[. ]+/, '')
      .slice(0, 120) || 'upload'
  );
}
export function validateFile(bytes: Uint8Array, mime: string) {
  requireValue(
    bytes.length > 0 && bytes.length <= MAX_FILE_SIZE,
    'FILE_TOO_LARGE',
    413,
    'Files must be between 1 byte and 10 MB.',
  );
  requireValue(
    allowedMime.includes(mime),
    'FILE_TYPE_NOT_ALLOWED',
    415,
    'Choose a JPEG, PNG, WebP, PDF, TXT or CSV file.',
  );
  const prefix = String.fromCharCode(...bytes.slice(0, 12));
  let valid = false;
  if (mime === 'image/jpeg')
    valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png')
    valid =
      bytes
        .slice(0, 8)
        .every((x, i) => x === [137, 80, 78, 71, 13, 10, 26, 10][i]) &&
      bytes.length >= 8;
  if (mime === 'image/webp')
    valid = prefix.startsWith('RIFF') && prefix.slice(8) === 'WEBP';
  if (mime === 'application/pdf') valid = prefix.startsWith('%PDF-');
  if (mime === 'text/plain' || mime === 'text/csv') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      valid =
        !text.includes('\0') &&
        !/^\s*(<!doctype\s+html|<html|<script|<svg)/i.test(text);
    } catch {
      valid = false;
    }
  }
  requireValue(
    valid,
    'FILE_CONTENT_MISMATCH',
    415,
    'The file contents do not match the supported file type.',
  );
}

function jpegFilename(filename: string) {
  const base = filename.replace(/\.(?:heic|heif)$/i, '');
  return safeFilename(`${base || 'photo'}.jpg`);
}

export async function prepareUpload(
  bytes: Uint8Array,
  filename: string,
  browserMime: string,
) {
  const safeName = safeFilename(filename),
    mime = uploadMime(safeName, browserMime);
  if (!isHeifUpload(mime)) {
    validateFile(bytes, mime);
    return { bytes, filename: safeName, mime };
  }

  try {
    const { default: sharp } = await import('sharp');
    const source = sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 80_000_000,
    });
    const metadata = await source.metadata();
    requireValue(metadata.format === 'heif', 'FILE_CONTENT_MISMATCH', 415);
    const converted = new Uint8Array(
      await source
        .rotate()
        .resize({
          width: 4096,
          height: 4096,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer(),
    );
    validateFile(converted, 'image/jpeg');
    return {
      bytes: converted,
      filename: jpegFilename(safeName),
      mime: 'image/jpeg',
    };
  } catch {
    throw new AppError(
      'FILE_CONTENT_MISMATCH',
      415,
      'That iPhone or iPad photo could not be read. Choose the original photo again or export it as JPEG.',
    );
  }
}
export async function readFileBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('EMPTY_FILE');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_FILE_SIZE) {
      await reader.cancel();
      throw new AppError('FILE_TOO_LARGE', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
